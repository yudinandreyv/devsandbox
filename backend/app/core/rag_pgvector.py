"""Voice-to-Action & RAG on pgvector simulation core engine.

Simulates:
- Whisper Speech-to-Text inference (voice audio chunk transcription to action intent)
- Vector embedding generation (semantic projection in d-dimensional space)
- pgvector index comparison: HNSW (Hierarchical Navigable Small World) vs IVFFlat (Inverted File Flat) vs Exact Cosine KNN (<=>)
- Accuracy (Recall@k), index build latency, QPS throughput, and memory buffer usage
"""
import math
import random
import time
from typing import List, Dict, Any, Optional, Literal

_RNG = random.Random(42)

# Knowledge Base of DevSandbox Documentation & Incident Playbooks
KNOWLEDGE_BASE = [
    {
        "id": "doc_event_loop_lag",
        "title": "FastAPI Event Loop Freeze & Thread Starvation",
        "category": "HighLoad Architecture",
        "content": "Синхронный вызов time.sleep() или блокирующий драйвер psycopg2 внутри async def полностью замораживает системный поток Event Loop. Решение: вынос в ProcessPoolExecutor или переход на asyncpg/asyncio.sleep().",
        "action": "TRIGGER_BENCHMARK_SYNC_BLOCKING",
        "action_label": "Запустить бенчмарк блокировки Event Loop",
        "keywords": ["event loop", "заморозка", "time sleep", "блокировка", "асинхронность", "поток", "лаг"],
        "base_vector": [0.82, 0.15, 0.05, 0.91, 0.34, 0.12],
    },
    {
        "id": "doc_pg_shared_buffers",
        "title": "PostgreSQL Shared Buffers & TOAST Overfetching",
        "category": "Database Engineering",
        "content": "Запрос SELECT * выкачивает тяжелые JSONB атрибуты из внешней памяти TOAST, вытесняя горячие страницы из shared_buffers и провоцируя массовый shared read. Решение: явная проекция нужных колонок.",
        "action": "TRIGGER_PG_XRAY_OVERFETCHING",
        "action_label": "Перейти в PostgreSQL X-Ray: TOAST Overfetching",
        "keywords": ["shared buffers", "toast", "select all", "оверфетчинг", "буферы", "память", "postgres"],
        "base_vector": [0.12, 0.88, 0.45, 0.22, 0.85, 0.08],
    },
    {
        "id": "doc_blue_green_rollback",
        "title": "Zero-Downtime Rollback & Connection Drain",
        "category": "DevOps & CI/CD",
        "content": "При росте 502 Bad Gateway или падении подов в CrashLoopBackOff шлюз обязан мгновенно вернуть 100% веса на теплый слот Blue, удерживая preStop дренаж сокетов.",
        "action": "TRIGGER_BLUE_GREEN_ROLLBACK",
        "action_label": "Выполнить экстренный Rollback на Blue",
        "keywords": ["rollback", "откат", "blue green", "деплой", "502", "дренаж", "шлюз", "трафик"],
        "base_vector": [0.05, 0.21, 0.95, 0.14, 0.31, 0.89],
    },
    {
        "id": "doc_pg_vector_hnsw",
        "title": "pgvector: HNSW Graph vs IVFFlat Centroid Partitioning",
        "category": "AI / RAG Infrastructure",
        "content": "HNSW строит многоуровневый граф связей между векторами, обеспечивая Recall > 99% на любых объемах без предварительного обучения центроидов, но требует в 5 раз больше shared_buffers чем IVFFlat.",
        "action": "EXPLAIN_HNSW_VS_IVFFLAT",
        "action_label": "Сравнить Recall@10 и построение индекса HNSW",
        "keywords": ["hnsw", "ivfflat", "pgvector", "вектор", "косинусное", "эмбеддинг", "rag"],
        "base_vector": [0.42, 0.65, 0.38, 0.78, 0.92, 0.55],
    },
    {
        "id": "doc_slow_query_tuning",
        "title": "Seq Scan Selectivity Cutoff & B-Tree Optimization",
        "category": "Database Engineering",
        "content": "Если предикат WHERE отбирает более 15-20% строк таблицы, планировщик PostgreSQL сознательно отказывается от B-Tree индекса в пользу Seq Scan из-за меньшей стоимости последовательного I/O.",
        "action": "TRIGGER_PG_XRAY_POINT_LOOKUP",
        "action_label": "Показать порог селективности Seq Scan",
        "keywords": ["seq scan", "селективность", "b-tree", "индекс", "explain analyze", "планировщик"],
        "base_vector": [0.18, 0.92, 0.25, 0.31, 0.74, 0.15],
    },
]

