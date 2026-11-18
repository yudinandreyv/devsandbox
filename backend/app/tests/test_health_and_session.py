import pytest
from httpx import AsyncClient, ASGITransport
from backend.app.main import app

@pytest.mark.asyncio
async def test_health_check():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "dev-sandbox-api"

@pytest.mark.asyncio
async def test_guest_session_flow():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Create Guest Session
        resp = await client.post("/api/v1/session/guest")
        assert resp.status_code == 200
        data = resp.json()
        assert "session_id" in data
        assert "token" in data
        token = data["token"]
        
        # 2. Verify Session
        v_resp = await client.get("/api/v1/session/verify", headers={"Authorization": f"Bearer {token}"})
        assert v_resp.status_code == 200
        v_data = v_resp.json()
        assert v_data["valid"] is True
        assert v_data["session_id"] == data["session_id"]
        assert v_data["role"] == "guest"

@pytest.mark.asyncio
async def test_probe_catalog():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/v1/probe/catalog")
        assert resp.status_code == 200
        probes = resp.json().get("probes", [])
        assert len(probes) >= 4
        ids = [p["id"] for p in probes]
        assert "sync-vs-async" in ids
        assert "pg-query-xray" in ids

@pytest.mark.asyncio
async def test_io_benchmark_probe_scenarios():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Async DB pool
        resp = await client.get("/api/v1/probe/io-benchmark?scenario=async_db_pool&delay_ms=10&concurrency=5")
        assert resp.status_code == 200
        data = resp.json()
        assert data["scenario"] == "async_db_pool"
        assert data["status"] == "success"
        assert data["event_loop_blocked"] is False
        assert "insight" in data
        assert "code_snippet" in data

        # 2. N+1 Trap
        resp_n1 = await client.get("/api/v1/probe/io-benchmark?scenario=n_plus_one_trap&concurrency=5")
        assert resp_n1.status_code == 200
        assert resp_n1.json()["queries_executed"] == 20

@pytest.mark.asyncio
async def test_prometheus_metrics():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/v1/metrics")
        assert resp.status_code == 200
        content = resp.text
        assert "probe_runs_total" in content
        assert "event_loop_lag_ms" in content
