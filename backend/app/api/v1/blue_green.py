"""Blue/Green deployment trainer — API routes.

Routes
------
GET  /api/v1/probe/blue-green/topology  — current deployment state snapshot
POST /api/v1/probe/blue-green/shift     — simulate a traffic weight shift
GET  /api/v1/probe/blue-green/scenarios — list available scenario presets

Design constraints (CODEX.md)
------------------------------
* Zero-PII: no user IDs, IPs, or session UUIDs in audit log or Prometheus labels
* Blast radius: pure in-process simulation, no real Kubernetes calls
* Rate limit: 30 req/min per IP via shared slowapi limiter
* Prometheus: counters keyed only by trainer + scenario + status
"""
import asyncio
import random
import time
from typing import List, Dict, Optional, Literal

from fastapi import APIRouter, Depends, Query, Request, Body
from pydantic import BaseModel, Field

from backend.app.core.audit import record_audit_event, metrics
from backend.app.core.rate_limit import limiter

router = APIRouter(prefix="/probe/blue-green", tags=["blue-green"])

# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------

TRAINER_NAME = "blue-green"
VERSION = "1.0.0"


class PodHealth(BaseModel):
    pod_id: str
    status: Literal["Running", "Pending", "CrashLoopBackOff", "Terminating"]
    ready: bool
    cpu_percent: float = Field(ge=0, le=100)
    memory_mb: float = Field(ge=0)
    p99_latency_ms: float = Field(ge=0)
    rps: float = Field(ge=0)
    errors_per_min: float = Field(ge=0)


class DeploymentSlot(BaseModel):
    color: Literal["blue", "green"]
    version: str
    weight: int = Field(ge=0, le=100, description="Traffic weight 0-100")
    replicas: int = Field(ge=0)
    healthy_replicas: int = Field(ge=0)
    pods: List[PodHealth]
    avg_latency_ms: float
    total_rps: float
    error_rate_percent: float


class GatewayState(BaseModel):
    algorithm: Literal["round_robin", "least_conn", "ip_hash"]
    sticky_sessions: bool
    health_check_interval_s: int
    total_rps: float
    p99_latency_ms: float
    dropped_packets: int


class TopologySnapshot(BaseModel):
    trainer: str = TRAINER_NAME
    version: str = VERSION
    scenario: str
    timestamp_ms: int
    blue: DeploymentSlot
    green: DeploymentSlot
    gateway: GatewayState
    shift_in_progress: bool
    insight: str


class ShiftRequest(BaseModel):
    blue_weight: int = Field(ge=0, le=100)
    scenario: str = Field(default="canary_10", pattern=r"^[a-z0-9_-]{1,40}$")

    @property
    def green_weight(self) -> int:
        return 100 - self.blue_weight


class ShiftResult(BaseModel):
    trainer: str = TRAINER_NAME
    version: str = VERSION
    scenario: str
    duration_ms: float
    previous_blue_weight: int
    new_blue_weight: int
    new_green_weight: int
    dropped_packets: int
    shift_safe: bool
    gateway: GatewayState
    blue: DeploymentSlot
    green: DeploymentSlot
    insight: str


class ScenarioInfo(BaseModel):
    id: str
    label_en: str
    label_ru: str
    description_en: str
    description_ru: str
    initial_blue_weight: int


# ---------------------------------------------------------------------------
# Scenario registry
# ---------------------------------------------------------------------------

