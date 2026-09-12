from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from app.core.database import get_db
from app.core.logging import log
from app.models.equipment import Equipment as EquipmentModel
from app.schemas.equipment import Equipment, EquipmentCreate, EquipmentUpdate

router = APIRouter()


@router.post("/", response_model=Equipment)
def create_equipment(equipment: EquipmentCreate, db: Session = Depends(get_db)):
    db_equipment = EquipmentModel(**equipment.model_dump())
    db.add(db_equipment)
    db.commit()
    db.refresh(db_equipment)
    return db_equipment


@router.get("/", response_model=List[Equipment])
def get_equipment(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    import time
    t0 = time.perf_counter()
    equipment = db.query(EquipmentModel).offset(skip).limit(limit).all()
    log("EQUIPMENT", "GET /equipment", {"count": len(equipment), "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1)})
    return equipment


@router.get("/{equipment_id}", response_model=Equipment)
def get_equipment_by_id(equipment_id: UUID, db: Session = Depends(get_db)):
    equipment = db.query(EquipmentModel).filter(EquipmentModel.id == equipment_id).first()
    if not equipment:
        raise HTTPException(status_code=404, detail="Equipment not found")
    return equipment


@router.put("/{equipment_id}", response_model=Equipment)
def update_equipment(equipment_id: UUID, equipment: EquipmentUpdate, db: Session = Depends(get_db)):
    db_equipment = db.query(EquipmentModel).filter(EquipmentModel.id == equipment_id).first()
    if not db_equipment:
        raise HTTPException(status_code=404, detail="Equipment not found")
    
    update_data = equipment.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_equipment, field, value)
    
    db.commit()
    db.refresh(db_equipment)
    return db_equipment


@router.delete("/{equipment_id}")
def delete_equipment(equipment_id: UUID, db: Session = Depends(get_db)):
    db_equipment = db.query(EquipmentModel).filter(EquipmentModel.id == equipment_id).first()
    if not db_equipment:
        raise HTTPException(status_code=404, detail="Equipment not found")
    
    db.delete(db_equipment)
    db.commit()
    return {"message": "Equipment deleted successfully"}
