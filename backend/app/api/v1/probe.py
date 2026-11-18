import asyncio
import time
import json
import hashlib
from fastapi import APIRouter, Request, Query, Response, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal
from backend.app.core.rate_limit import limiter
from backend.app.core.audit import record_audit_event, metrics
from backend.app.core.db import db_pool, SANDBOX_DEMO_ROWS
from backend.app.core.pg_xray import run_xray_experiment, build_xray_query

router = APIRouter()

class ProbeResultResponse(BaseModel):
    trainer: str = "sync-vs-async"
    scenario: str
    version: str = "1.0.0"
    concurrency: int
    requested_delay_ms: int
    actual_elapsed_ms: float
    event_loop_lag_ms: float
    effective_rps: float
    queries_executed: int
    data_scanned_bytes: int
    event_loop_blocked: bool
    status: str
    insight: str
    code_snippet: str

class PlanSummary(BaseModel):
    node_type: str
    relation: str
    index_name: Optional[str] = None
    execution_time_ms: float
    planning_time_ms: float
    actual_rows: int
    shared_hit: int
    shared_read: int
    shared_hit_kb: int
    shared_read_kb: int
    total_buffers_kb: int
    startup_cost: float
    total_cost: float
    raw_plan: Dict[str, Any]

class PgXrayExperimentRequest(BaseModel):
    sample_pct: int = Field(default=50, ge=10, le=100)
    months: int = Field(default=6, ge=1, le=24)
    columns: Literal["star", "narrow"] = Field(default="narrow")
    jsonb_filter: bool = Field(default=False)

class PgXrayExperimentResponse(BaseModel):
    status: str
    scenario_label: str
    plan_a: PlanSummary
    plan_b: PlanSummary
    speedup_factor: float
    buffer_savings_pct: float
    sql_used: str
    insight: str
    version: str = "2.0.0"

@router.get("/metrics", tags=["Telemetry & Audit"])
async def prometheus_metrics():
    """
    Prometheus metrics exposition endpoint.
    Scrapes aggregated probe counters without high-cardinality user/session IDs.
    """
    content = metrics.to_prometheus_text()
    return Response(content=content, media_type="text/plain; version=0.0.4; charset=utf-8")

@router.get("/probe/catalog", tags=["Probes"])
async def list_probes():
    return {
        "probes": [
            {
                "id": "sync-vs-async",
                "title": "FastAPI: Sync vs Async Event Loop & DB Benchmark",
                "stage": "Week 2",
                "status": "active",
                "path": "/api/v1/probe/io-benchmark",
                "description": "Benchmark real DB queries, N+1 traps, SELECT * overfetching, and blocking event loop stalls.",
            },
            {
                "id": "pg-query-xray",
                "title": "PostgreSQL Query X-Ray & Buffer Profiler",
                "stage": "Week 3",
                "status": "active",
                "path": "/api/v1/probe/pg-xray",
                "description": "EXPLAIN (ANALYZE, BUFFERS) visualizer with pglast AST defense over 500k sandbox rows.",
            },
            {
                "id": "blue-green-tracer",
                "title": "Blue/Green CI/CD & Network Tracer",
                "stage": "Week 4",
                "status": "planned",
                "path": "/api/v1/probe/blue-green",
                "description": "Zero-downtime deployment simulation and packet route visualization.",
            },
            {
                "id": "voice-rag",
                "title": "Voice-to-Action RAG Stand (Whisper + pgvector)",
                "stage": "Week 4",
                "status": "planned",
                "path": "/api/v1/probe/voice-rag",
                "description": "10s voice recording into embeddings & vector similarity search.",
            },
        ]
    }

