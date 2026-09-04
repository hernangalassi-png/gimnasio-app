from sqlalchemy import Column, String, Float, DateTime, JSON, Enum as SQLEnum
from sqlalchemy.orm import relationship
import uuid
import enum
from datetime import datetime
from app.core.database import Base


class PrimaryGoal(str, enum.Enum):
    HIPERTROFIA = "hipertrofia"
    DESCENSO_PESO = "descenso_peso"
    FUERZA = "fuerza"
    MOVILIDAD = "movilidad"
    SALUD_GENERAL = "salud_general"


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    face_embedding = Column(JSON, nullable=True)
    primary_goal = Column(SQLEnum(PrimaryGoal), nullable=True)
    physical_limitations = Column(JSON, nullable=True)
    target_rpe = Column(Float, default=7.0)
    created_at = Column(DateTime, default=datetime.utcnow)

    workout_logs = relationship("WorkoutLog", back_populates="user")
