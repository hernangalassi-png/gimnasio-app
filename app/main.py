import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.core.config import settings
from app.api.v1.api import api_router
from app.core.database import engine, Base, SessionLocal
from app.core.logging import log
from app.seed_data import seed_initial_data

log("STARTUP", "Iniciando backend", {"project": settings.PROJECT_NAME, "version": settings.VERSION})
_t0 = time.perf_counter()


def _ensure_exercise_columns():
    """Agrega columnas nuevas a exercises en Postgres y SQLite (DBs viejas)."""
    with SessionLocal() as db:
        dialect = db.bind.dialect.name
        if dialect == 'postgresql':
            db.execute(text("ALTER TABLE exercises ADD COLUMN IF NOT EXISTS exercise_type VARCHAR NOT NULL DEFAULT 'squat'"))
            db.execute(text("ALTER TABLE exercises ADD COLUMN IF NOT EXISTS suitable_goals JSON"))
            db.execute(text("ALTER TABLE exercises ADD COLUMN IF NOT EXISTS difficulty VARCHAR"))
            db.commit()
        elif dialect == 'sqlite':
            existing = {row[1] for row in db.execute(text("PRAGMA table_info(exercises)"))}
            if 'exercise_type' not in existing:
                db.execute(text("ALTER TABLE exercises ADD COLUMN exercise_type VARCHAR NOT NULL DEFAULT 'squat'"))
            if 'suitable_goals' not in existing:
                db.execute(text("ALTER TABLE exercises ADD COLUMN suitable_goals JSON"))
            if 'difficulty' not in existing:
                db.execute(text("ALTER TABLE exercises ADD COLUMN difficulty VARCHAR"))
            db.commit()


def _bootstrap_database():
    """
    Create tables, add missing columns y seed inicial.

    Se envuelve en try/except para que una DB caída (p.ej. la Postgres free de
    Render que expira a los 30 días) no impida que uvicorn bindee el puerto:
    el deploy queda healthy y /health/db reporta el error real.
    """
    t0 = time.perf_counter()
    try:
        Base.metadata.create_all(bind=engine)
        log("STARTUP", "create_all completado", {"elapsed_ms": round((time.perf_counter() - t0) * 1000, 1)})

        _ensure_exercise_columns()
        log("STARTUP", "_ensure_exercise_columns completado")

        seed_initial_data()
        log("STARTUP", "seed_initial_data completado")
    except Exception as e:
        log("STARTUP", "Bootstrap de DB FALLO; la app arranca igual, /health/db reportara el error", {"error": str(e)})


_bootstrap_database()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://gym.arenerasvig.com",
        "http://gym.arenerasvig.com",
        "http://localhost:5173",
        "https://gymvirtual.site",
        "http://gymvirtual.site",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API router
app.include_router(api_router, prefix=settings.API_V1_STR)
log("STARTUP", "Backend listo", {"total_startup_ms": round((time.perf_counter() - _t0) * 1000, 1)})


@app.get("/")
def root():
    return {
        "message": "Gimnasio App Backend API",
        "version": settings.VERSION,
        "docs": "/docs"
    }


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/health/db")
def health_db():
    t0 = time.perf_counter()
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        log("HEALTH", "DB check OK", {"elapsed_ms": round((time.perf_counter() - t0) * 1000, 1)})
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        log("HEALTH", "DB check ERROR", {"error": str(e)})
        return {"status": "error", "detail": str(e)}