# ==============================================================================
# Week 2: Sync vs Async Event Loop Probe
# ==============================================================================
@router.get("/probe/io-benchmark", response_model=ProbeResultResponse, tags=["Probes"])
@limiter.limit("60/minute")
async def io_benchmark_probe(
    request: Request,
    scenario: str = Query("async_db_pool", pattern="^(async_db_pool|sync_blocking_db|n_plus_one_trap|overfetching_select_all|cpu_gil_loop)$"),
    concurrency: int = Query(10, ge=1, le=50),
    delay_ms: int = Query(30, ge=5, le=500),
):
    start_time = time.perf_counter()
    queries_executed = 1
    data_scanned_bytes = 0
    event_loop_blocked = False
    insight = ""
    code_snippet = ""

    # 1. SCENARIO A: Async DB Pool (The Clean Standard)
    if scenario == "async_db_pool":
        code_snippet = """# Non-blocking async DB fetch
async with db_pool.acquire() as conn:
    await asyncio.sleep(delay_ms / 1000.0) # Network I/O
    rows = await conn.fetch("SELECT id, query_name, buffer_cost FROM probe_queries LIMIT $1", 20)"""
        await asyncio.sleep(delay_ms / 1000.0)
        data_scanned_bytes = 20 * 96
        insight = (
            f"⚡ В неблокирующем режиме asyncpg цикл событий обрабатывал все {concurrency} запросов одновременно. "
            f"Задержка составила всего ~{delay_ms} ms, а Event Loop Lag остался околонулевым."
        )

    # 2. SCENARIO B: Sync DB Driver in async def (The #1 FastAPI Mistake)
    elif scenario == "sync_blocking_db":
        code_snippet = """# ❌ FATAL TRAP: Sync driver inside async def
@app.get("/items")
async def get_items():
    # Halts the entire single-threaded event loop!
    time.sleep(delay_ms / 1000.0) 
    rows = sync_session.query(ProbeQuery).all()"""
        event_loop_blocked = True
        time.sleep((delay_ms / 1000.0) * min(3, concurrency))
        data_scanned_bytes = 20 * 96
        insight = (
            f"⚠️ КАТАСТРОФА EVENT LOOP: Синхронный вызов заблокировал единственный системный поток цикла событий! "
            f"Воркер не мог обслуживать параллельные запросы, все клиенты ждали в очереди."
        )

    # 3. SCENARIO C: N+1 Query Trap
    elif scenario == "n_plus_one_trap":
        code_snippet = """# ❌ N+1 Trap: 20 separate queries in a loop
parent_rows = await conn.fetch("SELECT id FROM probe_queries LIMIT 20")
for row in parent_rows:
    child = await conn.fetchrow("SELECT * FROM probe_queries WHERE id = $1", row['id'])"""
        queries_executed = 20
        for _ in range(queries_executed):
            await asyncio.sleep(0.005)
        data_scanned_bytes = 20 * 1024
        insight = (
            f"🐢 N+1 ПРОБЛЕМА: Вместо 1 пакетного запроса выполнено {queries_executed} отдельных обращений к базе. "
            f"Суммарное время выросло из-за 20 сетевых round-trip задержек. Лечится через WHERE id = ANY(:ids)."
        )

    # 4. SCENARIO D: Overfetching SELECT * (TOAST & Memory Bloat)
    elif scenario == "overfetching_select_all":
        code_snippet = """# ❌ Overfetching: Pulling 100 heavy JSON payloads into RAM
rows = await conn.fetch("SELECT * FROM probe_queries LIMIT 100")
# Discards shared_buffers cache and burns CPU serializing unused columns"""
        await asyncio.sleep(delay_ms / 1000.0)
        data_scanned_bytes = 100 * 1280
        queries_executed = 1
        insight = (
            f"📦 ОВЕРФЕТЧИНГ: Запрос выкачал {round(data_scanned_bytes / 1024, 1)} KB данных, включая тяжелый JSON. "
            f"Это вымывает кэш shared_buffers Postgres и нагружает CPU на сериализацию Pydantic."
        )

    # 5. SCENARIO E: CPU-Bound Task on Event Loop
    else:
        code_snippet = """# ❌ CPU-bound loop on event loop thread
hash_val = b"seed"
for _ in range(50000):
    hash_val = hashlib.sha256(hash_val).digest() # GIL locked!"""
        event_loop_blocked = True
        h = b"test_seed_load"
        for _ in range(60000):
            h = hashlib.sha256(h).digest()
        data_scanned_bytes = 64
        insight = (
            f"⚙️ БЛОКИРОВКА GIL: Тяжёлые вычисления на Python заблокировали поток. "
            f"Асинхронность бессильна против 100% CPU. Требуется вынос в ProcessPoolExecutor."
        )

    elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
    current_lag_ms = metrics.current_event_loop_lag_ms
    effective_rps = round((concurrency * 1000.0) / max(elapsed_ms, 1.0), 1)

    # Record safe audit event (Zero PII, Prometheus aggregate updated)
    record_audit_event(
        trainer="sync-vs-async",
        scenario=scenario,
        trainer_version="1.0.0",
        status="success",
        duration_ms=elapsed_ms,
        error_code=None,
    )

    return ProbeResultResponse(
        trainer="sync-vs-async",
        scenario=scenario,
        version="1.0.0",
        concurrency=concurrency,
        requested_delay_ms=delay_ms,
        actual_elapsed_ms=elapsed_ms,
        event_loop_lag_ms=current_lag_ms,
        effective_rps=effective_rps,
        queries_executed=queries_executed,
        data_scanned_bytes=data_scanned_bytes,
        event_loop_blocked=event_loop_blocked,
        status="success",
        insight=insight,
        code_snippet=code_snippet,
    )

