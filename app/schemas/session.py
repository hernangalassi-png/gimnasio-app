from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from uuid import UUID
from app.models.session import SessionMode, SessionStatus


class WorkoutSessionBase(BaseModel):
    session_mode: SessionMode = Field(..., description="Modo de sesión")
    user_ids: List[str] = Field(..., description="IDs de usuarios participantes")


class WorkoutSessionCreate(WorkoutSessionBase):
    pass


class WorkoutSessionUpdate(BaseModel):
    status: Optional[SessionStatus] = None
    ended_at: Optional[datetime] = None


class WorkoutSession(WorkoutSessionBase):
    id: UUID
    started_at: datetime
    ended_at: Optional[datetime]
    status: SessionStatus

    class Config:
        from_attributes = True


class SessionStartRequest(BaseModel):
    user_ids: List[str] = Field(..., min_items=1, max_items=2, description="IDs de usuarios (1 o 2)")


class SessionSummary(BaseModel):
    session_id: UUID
    session_mode: SessionMode
    user_ids: List[str]
    started_at: datetime
    ended_at: Optional[datetime]
    status: SessionStatus
    total_sets: int
    total_volume_kg: float
