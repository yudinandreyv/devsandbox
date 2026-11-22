from html import escape

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from backend.app.core.config import settings
from backend.app.core.rate_limit import limiter

router = APIRouter()


class ContactPayload(BaseModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        value = value.strip()
        if value.count("@") != 1 or not value.split("@")[0] or not value.split("@")[1]:
            raise ValueError("invalid email address")
        return value


@router.post("/contact", status_code=status.HTTP_202_ACCEPTED, tags=["Contact"])
@limiter.limit(settings.CONTACT_RATE_LIMIT)
async def submit_contact(request: Request, payload: ContactPayload):
    if not (settings.RESEND_API_KEY and settings.CONTACT_FROM_EMAIL and settings.CONTACT_TO_EMAIL):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Contact email delivery is not configured",
        )

    html = f"<p><strong>Email:</strong> {escape(payload.email)}</p>"
    text = f"Email: {payload.email}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                json={
                    "from": settings.CONTACT_FROM_EMAIL,
                    "to": [settings.CONTACT_TO_EMAIL],
                    "reply_to": payload.email,
                    "subject": "DevSandbox contact request",
                    "html": html,
                    "text": text,
                },
            )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Email provider is unavailable",
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Email provider rejected the message",
        )

    return {"status": "accepted"}
