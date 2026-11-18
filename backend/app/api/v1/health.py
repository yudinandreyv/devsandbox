from fastapi import APIRouter
from datetime import datetime, timezone

router = APIRouter()

@router.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "service": "dev-sandbox-api",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "1.0.0",
        "mode": "guest-sandbox",
    }

@router.get("/ready", tags=["Health"])
async def readiness_check():
    # Ready probe for Kubernetes
    return {"status": "ready"}
