from fastapi import APIRouter
from app.api.v1.endpoints import users, equipment, exercises, sessions, vision, voice, ai

api_router = APIRouter()

api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(equipment.router, prefix="/equipment", tags=["equipment"])
api_router.include_router(exercises.router, prefix="/exercises", tags=["exercises"])
api_router.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
api_router.include_router(vision.router, prefix="/vision", tags=["vision"])
api_router.include_router(voice.router, prefix="/voice", tags=["voice"])
api_router.include_router(ai.router, prefix="/ai", tags=["ai"])
