from pydantic import BaseModel, Field, field_validator
from typing import Optional, Any
from app.models.equipment import EquipmentCategory


def _parse_equipment_category(v: Any) -> EquipmentCategory:
    if isinstance(v, EquipmentCategory):
        return v
    try:
        return EquipmentCategory(v)
    except ValueError:
        return EquipmentCategory[v]


class EquipmentBase(BaseModel):
    name: str = Field(..., description="Nombre del equipo")
    category: EquipmentCategory = Field(..., description="Categoría del equipo")
    is_available: bool = Field(True, description="Disponibilidad del equipo")

    @field_validator('category', mode='before')
    @classmethod
    def _validate_category(cls, v):
        return _parse_equipment_category(v)


class EquipmentCreate(EquipmentBase):
    pass


class EquipmentUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[EquipmentCategory] = None
    is_available: Optional[bool] = None

    @field_validator('category', mode='before')
    @classmethod
    def _validate_category(cls, v):
        if v is None:
            return None
        return _parse_equipment_category(v)


class Equipment(EquipmentBase):
    id: str

    class Config:
        from_attributes = True
