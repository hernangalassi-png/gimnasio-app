from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Any
from datetime import datetime
from uuid import UUID
from app.models.session import SessionMode, SessionStatus


def _parse_session_mode(v: Any) -> SessionMode:
    if isinstance(v, SessionMode):
        return v
    try:
        return SessionMode(v)
    except ValueError:
        return SessionMode[v]


def _parse_session_status(v: Any) -> SessionStatus:
    if isinstance(v, SessionStatus):
        return v
    try:
        return SessionStatus(v)
    except ValueError:
        return SessionStatus[v]


class WorkoutSessionBase(BaseModel):
    session_mode: SessionMode = Field(..., description="Modo de sesión")
    user_ids: List[str] = Field(..., description="IDs de usuarios participantes")

    @field_validator('session_mode', mode='before')
    @classmethod
    def _validate_session_mode(cls, v):
        return _parse_session_mode(v)


class WorkoutSessionCreate(WorkoutSessionBase):
    pass


class WorkoutSessionUpdate(BaseModel):
    status: Optional[SessionStatus] = None
    ended_at: Optional[datetime] = None

    @field_validator('status', mode='before')
    @classmethod
    def _validate_status(cls, v):
        if v is None:
            return None
        return _parse_session_status(v)


class WorkoutSession(WorkoutSessionBase):
    id: UUID
    started_at: datetime
    ended_at: Optional[datetime]
    status: SessionStatus

    @field_validator('status', mode='before')
    @classmethod
    def _validate_status(cls, v):
        if v is None:
            return None
        return _parse_session_status(v)

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

    @field_validator('session_mode', mode='before')
    @classmethod
    def _validate_session_mode(cls, v):
        return _parse_session_mode(v)

    @field_validator('status', mode='before')
    @classmethod
    def _validate_status(cls, v):
        return _parse_session_status(v)
