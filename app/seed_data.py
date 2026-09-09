from sqlalchemy import text
from app.core.database import SessionLocal
from app.models.equipment import Equipment, EquipmentCategory
from app.models.exercise import Exercise


def _migrate_enum_values(db):
    """Convierte valores antiguos almacenados como nombres de enum a sus valores."""
    db.execute(text("""
        UPDATE equipment
        SET category = CASE category
            WHEN 'PESO_LIBRE' THEN 'peso_libre'
            WHEN 'PESO_CORPORAL' THEN 'peso_corporal'
            WHEN 'MAQUINA' THEN 'maquina'
            WHEN 'ACCESORIO' THEN 'accesorio'
            ELSE category
        END
    """))
    db.execute(text("""
        UPDATE users
        SET primary_goal = CASE primary_goal
            WHEN 'HIPERTROFIA' THEN 'hipertrofia'
            WHEN 'DESCENSO_PESO' THEN 'descenso_peso'
            WHEN 'FUERZA' THEN 'fuerza'
            WHEN 'MOVILIDAD' THEN 'movilidad'
            WHEN 'RESISTENCIA' THEN 'resistencia'
            WHEN 'SALUD_GENERAL' THEN 'salud_general'
            ELSE primary_goal
        END
    """))
    db.execute(text("""
        UPDATE workout_sessions
        SET session_mode = CASE session_mode
            WHEN 'SOLO' THEN 'solo'
            WHEN 'DUETO' THEN 'dueto'
            WHEN 'GRUPO' THEN 'grupo'
            ELSE session_mode
        END,
            status = CASE status
            WHEN 'IN_PROGRESS' THEN 'in_progress'
            WHEN 'COMPLETED' THEN 'completed'
            WHEN 'CANCELLED' THEN 'cancelled'
            ELSE status
        END
    """))


def seed_initial_data():
    db = SessionLocal()
    try:
        _migrate_enum_values(db)

        # Equipamiento base
        base_equipment = [
            {"id": "peso-corporal", "name": "Peso corporal", "category": EquipmentCategory.PESO_CORPORAL, "is_available": True},
            {"id": "mancuernas", "name": "Mancuernas", "category": EquipmentCategory.PESO_LIBRE, "is_available": True},
            {"id": "barras", "name": "Barras", "category": EquipmentCategory.PESO_LIBRE, "is_available": True},
            {"id": "banda-elastica", "name": "Banda elástica", "category": EquipmentCategory.ACCESORIO, "is_available": False},
        ]

        existing_equipment = {e.id for e in db.query(Equipment).all()}
        for eq in base_equipment:
            if eq["id"] not in existing_equipment:
                db.add(Equipment(**eq))

        # Ejercicios base
        base_exercises = [
            {
                "id": "sentadilla",
                "title": "Sentadilla",
                "description": "Baja empujando las caderas hacia atrás hasta que los muslos queden paralelos al piso y sube con los talones.",
                "target_muscles": ["cuádriceps", "glúteos"],
                "required_equipment_ids": [],
                "exercise_type": "squat",
                "suitable_goals": ["fuerza", "hipertrofia", "resistencia", "salud_general"],
                "difficulty": "principiante",
            },
            {
                "id": "sentadilla-con-mancuernas",
                "title": "Sentadilla con mancuernas",
                "description": "Sostén una mancuerna en cada mano a los costados. Baja controlado y sube empujando con los talones.",
                "target_muscles": ["cuádriceps", "glúteos"],
                "required_equipment_ids": ["mancuernas"],
                "exercise_type": "squat",
                "suitable_goals": ["fuerza", "hipertrofia"],
                "difficulty": "intermedio",
            },
            {
                "id": "sentadilla-con-barra",
                "title": "Sentadilla con barra",
                "description": "Colocá la barra sobre los trapecios, baja con la espalda recta y sube extendiendo caderas y rodillas.",
                "target_muscles": ["cuádriceps", "glúteos", "lumbar"],
                "required_equipment_ids": ["barras"],
                "exercise_type": "squat",
                "suitable_goals": ["fuerza", "hipertrofia"],
                "difficulty": "avanzado",
            },
            {
                "id": "flexiones",
                "title": "Flexiones",
                "description": "Apoyá las manos al ancho de hombros, mantené el cuerpo recto y bajá el pecho hasta casi tocar el piso.",
                "target_muscles": ["pecho", "tríceps", "hombros"],
                "required_equipment_ids": [],
                "exercise_type": "pushup",
                "suitable_goals": ["fuerza", "hipertrofia", "resistencia", "salud_general"],
                "difficulty": "principiante",
            },
            {
                "id": "flexiones-con-mancuernas",
                "title": "Flexiones con mancuernas",
                "description": "Apoyá las manos sobre las mancuernas para mayor amplitud. Mantené el cuerpo recto durante el movimiento.",
                "target_muscles": ["pecho", "tríceps", "hombros"],
                "required_equipment_ids": ["mancuernas"],
                "exercise_type": "pushup",
                "suitable_goals": ["fuerza", "hipertrofia"],
                "difficulty": "intermedio",
            },
        ]

        existing_exercises = {e.id for e in db.query(Exercise).all()}
        for ex in base_exercises:
            if ex["id"] not in existing_exercises:
                db.add(Exercise(**ex))

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[seed_data] Error seeding: {e}")
    finally:
        db.close()
