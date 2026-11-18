import asyncpg
import logging
from typing import Optional, List, Dict, Any
from backend.app.core.config import settings

logger = logging.getLogger(__name__)

class DatabasePool:
    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        try:
            self.pool = await asyncpg.create_pool(
                dsn=settings.DATABASE_READONLY_URL,
                min_size=2,
                max_size=10,
                command_timeout=settings.DB_STATEMENT_TIMEOUT_MS / 1000.0,
            )
            logger.info("Connected to PostgreSQL Sandbox pool")
        except Exception as e:
            logger.warning(f"PostgreSQL connection offline (falling back to sandbox memory engine): {e}")
            self.pool = None

    async def disconnect(self):
        if self.pool:
            await self.pool.close()

db_pool = DatabasePool()

# In-memory sandbox dataset (mirrors probe_queries for local standalone mode)
SANDBOX_DEMO_ROWS = [
    {
        "id": i,
        "query_name": f"query_bench_{i}",
        "payload": '{"metadata": {"trace_id": "' + f"trace_{i:04d}" + '", "tags": ["highload", "event_loop", "audit"]}, "details": "Simulated heavy JSON payload with 1024 bytes of diagnostic metadata for testing buffer churn and overfetching impact in FastAPI and Postgres."}',
        "buffer_cost": (i * 37) % 5000,
    }
    for i in range(1, 251)
]
