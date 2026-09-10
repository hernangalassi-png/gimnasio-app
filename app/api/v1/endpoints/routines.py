from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.core.database import get_db
from app.models.user import User as UserModel
from app.models.equipment import Equipment as EquipmentModel
from app.models.exercise import Exercise as ExerciseModel
from app.schemas.exercise import Exercise
from app.schemas.routine import RoutineRecommendRequest

router = APIRouter()


def _difficulty_to_number(difficulty: Optional[str]) -> int:
    mapping = {"principiante": 1, "intermedio": 2, "avanzado": 3}
    return mapping.get(difficulty or "", 99)


def _rpe_to_level(target_rpe: float) -> str:
    if target_rpe <= 6:
        return "principiante"
    if target_rpe <= 8:
        return "intermedio"
    return "avanzado"


@router.post("/recommend")
def recommend_routine(payload: RoutineRecommendRequest, db: Session = Depends(get_db)):
    """Devuelve ejercicios filtrados según el perfil del usuario y el equipamiento disponible."""
    try:
        user = db.query(UserModel).filter(UserModel.id == payload.user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Equipamiento disponible
        if payload.available_equipment_ids is not None:
            available_ids = set(payload.available_equipment_ids)
        else:
            available_ids = {
                e.id for e in db.query(EquipmentModel).filter(EquipmentModel.is_available == True).all()
            }

        # Incluir siempre peso corporal
        available_ids.add("peso-corporal")

        exercises = db.query(ExerciseModel).all()
        user_goal = user.primary_goal or "salud_general"
        user_level = _rpe_to_level(user.target_rpe or 7.0)

        def _matches(ex: ExerciseModel) -> bool:
            # Equipamiento requerido cubierto
            required = set(ex.required_equipment_ids or [])
            if not required.issubset(available_ids):
                return False
            # Objetivo compatible
            suitable = ex.suitable_goals or []
            if suitable and user_goal not in suitable:
                return False
            return True

        filtered = [ex for ex in exercises if _matches(ex)]

        # Ordenar: priorizar dificultad cercana al nivel del usuario, luego dificultad ascendente
        level_order = _difficulty_to_number(user_level)

        def _sort_key(ex: ExerciseModel):
            diff = _difficulty_to_number(ex.difficulty)
            return (abs(diff - level_order), diff)

        filtered.sort(key=_sort_key)
        return filtered
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
