from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, Literal


class ParseSpeechRequest(BaseModel):
    """Petición para analizar el habla del usuario durante el registro"""
    step: Literal["asking_name", "asking_goal"] = Field(
        ..., description="Paso actual del flujo de registro"
    )
    transcript: str = Field(
        ..., min_length=1, description="Texto crudo capturado del micrófono"
    )
    context: Optional[Dict[str, Any]] = Field(
        default=None, description="Datos previos del flujo (ej. nombre ya guardado)"
    )


class ResolvedData(BaseModel):
    """Datos extraídos y normalizados por la IA"""
    name: Optional[str] = None
    goal: Optional[str] = None


class ParseSpeechResponse(BaseModel):
    """Respuesta estructurada del análisis de voz"""
    nextStep: Literal["asking_name", "asking_goal", "completed"] = Field(
        ..., description="Siguiente paso del flujo"
    )
    resolvedData: ResolvedData = Field(
        default_factory=ResolvedData, description="Datos resueltos por la IA"
    )
    aiMessage: str = Field(
        ..., description="Mensaje amigable que dirá el avatar por voz"
    )
