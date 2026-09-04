from sqlalchemy import Column, String, Text, JSON
from sqlalchemy.orm import relationship
import uuid
from app.core.database import Base


class Exercise(Base):
    __tablename__ = "exercises"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    target_muscles = Column(JSON, nullable=True)
    required_equipment_ids = Column(JSON, nullable=True)
    avatar_animation_id = Column(String, nullable=True)
    pose_landmarks_config = Column(JSON, nullable=True)

    workout_logs = relationship("WorkoutLog", back_populates="exercise")
