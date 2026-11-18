"""Tests for /api/v1/probe/blue-green/* routes."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.main import app

pytestmark = pytest.mark.asyncio(loop_scope="session")

BASE = "/api/v1/probe/blue-green"


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ---------------------------------------------------------------------------
# /scenarios
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_scenarios():
    async with await _client() as client:
        r = await client.get(f"{BASE}/scenarios")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 7
    ids = {s["id"] for s in data}
    assert {
        "canary_10",
        "50_50",
        "full_cutover",
        "rollback",
        "bad_gateway_502",
        "drain_connections",
        "auto_rollback",
    }.issubset(ids)
    for s in data:
        assert "label_en" in s
        assert "label_ru" in s
        assert "initial_blue_weight" in s


# ---------------------------------------------------------------------------
# /topology
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_topology_default():
    async with await _client() as client:
        r = await client.get(f"{BASE}/topology")
    assert r.status_code == 200
    data = r.json()
    assert data["trainer"] == "blue-green"
    assert data["scenario"] == "canary_10"
    assert "blue" in data and "green" in data and "gateway" in data
    assert data["blue"]["weight"] + data["green"]["weight"] == 100
    assert data["gateway"]["dropped_packets"] == 0


@pytest.mark.asyncio
async def test_topology_rollback_scenario():
    async with await _client() as client:
        r = await client.get(f"{BASE}/topology?scenario=rollback")
    assert r.status_code == 200
    data = r.json()
    assert data["scenario"] == "rollback"
    # In rollback: blue should be 100 % initially
    assert data["blue"]["weight"] == 100


@pytest.mark.asyncio
async def test_topology_unknown_scenario_fallback():
    """Unknown scenario should fall back to canary_10, not 404."""
    async with await _client() as client:
        r = await client.get(f"{BASE}/topology?scenario=does_not_exist")
    assert r.status_code == 200
    assert r.json()["scenario"] == "canary_10"


# ---------------------------------------------------------------------------
# /shift
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_shift_basic():
    async with await _client() as client:
        r = await client.post(
            f"{BASE}/shift",
            json={"blue_weight": 50, "scenario": "50_50"},
        )
    assert r.status_code == 200
    data = r.json()
    assert data["new_blue_weight"] == 50
    assert data["new_green_weight"] == 50
    assert data["dropped_packets"] == 0
    assert data["trainer"] == "blue-green"
    assert isinstance(data["duration_ms"], float)
    assert data["duration_ms"] > 0


@pytest.mark.asyncio
async def test_shift_full_cutover():
    async with await _client() as client:
        r = await client.post(
            f"{BASE}/shift",
            json={"blue_weight": 0, "scenario": "full_cutover"},
        )
    assert r.status_code == 200
    data = r.json()
    assert data["new_blue_weight"] == 0
    assert data["new_green_weight"] == 100
    assert data["dropped_packets"] == 0


@pytest.mark.asyncio
async def test_shift_weights_sum_to_100():
    async with await _client() as client:
        r = await client.post(
            f"{BASE}/shift",
            json={"blue_weight": 30, "scenario": "canary_10"},
        )
    data = r.json()
    assert data["new_blue_weight"] + data["new_green_weight"] == 100


@pytest.mark.asyncio
async def test_shift_state_persists_to_topology():
    """After shifting, topology should reflect the new weight."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            f"{BASE}/shift",
            json={"blue_weight": 70, "scenario": "canary_10"},
        )
        topo = await client.get(f"{BASE}/topology?scenario=canary_10")
    data = topo.json()
    assert data["blue"]["weight"] == 70
    assert data["green"]["weight"] == 30


@pytest.mark.asyncio
async def test_shift_invalid_weight_422():
    """Weight > 100 should be rejected."""
    async with await _client() as client:
        r = await client.post(
            f"{BASE}/shift",
            json={"blue_weight": 110, "scenario": "canary_10"},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_topology_gateway_no_pii():
    """Confirm gateway response contains no user IDs or session tokens."""
    async with await _client() as client:
        r = await client.get(f"{BASE}/topology")
    text = r.text
    # Must not contain UUID-shaped values used as session keys
    import re
    uuid_re = re.compile(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I
    )
    assert not uuid_re.search(text), "Response must not contain UUID-shaped values"


@pytest.mark.asyncio
async def test_bad_gateway_502_dropped_packets():
    """Under 502/504 scenario, gateway dropped packets must reflect upstream failure."""
    async with await _client() as client:
        r = await client.post(
            f"{BASE}/shift",
            json={"blue_weight": 50, "scenario": "bad_gateway_502"},
        )
    assert r.status_code == 200
    data = r.json()
    assert data["dropped_packets"] > 0
    assert data["shift_safe"] is False
    assert "502/504" in data["insight"]


@pytest.mark.asyncio
async def test_drain_connections_terminating():
    """Under graceful drain scenario, blue pods are marked Terminating."""
    async with await _client() as client:
        r = await client.post(
            f"{BASE}/shift",
            json={"blue_weight": 0, "scenario": "drain_connections"},
        )
    assert r.status_code == 200
    data = r.json()
    assert data["blue"]["pods"][0]["status"] == "Terminating"
    assert "ДРЕНАЖ" in data["insight"] or "DRAIN" in data["insight"].upper()


@pytest.mark.asyncio
async def test_auto_rollback_triggers():
    """Auto rollback scenario enforces 100% blue weight upon error detection."""
    async with await _client() as client:
        r = await client.post(
            f"{BASE}/shift",
            json={"blue_weight": 40, "scenario": "auto_rollback"},
        )
    assert r.status_code == 200
    data = r.json()
    assert data["new_blue_weight"] == 100
    assert data["new_green_weight"] == 0
    assert "АВТООТКАТ" in data["insight"]
