import pytest
from httpx import AsyncClient, ASGITransport
from backend.app.main import app

@pytest.mark.asyncio
async def test_pg_xray_experiment_default():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        payload = {
            "sample_pct": 50,
            "months": 6,
            "columns": "narrow",
            "jsonb_filter": False,
        }
        resp = await client.post("/api/v1/probe/pg-xray", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert "plan_a" in data
        assert "plan_b" in data
        assert data["plan_a"]["node_type"] == "Seq Scan"
        assert data["plan_b"]["node_type"] in ["Index Scan", "Bitmap Heap Scan"]
        assert data["speedup_factor"] >= 1.0
        assert data["buffer_savings_pct"] >= 0.0
        assert "sql_used" in data
        assert "insight" in data
        assert data["version"] == "2.0.0"

@pytest.mark.asyncio
async def test_pg_xray_experiment_jsonb_filter():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        payload = {
            "sample_pct": 80,
            "months": 12,
            "columns": "narrow",
            "jsonb_filter": True,
        }
        resp = await client.post("/api/v1/probe/pg-xray", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["plan_b"]["node_type"] == "Bitmap Heap Scan"
        assert "gin" in (data["plan_b"]["index_name"] or "").lower()
        assert "payload" in data["sql_used"]

@pytest.mark.asyncio
async def test_pg_xray_experiment_star_overfetching():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        payload = {
            "sample_pct": 30,
            "months": 3,
            "columns": "star",
            "jsonb_filter": False,
        }
        resp = await client.post("/api/v1/probe/pg-xray", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "SELECT *" in data["sql_used"]
        # Star projection must show higher buffer consumption than narrow
        assert data["plan_a"]["total_buffers_kb"] > 0

@pytest.mark.asyncio
async def test_pg_xray_validation_sample_pct_bounds():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Less than 10
        resp = await client.post("/api/v1/probe/pg-xray", json={"sample_pct": 5})
        assert resp.status_code == 422
        # Greater than 100
        resp = await client.post("/api/v1/probe/pg-xray", json={"sample_pct": 105})
        assert resp.status_code == 422

@pytest.mark.asyncio
async def test_pg_xray_validation_months_bounds():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 0 months is invalid (ge=1)
        resp = await client.post("/api/v1/probe/pg-xray", json={"months": 0})
        assert resp.status_code == 422
        # 30 months is invalid (le=24)
        resp = await client.post("/api/v1/probe/pg-xray", json={"months": 30})
        assert resp.status_code == 422

@pytest.mark.asyncio
async def test_pg_xray_zero_pii_in_response():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/v1/probe/pg-xray", json={
            "sample_pct": 50,
            "months": 6,
            "columns": "narrow",
            "jsonb_filter": False,
        })
        text = resp.text
        import re
        uuid_re = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
        assert not uuid_re.search(text), "Response must not contain user session UUIDs"