SCENARIOS: Dict[str, ScenarioInfo] = {
    "canary_10": ScenarioInfo(
        id="canary_10",
        label_en="Canary 10 %",
        label_ru="Канарейка 10 %",
        description_en="Route 10 % of live traffic to the new green release while blue handles the rest.",
        description_ru="10 % трафика идёт на новый релиз (green), остальное — на стабильный (blue).",
        initial_blue_weight=90,
    ),
    "50_50": ScenarioInfo(
        id="50_50",
        label_en="50 / 50 Split",
        label_ru="Разделение 50 / 50",
        description_en="Equal split between blue and green — good for A/B performance tests.",
        description_ru="Равный раздел трафика — удобно для A/B-тестов производительности.",
        initial_blue_weight=50,
    ),
    "full_cutover": ScenarioInfo(
        id="full_cutover",
        label_en="Full Cutover",
        label_ru="Полный переход",
        description_en="All traffic shifts to green; blue kept warm for instant rollback.",
        description_ru="Весь трафик переходит на green; blue остаётся тёплым для мгновенного отката.",
        initial_blue_weight=0,
    ),
    "rollback": ScenarioInfo(
        id="rollback",
        label_en="Manual Rollback",
        label_ru="Ручной откат",
        description_en="Green is CrashLooping — trigger an emergency rollback to blue.",
        description_ru="Green падает в CrashLoop — экстренный откат на blue.",
        initial_blue_weight=100,
    ),
    "bad_gateway_502": ScenarioInfo(
        id="bad_gateway_502",
        label_en="502/504 Bad Gateway",
        label_ru="502/504 Bad Gateway",
        description_en="Broken upstream on Green causing connection drops and 502/504 timeouts at NGINX Gateway.",
        description_ru="Сломанный апстрим на Green: сбросы соединений, таймауты 502/504 на NGINX шлюзе.",
        initial_blue_weight=70,
    ),
    "drain_connections": ScenarioInfo(
        id="drain_connections",
        label_en="Graceful Drain",
        label_ru="Дренаж соединений (Graceful)",
        description_en="Blue pods entering Terminating status with preStop hook draining in-flight HTTP requests.",
        description_ru="Поды Blue переходят в Terminating с хуком preStop, плавно дорабатывая активные HTTP-запросы.",
        initial_blue_weight=0,
    ),
    "auto_rollback": ScenarioInfo(
        id="auto_rollback",
        label_en="Automated Circuit Rollback",
        label_ru="Автооткат по порогу ошибок",
        description_en="Canary shift to Green fails health check threshold (>5% 5xx errors) triggering automatic rollback.",
        description_ru="Канареечный трафик на Green превышает порог ошибок (>5% 5xx), шлюз автоматически возвращает 100% Blue.",
        initial_blue_weight=100,
    ),
}

# Mutable in-process state (single-process dev/demo; replace with Redis for multi-pod)
_state: Dict[str, dict] = {}  # scenario_id -> last topology weights


# ---------------------------------------------------------------------------
# Simulation helpers
# ---------------------------------------------------------------------------

_RNG = random.Random(42)


def _jitter(base: float, pct: float = 0.12) -> float:
    return round(base * (1 + _RNG.uniform(-pct, pct)), 2)


def _make_pod(
    pod_id: str,
    color: str,
    weight: int,
    crashloop: bool = False,
    terminating: bool = False,
    bad_gateway: bool = False,
) -> PodHealth:
    if terminating:
        return PodHealth(
            pod_id=pod_id,
            status="Terminating",
            ready=False,
            cpu_percent=_jitter(8),
            memory_mb=_jitter(95),
            p99_latency_ms=_jitter(120),
            rps=_jitter(15),  # draining in-flight requests
            errors_per_min=0,
        )
    if crashloop:
        return PodHealth(
            pod_id=pod_id,
            status="CrashLoopBackOff",
            ready=False,
            cpu_percent=_jitter(5),
            memory_mb=_jitter(64),
            p99_latency_ms=0,
            rps=0,
            errors_per_min=_jitter(120),
        )
    if bad_gateway:
        return PodHealth(
            pod_id=pod_id,
            status="Running",
            ready=False,
            cpu_percent=_jitter(92),
            memory_mb=_jitter(480),
            p99_latency_ms=_jitter(1500),  # 1.5s timeout
            rps=_jitter(30),
            errors_per_min=_jitter(380),  # 502 Bad Gateway bursts
        )
    if weight == 0:
        # idle / warm standby
        return PodHealth(
            pod_id=pod_id,
            status="Running",
            ready=True,
            cpu_percent=_jitter(2),
            memory_mb=_jitter(80),
            p99_latency_ms=0,
            rps=0,
            errors_per_min=0,
        )
    base_rps = 200 * weight / 100
    base_lat = 38 if color == "green" else 55  # green is the new faster version
    return PodHealth(
        pod_id=pod_id,
        status="Running",
        ready=True,
        cpu_percent=_jitter(20 + weight * 0.5),
        memory_mb=_jitter(180 + weight),
        p99_latency_ms=_jitter(base_lat),
        rps=_jitter(base_rps),
        errors_per_min=_jitter(0.5 if color == "blue" else 0.1),
    )


