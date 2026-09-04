import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.orm import Session
from app.core.database import engine, SessionLocal, Base
from app.models.user import User, PrimaryGoal
from app.models.equipment import Equipment, EquipmentCategory
from app.models.exercise import Exercise


def seed_database():
    # Create all tables
    Base.metadata.create_all(bind=engine)
    
    db: Session = SessionLocal()
    
    try:
        # Check if data already exists
        if db.query(User).count() > 0:
            print("Database already seeded. Skipping...")
            return
        
        # Create Users (2 family members)
        user1 = User(
            name="Juan Pérez",
            primary_goal=PrimaryGoal.HIPERTROFIA,
            physical_limitations=["rodilla_derecha"],
            target_rpe=7.5
        )
        user2 = User(
            name="María García",
            primary_goal=PrimaryGoal.SALUD_GENERAL,
            physical_limitations=[],
            target_rpe=6.5
        )
        db.add(user1)
        db.add(user2)
        db.flush()
        
        print(f"[OK] Created users: {user1.name}, {user2.name}")
        
        # Create Equipment (3 typical home equipment)
        equipment1 = Equipment(
            name="Mancuernas 10kg",
            category=EquipmentCategory.PESO_LIBRE,
            is_available=True
        )
        equipment2 = Equipment(
            name="Banda elástica media",
            category=EquipmentCategory.ACCESORIO,
            is_available=True
        )
        equipment3 = Equipment(
            name="Barra dominadas",
            category=EquipmentCategory.PESO_CORPORAL,
            is_available=True
        )
        db.add(equipment1)
        db.add(equipment2)
        db.add(equipment3)
        db.flush()
        
        print(f"[OK] Created equipment: {equipment1.name}, {equipment2.name}, {equipment3.name}")
        
        # Create Exercises (5 basic exercises)
        exercise1 = Exercise(
            title="Sentadillas",
            description="Ejercicio de piernas fundamental para fortalecer cuádriceps y glúteos",
            target_muscles=["cuádriceps", "glúteos", "isquiotibiales"],
            required_equipment_ids=[],
            avatar_animation_id="squat_anim_001",
            pose_landmarks_config={
                "keypoints": ["left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"],
                "count_reps": True
            }
        )
        exercise2 = Exercise(
            title="Flexiones de brazos",
            description="Ejercicio de pecho y tríceps usando peso corporal",
            target_muscles=["pectoral", "tríceps", "deltoides"],
            required_equipment_ids=[],
            avatar_animation_id="pushup_anim_001",
            pose_landmarks_config={
                "keypoints": ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist"],
                "count_reps": True
            }
        )
        exercise3 = Exercise(
            title="Dominadas",
            description="Ejercicio de espalda usando barra de dominadas",
            target_muscles=["dorsales", "bíceps", "trapecio"],
            required_equipment_ids=[str(equipment3.id)],
            avatar_animation_id="pullup_anim_001",
            pose_landmarks_config={
                "keypoints": ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow"],
                "count_reps": True
            }
        )
        exercise4 = Exercise(
            title="Press de hombro con mancuernas",
            description="Ejercicio de hombros usando mancuernas",
            target_muscles=["deltoides", "tríceps"],
            required_equipment_ids=[str(equipment1.id)],
            avatar_animation_id="shoulder_press_anim_001",
            pose_landmarks_config={
                "keypoints": ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist"],
                "count_reps": True
            }
        )
        exercise5 = Exercise(
            title="Remo con banda elástica",
            description="Ejercicio de espalda usando banda elástica",
            target_muscles=["dorsales", "bíceps", "trapecio"],
            required_equipment_ids=[str(equipment2.id)],
            avatar_animation_id="band_row_anim_001",
            pose_landmarks_config={
                "keypoints": ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow"],
                "count_reps": True
            }
        )
        db.add(exercise1)
        db.add(exercise2)
        db.add(exercise3)
        db.add(exercise4)
        db.add(exercise5)
        
        db.commit()
        
        print(f"[OK] Created exercises: {exercise1.title}, {exercise2.title}, {exercise3.title}, {exercise4.title}, {exercise5.title}")
        print("\n[OK] Database seeded successfully!")
        
    except Exception as e:
        db.rollback()
        print(f"[ERROR] Error seeding database: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
