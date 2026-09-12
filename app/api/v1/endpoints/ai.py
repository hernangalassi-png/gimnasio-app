from fastapi import APIRouter

from app.core.logging import log
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
    import time
    t0 = time.perf_counter()
    log("AI", "parse-speech request", {"step": request.step, "transcript": request.transcript})

    result = ai_service.parse_speech(
        step=request.step,
        transcript=request.transcript,
        context=request.context,
    )
    log("AI", "parse-speech response", {"result": result.model_dump() if hasattr(result, 'model_dump') else result, "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1)})
    return result
