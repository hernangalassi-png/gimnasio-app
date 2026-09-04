from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from typing import Optional
from pydantic import BaseModel
from app.services.voice.stt_service import stt_service
from app.services.voice.tts_service import tts_service
from app.services.voice.conversation_service import assistant_service

router = APIRouter()


class TranscribeRequest(BaseModel):
    language: str = "es-ES"


class SpeakRequest(BaseModel):
    text: str
    lang: str = "es"
    slow: bool = False


class ChatRequest(BaseModel):
    text: Optional[str] = None
    context: Optional[dict] = None


@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    language: str = "es-ES"
):
    """
    Transcribe audio file to text.
    
    Args:
        file: Audio file (WAV, MP3, OGG, etc.)
        language: Language code for transcription (default: Spanish)
        
    Returns:
        Transcribed text
    """
    try:
        # Read audio bytes
        audio_bytes = await file.read()
        
        # Transcribe audio
        text = stt_service.transcribe_audio(audio_bytes, language)
        
        return {
            "text": text,
            "language": language
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/speak")
async def synthesize_speech(request: SpeakRequest):
    """
    Convert text to speech audio.
    
    Args:
        request: SpeakRequest with text, language, and speed options
        
    Returns:
        Audio file (MP3 format)
    """
    try:
        # Generate speech
        audio_bytes = tts_service.synthesize_speech(
            text=request.text,
            lang=request.lang,
            slow=request.slow
        )
        
        # Return audio file
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": "attachment; filename=speech.mp3"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/chat")
async def chat(request: ChatRequest):
    """
    Process user input (text or audio) and generate contextual response.
    
    Args:
        request: ChatRequest with text input and optional context
        
    Returns:
        Response with intent, text, and optional audio
    """
    try:
        if not request.text:
            raise HTTPException(status_code=400, detail="Text input is required")
        
        # Process conversation
        result = assistant_service.process_conversation(
            user_input=request.text,
            context=request.context
        )
        
        return result
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/chat-with-audio")
async def chat_with_audio(
    file: UploadFile = File(...),
    language: str = "es-ES",
    context: Optional[dict] = None
):
    """
    Process audio input, transcribe it, and generate contextual response.
    
    Args:
        file: Audio file with user speech
        language: Language code for transcription (default: Spanish)
        context: Optional session context
        
    Returns:
        Response with transcribed text, intent, and response
    """
    try:
        # Read audio bytes
        audio_bytes = await file.read()
        
        # Transcribe audio
        transcribed_text = stt_service.transcribe_audio(audio_bytes, language)
        
        if not transcribed_text:
            return {
                "transcribed_text": "",
                "intent": "unknown",
                "response": "No pude entender el audio. Por favor, intenta de nuevo.",
                "context": assistant_service.session_context
            }
        
        # Process conversation
        result = assistant_service.process_conversation(
            user_input=transcribed_text,
            context=context
        )
        
        # Add transcribed text to result
        result["transcribed_text"] = transcribed_text
        
        return result
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/update-context")
async def update_context(reps: int, exercise: Optional[str] = None):
    """
    Update the assistant's session context.
    
    Args:
        reps: Current repetition count
        exercise: Current exercise name (optional)
        
    Returns:
        Success message
    """
    try:
        assistant_service.update_context(reps, exercise)
        return {
            "message": "Context updated successfully",
            "context": assistant_service.session_context
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/reset-context")
async def reset_context():
    """
    Reset the assistant's session context.
    
    Returns:
        Success message
    """
    try:
        assistant_service.reset_context()
        return {
            "message": "Context reset successfully",
            "context": assistant_service.session_context
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/context")
async def get_context():
    """
    Get the current assistant session context.
    
    Returns:
        Current session context
    """
    try:
        return {
            "context": assistant_service.session_context
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
