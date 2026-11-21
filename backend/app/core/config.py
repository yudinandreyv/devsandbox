from typing import List
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "DevSandbox API"
    VERSION: str = "1.0.0"
    API_V1_PREFIX: str = "/api/v1"
    APP_ENV: str = "development"
    
    # Domain & Security
    SITE_DOMAIN: str = "gateaway.cloud"
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://gateaway.cloud",
    ]
    SESSION_SECRET: str = "local-development-only-insecure-session-key"
    
    # Rate Limiting
    RATE_LIMIT_GLOBAL: str = "120/minute"
    RATE_LIMIT_PROBE: str = "20/minute"
    
    # Database Sandbox Limits
    DB_STATEMENT_TIMEOUT_MS: int = 1500
    DATABASE_READONLY_URL: str = ""

    @model_validator(mode="after")
    def require_production_session_secret(self) -> "Settings":
        if self.APP_ENV == "production" and (
            not self.SESSION_SECRET
            or self.SESSION_SECRET == "local-development-only-insecure-session-key"
        ):
            raise ValueError("SESSION_SECRET must be set to a secure value in production")
        return self

    model_config = SettingsConfigDict(
        case_sensitive=True,
        env_file=".env",
        extra="ignore"
    )

settings = Settings()
