from sqlalchemy import Column, DateTime, Integer, Float, ForeignKey, String
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime
from app.core.database import Base


class WorkoutLog(Base):
    __tablename__ = "workout_logs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("workout_sessions.id"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    exercise_id = Column(String(36), ForeignKey("exercises.id"), nullable=False)
    set_number = Column(Integer, nullable=False)
    target_reps = Column(Integer, nullable=False)
    completed_reps = Column(Integer, nullable=False)
    weight_used_kg = Column(Float, nullable=True)
    rpe_reported = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

    session = relationship("WorkoutSession", back_populates="workout_logs")
    user = relationship("User", back_populates="workout_logs")
    exercise = relationship("Exercise", back_populates="workout_logs")
