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
        label_en="Rollback",
        label_ru="Откат",
        description_en="Green is CrashLooping — trigger an emergency rollback to blue.",
        description_ru="Green падает в CrashLoop — экстренный откат на blue.",
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


def _make_pod(pod_id: str, color: str, weight: int, crashloop: bool = False) -> PodHealth:
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
) -> DeploymentSlot:
    pods = [
        _make_pod(f"{color}-{i}", color, weight, crashloop and i == 0)
        for i in range(replicas)
    ]
    healthy = sum(1 for p in pods if p.ready)
    total_rps = sum(p.rps for p in pods)
    avg_lat = (
        sum(p.p99_latency_ms for p in pods if p.ready) / max(healthy, 1)
        if healthy else 0
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


def _gateway(blue_weight: int, blue: DeploymentSlot, green: DeploymentSlot) -> GatewayState:
    total_rps = blue.total_rps + green.total_rps
    p99 = (
        (blue.avg_latency_ms * blue.total_rps + green.avg_latency_ms * green.total_rps)
        / max(total_rps, 1)
    )
    return GatewayState(
        algorithm="round_robin",
        sticky_sessions=False,
        health_check_interval_s=5,
        total_rps=round(total_rps, 2),
        p99_latency_ms=round(p99, 2),
        dropped_packets=0,  # always 0 on a proper shift — CLS=0 for ops
    )


def _insight(scenario: str, blue_weight: int) -> str:
    green_weight = 100 - blue_weight
    if scenario == "rollback":
        return (
            "Emergency rollback: 100 % of traffic returned to blue. "
            "Green pods stay Running so a re-deploy takes seconds, not minutes."
        )
    if green_weight == 0:
        return (
            "Green is idle (warm standby). Blue handles all traffic. "
            "To start a canary shift, raise green's weight to 10."
        )
    if green_weight <= 15:
        return (
            f"Canary phase: {green_weight} % of users hit the new release. "
            "Watch error_rate_percent and p99_latency_ms before widening the gate."
        )
    if green_weight < 100:
        return (
            f"Progressive delivery: {green_weight} % on green, {blue_weight} % on blue. "
            "Green's lower latency is already measurable in the gateway p99."
        )
    return (
        "Full cutover complete. All traffic on green (new release). "
        "Blue stays warm — a rollback is a single weight-shift away."
    )


def _build_topology(scenario: str, blue_weight: int) -> TopologySnapshot:
    green_weight = 100 - blue_weight
    crashloop = scenario == "rollback" and green_weight > 0 and blue_weight < 100
    blue = _make_slot("blue", blue_weight, "v1.4.2")
    green = _make_slot("green", green_weight, "v1.5.0", crashloop=crashloop)
    gw = _gateway(blue_weight, blue, green)
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
    _state[scenario] = {"blue_weight": new_blue}

    green_weight = 100 - new_blue
    crashloop = scenario == "rollback" and green_weight > 0 and new_blue < 100
    blue = _make_slot("blue", new_blue, "v1.4.2")
    green = _make_slot("green", green_weight, "v1.5.0", crashloop=crashloop)
    gw = _gateway(new_blue, blue, green)

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
        dropped_packets=0,
        shift_safe=blue.healthy_replicas > 0 and (green.healthy_replicas > 0 or new_blue == 100),
        gateway=gw,
        blue=blue,
        green=green,
        insight=_insight(scenario, new_blue),
    )
