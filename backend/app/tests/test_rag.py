import pytest
from httpx import ASGITransport, AsyncClient
from backend.app.main import app

pytestmark = pytest.mark.asyncio(loop_scope="session")
BASE = "/api/v1/probe/rag"

async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

@pytest.mark.asyncio
async def test_rag_presets():
    async with await _client() as client:
        r = await client.get(f"{BASE}/presets")
    assert r.status_code == 200
    data = r.json()
    assert "voice_presets" in data
    assert len(data["voice_presets"]) >= 4
    assert "knowledge_topics" in data
    assert len(data["knowledge_topics"]) >= 5

@pytest.mark.asyncio
async def test_rag_search_hnsw():
    async with await _client() as client:
        r = await client.post(
            f"{BASE}/search",
            json={
                "query": "Как избежать заморозки Event Loop на time sleep",
                "index_type": "hnsw",
                "top_k": 3,
                "probes_or_ef_search": 40,
            },
        )
    assert r.status_code == 200
    data = r.json()
    assert data["index_type"] == "hnsw"
    assert len(data["top_matches"]) == 3
    assert data["recall_pct"] >= 90.0
    assert data["latency_ms"] < 5.0
    # Top match should identify the event loop doc
    assert "event_loop" in data["top_matches"][0]["id"]
    assert data["recommended_action"] == "TRIGGER_BENCHMARK_SYNC_BLOCKING"

@pytest.mark.asyncio
async def test_rag_search_ivfflat():
    async with await _client() as client:
        r = await client.post(
            f"{BASE}/search",
            json={
                "query": "SELECT * overfetching toast shared buffers",
                "index_type": "ivfflat",
                "top_k": 2,
                "probes_or_ef_search": 20,
            },
        )
    assert r.status_code == 200
    data = r.json()
    assert data["index_type"] == "ivfflat"
    assert len(data["top_matches"]) == 2
    assert "toast" in data["top_matches"][0]["id"] or "shared" in data["top_matches"][0]["id"]

@pytest.mark.asyncio
async def test_rag_search_exact_scan():
    async with await _client() as client:
        r = await client.post(
            f"{BASE}/search",
            json={
                "query": "Rollback blue green авария 502",
                "index_type": "exact_scan",
                "top_k": 1,
            },
        )
    assert r.status_code == 200
    data = r.json()
    assert data["recall_pct"] == 100.0
    assert data["recommended_action"] == "TRIGGER_BLUE_GREEN_ROLLBACK"

@pytest.mark.asyncio
async def test_rag_voice_transcribe():
    async with await _client() as client:
        r = await client.post(
            f"{BASE}/voice-transcribe",
            json={"preset_id": "cmd_rollback"},
        )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "success"
    assert data["confidence_score"] > 0.95
    assert data["action_intent"] == "TRIGGER_BLUE_GREEN_ROLLBACK"
    assert len(data["rag_context"]) >= 1

@pytest.mark.asyncio
async def test_rag_zero_pii():
    async with await _client() as client:
        r = await client.get(f"{BASE}/presets")
    text = r.text
    assert "user_id" not in text
    assert "session_id" not in text
    assert "token" not in text
