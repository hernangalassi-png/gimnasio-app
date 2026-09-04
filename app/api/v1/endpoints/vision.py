from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID
from app.core.database import get_db
from app.services.vision.face_recognizer import face_recognition_service
from app.services.vision.pose_counter import pose_tracker_service
from pydantic import BaseModel

router = APIRouter()


class PoseProcessRequest(BaseModel):
    exercise_type: str  # "squat" or "pushup"


@router.post("/register-face/{user_id}")
async def register_face(
    user_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Register a face image for a user.
    """
    try:
        image_bytes = await file.read()
        embedding = face_recognition_service.register_user_face(user_id, image_bytes, db)
        
        return {
            "message": "Face registered successfully",
            "user_id": user_id,
            "embedding_length": len(embedding)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/identify")
async def identify_face(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Identify a user from a face image.
    """
    try:
        image_bytes = await file.read()
        user_id = face_recognition_service.identify_user(image_bytes, db=db)
        
        if user_id:
            return {
                "user_id": user_id,
                "recognized": True
            }
        else:
            return {
                "user_id": None,
                "recognized": False,
                "message": "No face recognized or no users registered"
            }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/process-pose")
async def process_pose(
    file: UploadFile = File(...),
    exercise_type: str = Form("squat")
):
    """
    Process a video frame for pose estimation and exercise counting.
    """
    try:
        image_bytes = await file.read()
        result = pose_tracker_service.process_frame(image_bytes, exercise_type)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/reset-counter")
async def reset_counter():
    """
    Reset the exercise counter.
    """
    try:
        pose_tracker_service.reset_counter()
        return {
            "message": "Counter reset successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))