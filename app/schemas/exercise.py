from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID


class ExerciseBase(BaseModel):
    title: str = Field(..., description="Título del ejercicio")
    description: Optional[str] = Field(None, description="Descripción del ejercicio")
    target_muscles: Optional[List[str]] = Field(None, description="Músculos objetivo")
    required_equipment_ids: Optional[List[str]] = Field(None, description="IDs de equipos requeridos")
    avatar_animation_id: Optional[str] = Field(None, description="ID de animación 3D")
    pose_landmarks_config: Optional[dict] = Field(None, description="Configuración de puntos clave MediaPipe")


class ExerciseCreate(ExerciseBase):
    pass


class ExerciseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    target_muscles: Optional[List[str]] = None
    required_equipment_ids: Optional[List[str]] = None
    avatar_animation_id: Optional[str] = None
    pose_landmarks_config: Optional[dict] = None


class Exercise(ExerciseBase):
    id: UUID

    class Config:
        from_attributes = True
