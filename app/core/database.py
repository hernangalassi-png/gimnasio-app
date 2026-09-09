import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# Render (y algunos proveedores) entregan DATABASE_URL con el esquema 'postgres://'.
# SQLAlchemy requiere 'postgresql://' para psycopg2, así que normalizamos sin romper SQLite.
database_url = settings.DATABASE_URL
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if "sqlite" in database_url else {}
engine_options = {"connect_args": connect_args}
if "sqlite" not in database_url:
    engine_options["pool_pre_ping"] = True
    engine_options["pool_recycle"] = 300
    engine_options["pool_size"] = int(os.environ.get("DB_POOL_SIZE", "5"))
    engine_options["max_overflow"] = int(os.environ.get("DB_MAX_OVERFLOW", "10"))

engine = create_engine(database_url, **engine_options)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
