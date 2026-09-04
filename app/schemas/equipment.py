from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID
from app.models.equipment import EquipmentCategory


class EquipmentBase(BaseModel):
    name: str = Field(..., description="Nombre del equipo")
    category: EquipmentCategory = Field(..., description="Categoría del equipo")
    is_available: bool = Field(True, description="Disponibilidad del equipo")


class EquipmentCreate(EquipmentBase):
    pass


class EquipmentUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[EquipmentCategory] = None
    is_available: Optional[bool] = None


class Equipment(EquipmentBase):
    id: UUID

    class Config:
        from_attributes = True
