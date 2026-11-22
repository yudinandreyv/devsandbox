from fastapi import APIRouter
from backend.app.api.v1.health import router as health_router
from backend.app.api.v1.session import router as session_router
from backend.app.api.v1.probe import router as probe_router
from backend.app.api.v1.blue_green import router as blue_green_router
from backend.app.api.v1.rag import router as rag_router
from backend.app.api.v1.contact import router as contact_router

api_v1_router = APIRouter()

api_v1_router.include_router(health_router)
api_v1_router.include_router(session_router)
api_v1_router.include_router(probe_router)
api_v1_router.include_router(blue_green_router)
api_v1_router.include_router(rag_router)
api_v1_router.include_router(contact_router)
