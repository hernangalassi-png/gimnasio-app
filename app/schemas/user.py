from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from uuid import UUID
from app.models.user import PrimaryGoal


class UserBase(BaseModel):
    name: str = Field(..., description="Nombre del usuario")
    face_embedding: Optional[List[float]] = Field(None, description="Vector de características faciales")
    primary_goal: Optional[PrimaryGoal] = Field(None, description="Objetivo principal de entrenamiento")
    physical_limitations: Optional[List[str]] = Field(None, description="Lista de limitaciones físicas")
    target_rpe: float = Field(7.0, description="RPE objetivo (1-10)")


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    name: Optional[str] = None
    face_embedding: Optional[List[float]] = None
    primary_goal: Optional[PrimaryGoal] = None
    physical_limitations: Optional[List[str]] = None
    target_rpe: Optional[float] = None


class User(UserBase):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class UserIdentify(BaseModel):
    face_embedding: List[float] = Field(..., description="Vector de características faciales para identificar")


class UserQuickRegister(BaseModel):
    name: str = Field(..., description="Nombre del usuario")
    face_embedding: List[float] = Field(..., description="Vector de características faciales")
    primary_goal: Optional[PrimaryGoal] = Field(None, description="Objetivo principal de entrenamiento")
    target_rpe: float = Field(7.0, description="RPE objetivo (1-10)")


class UserIdentifyResponse(BaseModel):
    identified: bool = Field(..., description="Si se identificó el usuario")
    user: Optional[User] = Field(None, description="Datos del usuario si fue identificado")
