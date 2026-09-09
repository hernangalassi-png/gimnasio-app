from sqlalchemy import Column, String, Boolean, Enum as SQLEnum
import uuid
import enum
from app.core.database import Base


class EquipmentCategory(str, enum.Enum):
    PESO_LIBRE = "peso_libre"
    PESO_CORPORAL = "peso_corporal"
    MAQUINA = "maquina"
    ACCESORIO = "accesorio"


class Equipment(Base):
    __tablename__ = "equipment"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    category = Column(SQLEnum(EquipmentCategory, values_callable=lambda x: [e.value for e in x]), nullable=False)
    is_available = Column(Boolean, default=True)
