from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
import numpy as np
from app.core.database import get_db
from app.core.logging import log
from app.models.user import User as UserModel
from app.schemas.user import User, UserCreate, UserUpdate, UserIdentify, UserQuickRegister, UserIdentifyResponse

router = APIRouter()


@router.post("/", response_model=User)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = UserModel(**user.model_dump())
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@router.get("/", response_model=List[User])
def get_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    users = db.query(UserModel).offset(skip).limit(limit).all()
    return users


@router.get("/{user_id}", response_model=User)
def get_user(user_id: UUID, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/{user_id}", response_model=User)
def update_user(user_id: UUID, user: UserUpdate, db: Session = Depends(get_db)):
    db_user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_data = user.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_user, field, value)
    
    db.commit()
    db.refresh(db_user)
    return db_user


@router.delete("/{user_id}")
def delete_user(user_id: UUID, db: Session = Depends(get_db)):
    db_user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    db.delete(db_user)
    db.commit()
    return {"message": "User deleted successfully"}


@router.post("/identify", response_model=UserIdentifyResponse)
def identify_user(user_data: UserIdentify, db: Session = Depends(get_db)):
    """Identifica un usuario mediante su embedding facial usando cosine similarity"""
    import time
    t0 = time.perf_counter()
    log("IDENTIFY", "Request recibido", {"embedding_len": len(user_data.face_embedding)})

    users = db.query(UserModel).filter(UserModel.face_embedding.isnot(None)).all()
    log("IDENTIFY", "Usuarios con embedding en DB", {"count": len(users), "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1)})

    if not users:
        log("IDENTIFY", "Sin usuarios registrados -> identified=False")
        return UserIdentifyResponse(identified=False, user=None)

    target_embedding = np.array(user_data.face_embedding)
    best_match = None
    best_similarity = 0.0
    threshold = 0.6  # Umbral de similitud para considerar una coincidencia

    for user in users:
        if user.face_embedding:
            user_embedding = np.array(user.face_embedding)
            # Cosine similarity
            similarity = np.dot(target_embedding, user_embedding) / (
                np.linalg.norm(target_embedding) * np.linalg.norm(user_embedding)
            )
            log("IDENTIFY", "Similarity", {"user": user.name, "similarity": round(float(similarity), 4)})

            if similarity > best_similarity and similarity > threshold:
                best_similarity = similarity
                best_match = user

    elapsed = round((time.perf_counter() - t0) * 1000, 1)
    if best_match:
        log("IDENTIFY", "Usuario identificado", {"user": best_match.name, "similarity": round(float(best_similarity), 4), "elapsed_ms": elapsed})
        return UserIdentifyResponse(identified=True, user=best_match)

    log("IDENTIFY", "No identificado (bajo threshold)", {"best_similarity": round(float(best_similarity), 4), "elapsed_ms": elapsed})
    return UserIdentifyResponse(identified=False, user=None)


@router.post("/quick-register", response_model=User)
def quick_register(user_data: UserQuickRegister, db: Session = Depends(get_db)):
    """Registro rápido de un nuevo usuario con embedding facial"""
    log("QUICK_REGISTER", "Registrando usuario", {"name": user_data.name, "goal": user_data.primary_goal, "rpe": user_data.target_rpe})
    db_user = UserModel(
        name=user_data.name,
        face_embedding=user_data.face_embedding,
        primary_goal=user_data.primary_goal,
        target_rpe=user_data.target_rpe
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    log("QUICK_REGISTER", "Usuario creado", {"id": str(db_user.id), "name": db_user.name})
    return db_user
