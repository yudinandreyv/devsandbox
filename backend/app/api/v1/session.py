import uuid
from fastapi import APIRouter, Request, Response, Header
from pydantic import BaseModel
from typing import Optional
from backend.app.core.security import generate_guest_token, verify_guest_token
from backend.app.core.telemetry import TelemetrySnapshot, TelemetryResponse

router = APIRouter()

class GuestSessionResponse(BaseModel):
    session_id: str
    token: str
    role: str = "guest"
    message: str

@router.post("/session/guest", response_model=GuestSessionResponse, tags=["Session"])
async def create_guest_session(response: Response):
    session_id = str(uuid.uuid4())
    token = generate_guest_token(session_id)
    
    # Store token in cookie as well for seamless browser usage
    response.set_cookie(
        key="sandbox_guest_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # Can be True in HTTPS prod
        max_age=86400 * 30, # 30 days
    )
    
    return GuestSessionResponse(
        session_id=session_id,
        token=token,
        role="guest",
        message="Guest session initialized with read-only sandbox scope",
    )

@router.get("/session/verify", tags=["Session"])
async def verify_session(authorization: Optional[str] = Header(None)):
    if not authorization:
        return {"valid": False, "role": "anonymous"}
    
    token = authorization.replace("Bearer ", "").strip()
    session_id = verify_guest_token(token)
    if not session_id:
        return {"valid": False, "role": "anonymous"}
    
    return {
        "valid": True,
        "session_id": session_id,
        "role": "guest",
        "limits": {
            "max_query_time_ms": 1500,
            "max_concurrent_probes": 2,
            "read_only": True,
        }
    }

@router.post("/telemetry/sync", response_model=TelemetryResponse, tags=["Telemetry"])
async def sync_telemetry(payload: TelemetrySnapshot):
    # Logs or persists telemetry snapshot while keeping privacy intact
    return TelemetryResponse(status="ok", synced=True, session_id=payload.session_id)
