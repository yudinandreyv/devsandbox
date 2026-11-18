import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from backend.app.core.config import settings
from backend.app.core.rate_limit import limiter, rate_limit_handler
from backend.app.core.security import SecurityHeadersMiddleware
from backend.app.core.audit import event_loop_lag_monitor
from backend.app.core.db import db_pool
from backend.app.api.v1.router import api_v1_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: start event loop lag background monitor & db pool
    lag_task = asyncio.create_task(event_loop_lag_monitor())
    await db_pool.connect()
    yield
    # Shutdown
    lag_task.cancel()
    await db_pool.disconnect()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Interactive backend sandbox, performance probes, and database analyzer",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# Attach state for slowapi
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Custom Security Headers
app.add_middleware(SecurityHeadersMiddleware)

# Prometheus Standard Root Metrics Endpoint (Scraped by Kubernetes ServiceMonitor)
@app.get("/metrics", tags=["Telemetry & Audit"], include_in_schema=False)
async def root_prometheus_metrics():
    from backend.app.core.audit import metrics
    from fastapi import Response
    content = metrics.to_prometheus_text()
    return Response(content=content, media_type="text/plain; version=0.0.4; charset=utf-8")

# API v1 Router
app.include_router(api_v1_router, prefix=settings.API_V1_PREFIX)

@app.get("/")
async def root():
    return {
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "api_docs": "/docs",
        "health": f"{settings.API_V1_PREFIX}/health",
        "metrics": f"{settings.API_V1_PREFIX}/metrics",
    }
