from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from datetime import datetime
from app.core.database import get_db
from app.models.session import WorkoutSession as WorkoutSessionModel, SessionMode, SessionStatus
from app.models.workout_log import WorkoutLog as WorkoutLogModel
from app.schemas.session import WorkoutSession, SessionStartRequest, SessionSummary
from app.schemas.workout_log import LogSetRequest, WorkoutLog

router = APIRouter()


@router.post("/start", response_model=WorkoutSession)
def start_session(request: SessionStartRequest, db: Session = Depends(get_db)):
    # Determine session mode based on number of users
    if len(request.user_ids) == 1:
        session_mode = SessionMode.SOLO
    elif len(request.user_ids) == 2:
        session_mode = SessionMode.DUETO
    else:
        raise HTTPException(status_code=400, detail="Only 1 or 2 users allowed")
    
    db_session = WorkoutSessionModel(
        session_mode=session_mode,
        user_ids=request.user_ids,
        status=SessionStatus.IN_PROGRESS
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session


@router.post("/{session_id}/log_set", response_model=WorkoutLog)
def log_set(session_id: UUID, request: LogSetRequest, db: Session = Depends(get_db)):
    # Verify session exists and is in progress
    session = db.query(WorkoutSessionModel).filter(WorkoutSessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="Session is not in progress")
    
    # Verify user is in the session
    if str(request.user_id) not in session.user_ids:
        raise HTTPException(status_code=400, detail="User is not part of this session")
    
    db_log = WorkoutLogModel(
        session_id=session_id,
        user_id=request.user_id,
        exercise_id=request.exercise_id,
        set_number=request.set_number,
        target_reps=request.target_reps,
        completed_reps=request.completed_reps,
        weight_used_kg=request.weight_used_kg,
        rpe_reported=request.rpe_reported
    )
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    return db_log


@router.post("/{session_id}/end", response_model=SessionSummary)
def end_session(session_id: UUID, db: Session = Depends(get_db)):
    session = db.query(WorkoutSessionModel).filter(WorkoutSessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="Session is not in progress")
    
    # Update session status and end time
    session.status = SessionStatus.COMPLETED
    session.ended_at = datetime.utcnow()
    db.commit()
    
    # Calculate summary
    logs = db.query(WorkoutLogModel).filter(WorkoutLogModel.session_id == session_id).all()
    
    total_sets = len(logs)
    total_volume_kg = sum(
        (log.weight_used_kg or 0) * log.completed_reps 
        for log in logs
    )
    
    return SessionSummary(
        session_id=session.id,
        session_mode=session.session_mode,
        user_ids=session.user_ids,
        started_at=session.started_at,
        ended_at=session.ended_at,
        status=session.status,
        total_sets=total_sets,
        total_volume_kg=total_volume_kg
    )


@router.get("/{session_id}", response_model=WorkoutSession)
def get_session(session_id: UUID, db: Session = Depends(get_db)):
    session = db.query(WorkoutSessionModel).filter(WorkoutSessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/", response_model=List[WorkoutSession])
def get_sessions(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    sessions = db.query(WorkoutSessionModel).offset(skip).limit(limit).all()
    return sessions