VOICE_COMMAND_PRESETS = [
    {
        "id": "cmd_rollback",
        "phrase": "Сделай экстренный откат на Blue из-за пятисотых ошибок",
        "audio_duration_s": 2.4,
        "whisper_confidence": 0.985,
        "transcription": "Сделай экстренный откат на Blue из-за 500 ошибок",
        "detected_intent": "TRIGGER_BLUE_GREEN_ROLLBACK",
    },
    {
        "id": "cmd_freeze",
        "phrase": "Покажи почему зависает FastAPI воркер на time sleep",
        "audio_duration_s": 3.1,
        "whisper_confidence": 0.972,
        "transcription": "Покажи почему зависает FastAPI воркер на time.sleep",
        "detected_intent": "TRIGGER_BENCHMARK_SYNC_BLOCKING",
    },
    {
        "id": "cmd_toast",
        "phrase": "Почему SELECT звёздочка убивает shared buffers в PostgreSQL",
        "audio_duration_s": 2.8,
        "whisper_confidence": 0.964,
        "transcription": "Почему SELECT * убивает shared buffers в PostgreSQL",
        "detected_intent": "TRIGGER_PG_XRAY_OVERFETCHING",
    },
    {
        "id": "cmd_hnsw",
        "phrase": "Сравни точность поиска HNSW против IVFFlat",
        "audio_duration_s": 2.2,
        "whisper_confidence": 0.991,
        "transcription": "Сравни точность поиска HNSW против IVFFlat в pgvector",
        "detected_intent": "EXPLAIN_HNSW_VS_IVFFLAT",
    },
]


def _cosine_similarity(v1: List[float], v2: List[float]) -> float:
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return round(dot / (norm1 * norm2), 4)


def _text_to_pseudo_vector(text: str) -> List[float]:
    """Deterministic semantic hashing vector for zero-dependency high-speed simulation."""
    text_lower = text.lower()
    weights = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1]
    for doc in KNOWLEDGE_BASE:
        for kw in doc["keywords"]:
            if kw in text_lower:
                for i in range(len(weights)):
                    weights[i] += doc["base_vector"][i] * 1.5
    norm = math.sqrt(sum(w * w for w in weights))
    if norm == 0:
        return [0.1] * 6
    return [round(w / norm, 4) for w in weights]


