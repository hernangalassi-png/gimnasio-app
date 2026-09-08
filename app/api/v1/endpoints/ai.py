from fastapi import APIRouter

from app.schemas.ai import ParseSpeechRequest, ParseSpeechResponse
from app.services.ai_service import ai_service

router = APIRouter()


@router.post("/parse-speech", response_model=ParseSpeechResponse)
def parse_speech(request: ParseSpeechRequest):
    """
    Analiza el habla del usuario con IA durante el flujo de registro.

    - step='asking_name': extrae el nombre y avanza a 'asking_goal'
    - step='asking_goal': mapea el objetivo a una categoría estándar y completa el registro

    Si la IA falla o la respuesta es confusa, mantiene el paso actual y
    devuelve un mensaje pidiendo amablemente que repita.
    """
    print(f"🎤 parse-speech: step={request.step} transcript='{request.transcript}'")

    return ai_service.parse_speech(
        step=request.step,
        transcript=request.transcript,
        context=request.context,
    )
