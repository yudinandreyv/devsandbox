from pydantic import BaseModel, Field

class TelemetrySnapshot(BaseModel):
    session_id: str = Field(..., description="Unique client session UUID")
    probes_executed: int = Field(default=0, ge=0)
    bytes_scanned_kb: int = Field(default=0, ge=0)
    elapsed_seconds: int = Field(default=0, ge=0)
    client_locale: str = Field(default="en", pattern="^(en|ru)$")
    theme: str = Field(default="dark", pattern="^(light|dark)$")

class TelemetryResponse(BaseModel):
    status: str = "ok"
    synced: bool = True
    session_id: str
