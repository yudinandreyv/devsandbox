"""Voice-to-Action & RAG on pgvector API endpoints.

Routes:
- GET  /api/v1/probe/rag/presets          — List voice command audio presets & knowledge base topics
- POST /api/v1/probe/rag/search           — Query pgvector index (HNSW vs IVFFlat vs Exact Scan)
- POST /api/v1/probe/rag/voice-transcribe — Transcribe audio input with Whisper and resolve to action
"""
from typing import List, Dict, Any, Optional, Literal
from fastapi import APIRouter, Request, Query, Body, HTTPException
from pydantic import BaseModel, Field

from backend.app.core.audit import record_audit_event
from backend.app.core.rate_limit import limiter
from backend.app.core.rag_pgvector import (
    KNOWLEDGE_BASE,
    VOICE_COMMAND_PRESETS,
    simulate_pgvector_search,
    transcribe_voice_audio,
)

router = APIRouter(prefix="/probe/rag", tags=["Voice-to-Action & RAG"])

TRAINER_NAME = "voice-rag-pgvector"
VERSION = "1.0.0"


class RagSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=300)
    index_type: Literal["hnsw", "ivfflat", "exact_scan"] = Field(default="hnsw")
    top_k: int = Field(default=3, ge=1, le=5)
    probes_or_ef_search: int = Field(default=40, ge=5, le=100)


class VoiceTranscribeRequest(BaseModel):
    preset_id: Optional[str] = Field(default=None)
    custom_transcript: Optional[str] = Field(default=None, max_length=300)


@router.get("/presets", tags=["Voice-to-Action & RAG"])
async def get_rag_presets():
    return {
        "voice_presets": VOICE_COMMAND_PRESETS,
        "knowledge_topics": [
            {"id": d["id"], "title": d["title"], "category": d["category"]}
            for d in KNOWLEDGE_BASE
        ],
    }


@router.post("/search", tags=["Voice-to-Action & RAG"])
@limiter.limit("45/minute")
async def rag_vector_search(request: Request, payload: RagSearchRequest):
    result = simulate_pgvector_search(
        query_text=payload.query,
        index_type=payload.index_type,
        top_k=payload.top_k,
        probes_or_ef_search=payload.probes_or_ef_search,
    )
    record_audit_event(
        trainer=TRAINER_NAME,
        scenario=f"search_{payload.index_type}",
        trainer_version=VERSION,
        status="success",
        duration_ms=result["latency_ms"],
    )
    return result


@router.post("/voice-transcribe", tags=["Voice-to-Action & RAG"])
@limiter.limit("30/minute")
async def rag_voice_transcribe(request: Request, payload: VoiceTranscribeRequest):
    result = transcribe_voice_audio(
        preset_id=payload.preset_id,
        custom_transcript=payload.custom_transcript,
    )
    record_audit_event(
        trainer=TRAINER_NAME,
        scenario="voice_whisper_action",
        trainer_version=VERSION,
        status="success",
        duration_ms=result["total_turnaround_ms"],
    )
    return result
