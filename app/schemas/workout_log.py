from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class WorkoutLogBase(BaseModel):
    session_id: UUID = Field(..., description="ID de la sesión")
    user_id: UUID = Field(..., description="ID del usuario")
    exercise_id: UUID = Field(..., description="ID del ejercicio")
    set_number: int = Field(..., ge=1, description="Número de serie")
    target_reps: int = Field(..., ge=1, description="Repeticiones objetivo")
    completed_reps: int = Field(..., ge=0, description="Repeticiones completadas")
    weight_used_kg: Optional[float] = Field(None, ge=0, description="Peso usado en kg")
    rpe_reported: Optional[int] = Field(None, ge=1, le=10, description="RPE reportado (1-10)")


class WorkoutLogCreate(WorkoutLogBase):
    pass


class WorkoutLogUpdate(BaseModel):
    completed_reps: Optional[int] = Field(None, ge=0)
    weight_used_kg: Optional[float] = Field(None, ge=0)
    rpe_reported: Optional[int] = Field(None, ge=1, le=10)


class WorkoutLog(WorkoutLogBase):
    id: UUID
    timestamp: datetime

    class Config:
        from_attributes = True


class LogSetRequest(BaseModel):
    user_id: UUID = Field(..., description="ID del usuario")
    exercise_id: UUID = Field(..., description="ID del ejercicio")
    set_number: int = Field(..., ge=1, description="Número de serie")
    target_reps: int = Field(..., ge=1, description="Repeticiones objetivo")
    completed_reps: int = Field(..., ge=0, description="Repeticiones completadas")
    weight_used_kg: Optional[float] = Field(None, ge=0, description="Peso usado en kg")
    rpe_reported: Optional[int] = Field(None, ge=1, le=10, description="RPE reportado (1-10)")
