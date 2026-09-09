from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.core.config import settings
from app.api.v1.api import api_router
from app.core.database import engine, Base, SessionLocal
from app.seed_data import seed_initial_data


# Create database tables
Base.metadata.create_all(bind=engine)


def _ensure_exercise_columns():
    with SessionLocal() as db:
        dialect = db.bind.dialect.name
        if dialect == 'postgresql':
            db.execute(text("ALTER TABLE exercises ADD COLUMN IF NOT EXISTS exercise_type VARCHAR NOT NULL DEFAULT 'squat'"))
            db.execute(text("ALTER TABLE exercises ADD COLUMN IF NOT EXISTS suitable_goals JSON"))
            db.execute(text("ALTER TABLE exercises ADD COLUMN IF NOT EXISTS difficulty VARCHAR"))
            db.commit()


_ensure_exercise_columns()
seed_initial_data()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    debug=True
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
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}
