from sqlalchemy import Column, String, DateTime, Enum as SQLEnum, JSON
from sqlalchemy.orm import relationship
import uuid
import enum
from datetime import datetime
from app.core.database import Base


class SessionMode(str, enum.Enum):
    SOLO = "solo"
    DUETO = "dueto"
    GRUPO = "grupo"


class SessionStatus(str, enum.Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class WorkoutSession(Base):
    __tablename__ = "workout_sessions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_mode = Column(SQLEnum(SessionMode, values_callable=lambda x: [e.value for e in x]), nullable=False)
    user_ids = Column(JSON, nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    status = Column(SQLEnum(SessionStatus, values_callable=lambda x: [e.value for e in x]), default=SessionStatus.IN_PROGRESS)

    workout_logs = relationship("WorkoutLog", back_populates="session")
