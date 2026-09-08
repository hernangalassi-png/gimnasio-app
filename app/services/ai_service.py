import json
import re
from typing import Optional, Dict, Any

from app.core.config import settings
from app.schemas.ai import ParseSpeechResponse, ResolvedData

try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    genai = None
    GENAI_AVAILABLE = False


VALID_GOALS = {
    "fuerza": "fuerza",
    "hipertrofia": "hipertrofia",
    "resistencia": "resistencia",
    "salud_general": "salud_general",
    "salud general": "salud_general",
    "salud": "salud_general",
    "bajar de peso": "descenso_peso",
    "perder peso": "descenso_peso",
    "adelgazar": "descenso_peso",
    "descenso_peso": "descenso_peso",
    "movilidad": "movilidad",
    "flexibilidad": "movilidad",
    "ponerme en forma": "salud_general",
    "musculo": "hipertrofia",
    "músculo": "hipertrofia",
    "volumen": "hipertrofia",
    "cardio": "resistencia",
    "aguante": "resistencia",
}


class AIService:
    """Servicio de procesamiento de lenguaje natural con Gemini para el flujo de registro."""

    def __init__(self):
        self._model = None
        if GENAI_AVAILABLE and settings.GEMINI_API_KEY:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            self._model = genai.GenerativeModel(settings.GEMINI_MODEL)

    @property
    def available(self) -> bool:
        return self._model is not None

    def _build_prompt(self, step: str, transcript: str, context: Optional[Dict[str, Any]]) -> str:
        context_str = json.dumps(context or {}, ensure_ascii=False)

        if step == "asking_name":
            instructions = (
                "El usuario está diciendo su nombre. Extrae ÚNICAMENTE el nombre de pila "
                "de forma limpia y capitalizada (ej. 'Me llamo Hernán' -> 'Hernán', "
                "'soy maria' -> 'María'). Si no puedes identificar un nombre claro, "
                "devuelve name como null.\n"
                "Si extraes el nombre: nextStep='asking_goal' y aiMessage debe confirmar "
                "el nombre amigablemente y preguntar su objetivo de entrenamiento "
                "(fuerza, hipertrofia, resistencia o salud general).\n"
                "Si NO extraes el nombre: nextStep='asking_name' y aiMessage debe pedir "
                "amablemente que repita su nombre."
            )
        else:  # asking_goal
            instructions = (
                "El usuario está diciendo su objetivo de entrenamiento. Mapea su respuesta "
                "a UNA de estas categorías exactas: 'fuerza', 'hipertrofia', 'resistencia', "
                "'salud_general'. Si no puedes mapear la respuesta, devuelve goal como null.\n"
                "Si mapeas el objetivo: nextStep='completed' y aiMessage debe dar la "
                "bienvenida y confirmar el registro exitoso usando el nombre del contexto "
                "si está disponible.\n"
                "Si NO mapeas el objetivo: nextStep='asking_goal' y aiMessage debe pedir "
                "amablemente que repita su objetivo, mencionando las opciones."
            )

        return f"""Eres un asistente de registro de gimnasio. Analiza el habla del usuario.

PASO ACTUAL: {step}
TRANSCRIPT DEL USUARIO: "{transcript}"
CONTEXTO PREVIO: {context_str}

INSTRUCCIONES:
{instructions}

Responde ÚNICAMENTE con un JSON válido (sin markdown, sin texto extra) con esta estructura exacta:
{{
  "nextStep": "asking_name" | "asking_goal" | "completed",
  "resolvedData": {{"name": "..." o null, "goal": "..." o null}},
  "aiMessage": "mensaje amigable en español para que el avatar lo diga por voz"
}}"""

    def _extract_json(self, text: str) -> Optional[Dict[str, Any]]:
        """Extrae JSON de la respuesta del LLM, tolerando bloques markdown."""
        cleaned = text.strip()
        # Quitar fences de markdown si existen
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None

    def _normalize_goal(self, goal: Optional[str]) -> Optional[str]:
        if not goal:
            return None
        normalized = goal.strip().lower()
        return VALID_GOALS.get(normalized, normalized if normalized in VALID_GOALS.values() else None)

    def _extract_name_local(self, transcript: str) -> Optional[str]:
        """Extracción local de nombre sin IA (fallback)."""
        cleaned = re.sub(
            r"(me llamo|mi nombre es|soy|llámame|llamame|dime|es)",
            "",
            transcript.lower(),
        ).strip()
        # Quitar puntuación y quedarse con la primera palabra válida
        cleaned = re.sub(r"[^\wáéíóúñü\s]", "", cleaned)
        words = [w for w in cleaned.split() if len(w) >= 2]
        if not words:
            return None
        return " ".join(words[:2]).title()

    def _extract_goal_local(self, transcript: str) -> Optional[str]:
        """Mapeo local de objetivo sin IA (fallback)."""
        text = transcript.lower()
        for keyword, goal in VALID_GOALS.items():
            if keyword in text:
                return goal
        return None

    def _local_fallback(
        self, step: str, transcript: str, context: Optional[Dict[str, Any]] = None
    ) -> ParseSpeechResponse:
        """
        Fallback inteligente: procesa el transcript con reglas locales
        cuando la IA no está disponible o falla.
        """
        if step == "asking_name":
            name = self._extract_name_local(transcript)
            if name:
                return ParseSpeechResponse(
                    nextStep="asking_goal",
                    resolvedData=ResolvedData(name=name),
                    aiMessage=(
                        f"Mucho gusto {name}. ¿Cuál es tu objetivo de entrenamiento? "
                        "Puedes decir: fuerza, hipertrofia, resistencia o salud general."
                    ),
                )
            return ParseSpeechResponse(
                nextStep="asking_name",
                resolvedData=ResolvedData(),
                aiMessage="No pude entender tu nombre. ¿Podrías repetirlo, por favor?",
            )

        # asking_goal
        goal = self._extract_goal_local(transcript)
        name = (context or {}).get("name", "")
        if goal:
            greeting = f"¡Perfecto{', ' + name if name else ''}!" if name else "¡Perfecto!"
            return ParseSpeechResponse(
                nextStep="completed",
                resolvedData=ResolvedData(name=name or None, goal=goal),
                aiMessage=f"{greeting} Tu registro fue exitoso. ¡Bienvenido al gimnasio!",
            )
        return ParseSpeechResponse(
            nextStep="asking_goal",
            resolvedData=ResolvedData(name=name or None),
            aiMessage=(
                "No pude entender tu objetivo. ¿Podrías repetirlo? "
                "Puedes decir: fuerza, hipertrofia, resistencia o salud general."
            ),
        )

    def parse_speech(
        self, step: str, transcript: str, context: Optional[Dict[str, Any]] = None
    ) -> ParseSpeechResponse:
        """
        Analiza el transcript del usuario según el paso del flujo de registro.
        Nunca lanza excepción: ante cualquier fallo usa el fallback local con reglas.
        """
        if not self.available:
            print("⚠️ Gemini no disponible (sin API key o paquete faltante) - usando fallback local")
            return self._local_fallback(step, transcript, context)

        try:
            prompt = self._build_prompt(step, transcript, context)
            result = self._model.generate_content(prompt)
            raw_text = result.text if result and result.text else ""
            print(f"🤖 Respuesta cruda de Gemini: {raw_text[:300]}")

            parsed = self._extract_json(raw_text)
            if not parsed:
                print(f"⚠️ Respuesta de IA no parseable - usando fallback local")
                return self._local_fallback(step, transcript, context)

            next_step = parsed.get("nextStep", step)
            resolved = parsed.get("resolvedData") or {}
            ai_message = parsed.get("aiMessage") or ""

            # Normalizar goal a categoría estándar
            goal = self._normalize_goal(resolved.get("goal"))

            # Validar coherencia: si estamos en asking_goal y no hay goal, no avanzar
            if step == "asking_goal" and next_step == "completed" and not goal:
                return self._local_fallback(step, transcript, context)

            # Si estamos en asking_name y no hay nombre, no avanzar
            if step == "asking_name" and next_step == "asking_goal" and not resolved.get("name"):
                return self._local_fallback(step, transcript, context)

            if not ai_message:
                return self._local_fallback(step, transcript, context)

            return ParseSpeechResponse(
                nextStep=next_step,
                resolvedData=ResolvedData(name=resolved.get("name"), goal=goal),
                aiMessage=ai_message,
            )

        except Exception as e:
            print(f"❌ Error en AIService.parse_speech: {type(e).__name__}: {e}")
            return self._local_fallback(step, transcript, context)


# Singleton
ai_service = AIService()