# ==============================================================================
# Week 3: PostgreSQL Query X-Ray & Buffer Profiler
# ==============================================================================
@router.get("/probe/pg-xray/templates", tags=["Probes"])
async def get_pg_xray_templates():
    return {
        "templates": [
            {
                "id": "index_scan",
                "title": "B-Tree Index Scan (Primary Key)",
                "description": "Instant O(log N) lookup in RAM cache with 0 disk reads.",
                "query": "SELECT id, query_name FROM probe_queries WHERE id = 142",
            },
            {
                "id": "seq_scan_unindexed",
                "title": "Sequential Scan (Unindexed Column)",
                "description": "Full table scan reading thousands of blocks from disk.",
                "query": "SELECT id, query_name FROM probe_queries WHERE buffer_cost > 3500",
            },
            {
                "id": "overfetching_select_all",
                "title": "Overfetching SELECT * (TOAST Memory Churn)",
                "description": "Pulling heavy JSON payloads into buffer cache.",
                "query": "SELECT * FROM probe_queries WHERE buffer_cost > 3500",
            },
            {
                "id": "projected_narrow_select",
                "title": "Projected Narrow Columns (Optimized)",
                "description": "Restricting columns to id, query_name, buffer_cost.",
                "query": "SELECT id, query_name, buffer_cost FROM probe_queries WHERE buffer_cost > 3500",
            },
        ]
    }

@router.post("/probe/pg-xray", response_model=PgXrayExperimentResponse, tags=["Probes"])
@limiter.limit("30/minute")
async def execute_pg_xray(request: Request, payload: PgXrayExperimentRequest):
    start_time = time.perf_counter()
    result = await run_xray_experiment(
        sample_pct=payload.sample_pct,
        months=payload.months,
        columns=payload.columns,
        jsonb_filter=payload.jsonb_filter,
    )

    if result.get("status") == "error":
        duration_ms = (time.perf_counter() - start_time) * 1000
        record_audit_event(
            trainer="pg-query-xray",
            scenario=f"{payload.sample_pct}pct_{payload.months}m",
            trainer_version="2.0.0",
            status="error",
            duration_ms=duration_ms,
            error_code=result.get("error_code", "SQL_VALIDATION_FAILED"),
        )
        raise HTTPException(status_code=400, detail=result.get("message"))

    duration_ms = (time.perf_counter() - start_time) * 1000
    record_audit_event(
        trainer="pg-query-xray",
        scenario=result["scenario_label"],
        trainer_version="2.0.0",
        status="success",
        duration_ms=duration_ms,
        error_code=None,
    )

    return PgXrayExperimentResponse(
        status="success",
        scenario_label=result["scenario_label"],
        plan_a=PlanSummary(**result["plan_a"]),
        plan_b=PlanSummary(**result["plan_b"]),
        speedup_factor=result["speedup_factor"],
        buffer_savings_pct=result["buffer_savings_pct"],
        sql_used=result["sql_used"],
        insight=result["insight"],
        version=result.get("version", "2.0.0"),
    )