def _make_slot(
    color: Literal["blue", "green"],
    weight: int,
    version: str,
    replicas: int = 3,
    crashloop: bool = False,
    terminating: bool = False,
    bad_gateway: bool = False,
) -> DeploymentSlot:
    pods = [
        _make_pod(
            f"{color}-{i}",
            color,
            weight,
            crashloop=crashloop and i == 0,
            terminating=terminating,
            bad_gateway=bad_gateway and i >= 1,
        )
        for i in range(replicas)
    ]
    healthy = sum(1 for p in pods if p.ready)
    total_rps = sum(p.rps for p in pods)
    avg_lat = (
        sum(p.p99_latency_ms for p in pods if p.ready) / max(healthy, 1)
        if healthy else (sum(p.p99_latency_ms for p in pods) / max(len(pods), 1))
    )
    err_rate = (
        sum(p.errors_per_min for p in pods) / max(total_rps * 60, 1) * 100
    )
    return DeploymentSlot(
        color=color,
        version=version,
        weight=weight,
        replicas=replicas,
        healthy_replicas=healthy,
        pods=pods,
        avg_latency_ms=round(avg_lat, 2),
        total_rps=round(total_rps, 2),
        error_rate_percent=round(min(err_rate, 100), 4),
    )


def _gateway(
    blue_weight: int,
    blue: DeploymentSlot,
    green: DeploymentSlot,
    scenario: str = "",
) -> GatewayState:
    total_rps = blue.total_rps + green.total_rps
    p99 = (
        (blue.avg_latency_ms * blue.total_rps + green.avg_latency_ms * green.total_rps)
        / max(total_rps, 1)
    )
    dropped = 0
    if scenario == "bad_gateway_502" and (100 - blue_weight) > 0:
        dropped = int(round(_jitter(45 * (100 - blue_weight) / 100)))

    return GatewayState(
        algorithm="round_robin",
        sticky_sessions=False,
        health_check_interval_s=5,
        total_rps=round(total_rps, 2),
        p99_latency_ms=round(p99, 2),
        dropped_packets=dropped,
    )


def _insight(scenario: str, blue_weight: int) -> str:
    green_weight = 100 - blue_weight
    if scenario == "bad_gateway_502":
        return (
            f"⚠️ КРИТИЧЕСКИЙ СБОЙ: Апстрим Green вернул 502/504 Bad Gateway! "
            f"На шлюзе зафиксировано сброшенных запросов. Требуется немедленный Rollback на Blue!"
        )
    if scenario == "drain_connections":
        return (
            "🔄 ПЛАВНЫЙ ДРЕНАЖ: Blue поды в статусе Terminating безопасно завершают активные сокеты. "
            "Новые запросы направляются только на Green. Нулевой 502 downtime!"
        )
    if scenario == "auto_rollback":
        return (
            "🛡️ АВТООТКАТ: Circuit Breaker сработал при превышении лимита 5xx ошибок. "
            "Шлюз в течение 300мс вернул 100% трафика на проверенный слот Blue."
        )
    if scenario == "rollback":
        return (
            "Экстренный откат: 100 % трафика возвращено на слот Blue. "
            "Green поды изолированы для анализа логов и дампа памяти."
        )
    if green_weight == 0:
        return (
            "Green находится в режиме тёплого ожидания (warm standby). Blue обрабатывает 100% запросов."
        )
    if green_weight <= 15:
        return (
            f"Канареечная фаза: {green_weight} % пользователей направлены на релиз Green. "
            "Следите за error_rate_percent и p99_latency_ms перед расширением шлюза."
        )
    if green_weight < 100:
        return (
            f"Прогрессивная доставка: {green_weight} % на Green, {blue_weight} % на Blue."
        )
    return (
        "Полный перенос завершен. 100 % трафика на Green. Blue готов к мгновенному откату."
    )


