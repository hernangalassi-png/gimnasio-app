from typing import Dict, Optional, List
from enum import Enum
import re


class IntentType(str, Enum):
    START_ROUTINE = "start_routine"
    CHECK_REPS = "check_reps"
    PAUSE = "pause"
    RESUME = "resume"
    END_SESSION = "end_session"
    MOTIVATION = "motivation"
    HELP = "help"
    UNKNOWN = "unknown"


class AssistantService:
    def __init__(self):
        # Intent patterns for Spanish
        self.intent_patterns = {
            IntentType.START_ROUTINE: [
                r"iniciar\s+rutina",
                r"empezar\s+rutina",
                r"comenzar\s+rutina",
                r"vamos\s+a\s+entrenar",
                r"empieza"
            ],
            IntentType.CHECK_REPS: [
                r"cuántas\s+repeticiones",
                r"cuantas\s+repeticiones",
                r"cuánto\s+llevo",
                r"cuanto\s+llevo",
                r"repeticiones\s+actuales",
                r"contador"
            ],
            IntentType.PAUSE: [
                r"pausa",
                r"parar",
                r"detener",
                r"espera"
            ],
            IntentType.RESUME: [
                r"continuar",
                r"seguir",
                r"reanudar",
                r"volver"
            ],
            IntentType.END_SESSION: [
                r"terminar",
                r"finalizar",
                r"acabar",
                r"listo"
            ],
            IntentType.MOTIVATION: [
                r"motivación",
                r"motivame",
                r"ánimo",
                r"dale"
            ],
            IntentType.HELP: [
                r"ayuda",
                r"qué\s+puedo\s+decir",
                r"comandos",
                r"instrucciones"
            ]
        }
        
        # Context state
        self.session_context = {
            "current_exercise": None,
            "reps_count": 0,
            "session_active": False,
            "paused": False
        }
    
    def detect_intent(self, text: str) -> IntentType:
        """
        Detect the user's intent from their speech text.
        
        Args:
            text: User's speech text
            
        Returns:
            Detected intent type
        """
        text_lower = text.lower().strip()
        
        for intent, patterns in self.intent_patterns.items():
            for pattern in patterns:
                if re.search(pattern, text_lower):
                    return intent
        
        return IntentType.UNKNOWN
    
    def generate_response(self, intent: IntentType, context: Optional[Dict] = None) -> str:
        """
        Generate a contextual response based on intent and current session state.
        
        Args:
            intent: Detected user intent
            context: Optional session context (reps, exercise, etc.)
            
        Returns:
            Response text suitable for TTS
        """
        if context:
            self.session_context.update(context)
        
        response = ""
        
        if intent == IntentType.START_ROUTINE:
            response = "¡Excelente! Vamos a comenzar tu entrenamiento. Estoy listo para guiarte."
            self.session_context["session_active"] = True
            self.session_context["paused"] = False
            
        elif intent == IntentType.CHECK_REPS:
            reps = self.session_context.get("reps_count", 0)
            exercise = self.session_context.get("current_exercise", "ejercicio")
            if reps > 0:
                response = f"Llevas {reps} repeticiones de {exercise}. ¡Sigue así!"
            else:
                response = "Aún no has comenzado las repeticiones. ¡Vamos a empezar!"
                
        elif intent == IntentType.PAUSE:
            if self.session_context["session_active"]:
                response = "Entendido. Pausando el entrenamiento. Avísame cuando quieras continuar."
                self.session_context["paused"] = True
            else:
                response = "No hay sesión activa para pausar."
                
        elif intent == IntentType.RESUME:
            if self.session_context["paused"]:
                response = "¡Perfecto! Reanudando el entrenamiento. ¡Vamos con todo!"
                self.session_context["paused"] = False
            else:
                response = "La sesión no está pausada. Continuando normalmente."
                
        elif intent == IntentType.END_SESSION:
            if self.session_context["session_active"]:
                reps = self.session_context.get("reps_count", 0)
                response = f"¡Excelente trabajo! Has completado {reps} repeticiones. Buen descanso."
                self.session_context["session_active"] = False
                self.session_context["paused"] = False
            else:
                response = "No hay sesión activa para terminar."
                
        elif intent == IntentType.MOTIVATION:
            responses = [
                "¡Tú puedes! Cada repetición te acerca a tu objetivo.",
                "¡Eres increíble! No te rindas ahora.",
                "¡Esfuérzate al máximo! Tu cuerpo te lo agradecerá.",
                "¡Mantén el ritmo! Estás haciendo un gran trabajo.",
                "¡Sigue así! El progreso se construye día a día."
            ]
            import random
            response = random.choice(responses)
            
        elif intent == IntentType.HELP:
            response = "Puedes decirme: iniciar rutina, cuántas repeticiones llevo, pausa, continuar, terminar, o pide motivación."
            
        else:
            response = "No entendí eso. Puedes pedir ayuda para conocer los comandos disponibles."
        
        return response
    
    def update_context(self, reps: int, exercise: str = None):
        """
        Update the session context with current exercise state.
        
        Args:
            reps: Current repetition count
            exercise: Current exercise name (optional)
        """
        self.session_context["reps_count"] = reps
        if exercise:
            self.session_context["current_exercise"] = exercise
    
    def reset_context(self):
        """Reset the session context."""
        self.session_context = {
            "current_exercise": None,
            "reps_count": 0,
            "session_active": False,
            "paused": False
        }
    
    def process_conversation(self, user_input: str, context: Optional[Dict] = None) -> Dict:
        """
        Process a complete conversation turn: detect intent and generate response.
        
        Args:
            user_input: User's speech or text input
            context: Optional session context
            
        Returns:
            Dictionary with intent, response, and updated context
        """
        intent = self.detect_intent(user_input)
        response = self.generate_response(intent, context)
        
        return {
            "intent": intent.value,
            "response": response,
            "context": self.session_context
        }


# Singleton instance
assistant_service = AssistantService()
