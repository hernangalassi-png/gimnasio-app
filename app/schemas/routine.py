from pydantic import BaseModel, Field
from typing import List, Optional
from app.schemas.exercise import Exercise


class RoutineRecommendRequest(BaseModel):
    user_id: str = Field(..., description="ID del usuario para personalizar la rutina")
    available_equipment_ids: Optional[List[str]] = Field(None, description="IDs de equipos disponibles; si es null se usan los marcados como disponibles en la base")