def _build_topology(scenario: str, blue_weight: int) -> TopologySnapshot:
    green_weight = 100 - blue_weight
    crashloop = scenario == "rollback" and green_weight > 0 and blue_weight < 100
    terminating = scenario == "drain_connections" and blue_weight == 0
    bad_gateway = scenario == "bad_gateway_502" and green_weight > 0

    blue = _make_slot("blue", blue_weight, "v1.4.2", terminating=terminating)
    green = _make_slot(
        "green",
        green_weight,
        "v1.5.0",
        crashloop=crashloop,
        bad_gateway=bad_gateway,
    )
    gw = _gateway(blue_weight, blue, green, scenario=scenario)
    return TopologySnapshot(
        scenario=scenario,
        timestamp_ms=int(time.time() * 1000),
        blue=blue,
        green=green,
        gateway=gw,
        shift_in_progress=False,
        insight=_insight(scenario, blue_weight),
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/scenarios", response_model=List[ScenarioInfo])
async def list_scenarios() -> List[ScenarioInfo]:
    """Return available deployment scenario presets."""
    return list(SCENARIOS.values())


@router.get("/topology", response_model=TopologySnapshot)
@limiter.limit("30/minute")
async def get_topology(
    request: Request,
    scenario: str = Query(default="canary_10", pattern=r"^[a-z0-9_-]{1,40}$"),
) -> TopologySnapshot:
    """Return the current simulated deployment topology for a given scenario."""
    info = SCENARIOS.get(scenario)
    if info is None:
        scenario = "canary_10"
        info = SCENARIOS["canary_10"]

    blue_weight = _state.get(scenario, {}).get("blue_weight", info.initial_blue_weight)
    return _build_topology(scenario, blue_weight)


@router.post("/shift", response_model=ShiftResult)
@limiter.limit("20/minute")
async def shift_traffic(
    request: Request,
    body: ShiftRequest = Body(...),
) -> ShiftResult:
    """Simulate a traffic weight shift and return the resulting topology."""
    t0 = time.perf_counter()

    scenario = body.scenario if body.scenario in SCENARIOS else "canary_10"
    prev_state = _state.get(scenario, {})
    prev_blue = prev_state.get("blue_weight", SCENARIOS[scenario].initial_blue_weight)

    # Simulate network round-trip + k8s reconciliation delay
    await asyncio.sleep(_jitter(0.03, 0.4))

    new_blue = body.blue_weight
    if scenario == "auto_rollback" and new_blue < 100:
        # Auto-rollback triggers if Green is given traffic under error conditions
        new_blue = 100

    _state[scenario] = {"blue_weight": new_blue}

    green_weight = 100 - new_blue
    crashloop = scenario == "rollback" and green_weight > 0 and new_blue < 100
    terminating = scenario == "drain_connections" and new_blue == 0
    bad_gateway = scenario == "bad_gateway_502" and green_weight > 0

    blue = _make_slot("blue", new_blue, "v1.4.2", terminating=terminating)
    green = _make_slot("green", green_weight, "v1.5.0", crashloop=crashloop, bad_gateway=bad_gateway)
    gw = _gateway(new_blue, blue, green, scenario=scenario)

    duration_ms = (time.perf_counter() - t0) * 1000

    # Zero-PII audit
    record_audit_event(
        trainer=TRAINER_NAME,
        scenario=scenario,
        trainer_version=VERSION,
        status="success",
        duration_ms=round(duration_ms, 2),
    )

    return ShiftResult(
        scenario=scenario,
        duration_ms=round(duration_ms, 2),
        previous_blue_weight=prev_blue,
        new_blue_weight=new_blue,
        new_green_weight=green_weight,
        dropped_packets=gw.dropped_packets,
        shift_safe=blue.healthy_replicas > 0 and (green.healthy_replicas > 0 or new_blue == 100) and gw.dropped_packets == 0,
        gateway=gw,
        blue=blue,
        green=green,
        insight=_insight(scenario, new_blue),
    )