def simulate_pgvector_search(
    query_text: str,
    index_type: Literal["hnsw", "ivfflat", "exact_scan"] = "hnsw",
    top_k: int = 3,
    probes_or_ef_search: int = 40,
) -> Dict[str, Any]:
    t0 = time.perf_counter()
    query_vector = _text_to_pseudo_vector(query_text)

    # Calculate exact cosine similarities
    scored_docs = []
    for doc in KNOWLEDGE_BASE:
        sim = _cosine_similarity(query_vector, doc["base_vector"])
        # Add slight noise depending on index approximation
        if index_type == "ivfflat":
            sim = max(0.0, min(1.0, sim * (1.0 - (100 - probes_or_ef_search) * 0.0015)))
        elif index_type == "hnsw":
            sim = max(0.0, min(1.0, sim * (1.0 - (100 - probes_or_ef_search) * 0.0003)))
        scored_docs.append({
            "id": doc["id"],
            "title": doc["title"],
            "category": doc["category"],
            "content": doc["content"],
            "action": doc["action"],
            "action_label": doc["action_label"],
            "similarity": round(sim, 4),
            "distance": round(1.0 - sim, 4),
        })

    scored_docs.sort(key=lambda d: d["similarity"], reverse=True)
    top_matches = scored_docs[:top_k]

    # Index metrics benchmark profile
    if index_type == "hnsw":
        latency_ms = round(0.42 + (probes_or_ef_search / 200.0) + _RNG.uniform(0.01, 0.08), 2)
        recall_pct = round(min(99.8, 94.0 + (probes_or_ef_search * 0.05)), 1)
        build_time_s = 4.2
        ram_usage_mb = 18.5
        qps_throughput = int(2400 - probes_or_ef_search * 10)
        index_spec = f"HNSW (m=16, ef_construction=64, ef_search={probes_or_ef_search})"
    elif index_type == "ivfflat":
        latency_ms = round(1.15 + (probes_or_ef_search / 80.0) + _RNG.uniform(0.05, 0.15), 2)
        recall_pct = round(min(96.5, 82.0 + (probes_or_ef_search * 0.12)), 1)
        build_time_s = 0.8
        ram_usage_mb = 4.2
        qps_throughput = int(950 - probes_or_ef_search * 4)
        index_spec = f"IVFFlat (lists=100, probes={probes_or_ef_search})"
    else:  # exact sequential vector scan
        latency_ms = round(14.8 + _RNG.uniform(0.5, 1.2), 2)
        recall_pct = 100.0
        build_time_s = 0.0
        ram_usage_mb = 1.1
        qps_throughput = 65
        index_spec = "Exact Sequential Scan (<=> Cosine Distance)"

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

    top_action = top_matches[0]["action"] if top_matches and top_matches[0]["similarity"] > 0.45 else None
    top_action_label = top_matches[0]["action_label"] if top_matches and top_matches[0]["similarity"] > 0.45 else None

    return {
        "query": query_text,
        "index_type": index_type,
        "index_spec": index_spec,
        "top_matches": top_matches,
        "latency_ms": latency_ms,
        "search_time_total_ms": elapsed_ms,
        "recall_pct": recall_pct,
        "build_time_s": build_time_s,
        "ram_usage_mb": ram_usage_mb,
        "qps_throughput": qps_throughput,
        "recommended_action": top_action,
        "recommended_action_label": top_action_label,
    }


def transcribe_voice_audio(
    preset_id: Optional[str] = None,
    custom_transcript: Optional[str] = None,
) -> Dict[str, Any]:
    t0 = time.perf_counter()
    if preset_id:
        preset = next((p for p in VOICE_COMMAND_PRESETS if p["id"] == preset_id), VOICE_COMMAND_PRESETS[0])
        transcript = preset["transcription"]
        confidence = preset["whisper_confidence"]
        audio_dur = preset["audio_duration_s"]
    else:
        transcript = custom_transcript or "Сделай экстренный откат на Blue"
        confidence = 0.965
        audio_dur = 2.0

    inference_ms = round(45.0 + len(transcript) * 1.2 + _RNG.uniform(2, 8), 1)

    # Perform RAG retrieval on transcribed query
    rag_result = simulate_pgvector_search(query_text=transcript, index_type="hnsw", top_k=2)

    return {
        "status": "success",
        "audio_duration_s": audio_dur,
        "whisper_model": "whisper-medium.en-ru",
        "inference_latency_ms": inference_ms,
        "confidence_score": confidence,
        "transcription": transcript,
        "action_intent": rag_result["recommended_action"],
        "action_label": rag_result["recommended_action_label"],
        "rag_context": rag_result["top_matches"],
        "rag_latency_ms": rag_result["latency_ms"],
        "total_turnaround_ms": round(inference_ms + rag_result["latency_ms"], 2),
    }
