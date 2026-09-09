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
    exercise_type: str = Field(..., description="Tipo de ejercicio para el contador de poses, ej. squat o pushup")
    suitable_goals: Optional[List[str]] = Field(None, description="Objetivos para los que se recomienda el ejercicio")
    difficulty: Optional[str] = Field(None, description="Dificultad del ejercicio: principiante, intermedio, avanzado")


class ExerciseCreate(ExerciseBase):
    pass


class ExerciseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    target_muscles: Optional[List[str]] = None
    required_equipment_ids: Optional[List[str]] = None
    avatar_animation_id: Optional[str] = None
    pose_landmarks_config: Optional[dict] = None
    exercise_type: Optional[str] = None
    suitable_goals: Optional[List[str]] = None
    difficulty: Optional[str] = None


class Exercise(ExerciseBase):
    id: UUID

    class Config:
        from_attributes = True
