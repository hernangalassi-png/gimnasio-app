from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from app.core.database import get_db
from app.models.exercise import Exercise as ExerciseModel
from app.schemas.exercise import Exercise, ExerciseCreate, ExerciseUpdate

router = APIRouter()


@router.post("/", response_model=Exercise)
def create_exercise(exercise: ExerciseCreate, db: Session = Depends(get_db)):
    db_exercise = ExerciseModel(**exercise.model_dump())
    db.add(db_exercise)
    db.commit()
    db.refresh(db_exercise)
    return db_exercise


@router.get("/", response_model=List[Exercise])
def get_exercises(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    exercises = db.query(ExerciseModel).offset(skip).limit(limit).all()
    return exercises


@router.get("/{exercise_id}", response_model=Exercise)
def get_exercise(exercise_id: UUID, db: Session = Depends(get_db)):
    exercise = db.query(ExerciseModel).filter(ExerciseModel.id == exercise_id).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    return exercise


@router.put("/{exercise_id}", response_model=Exercise)
def update_exercise(exercise_id: UUID, exercise: ExerciseUpdate, db: Session = Depends(get_db)):
    db_exercise = db.query(ExerciseModel).filter(ExerciseModel.id == exercise_id).first()
    if not db_exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    update_data = exercise.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_exercise, field, value)
    
    db.commit()
    db.refresh(db_exercise)
    return db_exercise


@router.delete("/{exercise_id}")
def delete_exercise(exercise_id: UUID, db: Session = Depends(get_db)):
    db_exercise = db.query(ExerciseModel).filter(ExerciseModel.id == exercise_id).first()
    if not db_exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    db.delete(db_exercise)
    db.commit()
    return {"message": "Exercise deleted successfully"}
