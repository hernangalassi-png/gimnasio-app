from gtts import gTTS
import io
import tempfile
import os
from typing import Optional


class TTSService:
    def __init__(self):
        self.default_lang = "es"
        
    def synthesize_speech(self, text: str, lang: str = "es", slow: bool = False) -> bytes:
        """
        Convert text to speech audio using Google Text-to-Speech.
        
        Args:
            text: Text to convert to speech
            lang: Language code (default: Spanish)
            slow: Whether to speak slowly (default: False)
            
        Returns:
            Audio data as bytes (MP3 format)
        """
        try:
            # Create gTTS object
            tts = gTTS(text=text, lang=lang, slow=slow)
            
            # Save to bytes buffer
            audio_buffer = io.BytesIO()
            tts.write_to_fp(audio_buffer)
            audio_buffer.seek(0)
            
            # Return bytes
            return audio_buffer.getvalue()
            
        except Exception as e:
            raise Exception(f"Error synthesizing speech: {str(e)}")
    
    def synthesize_to_file(self, text: str, file_path: str, lang: str = "es", slow: bool = False) -> str:
        """
        Convert text to speech and save to file.
        
        Args:
            text: Text to convert to speech
            file_path: Path to save audio file
            lang: Language code (default: Spanish)
            slow: Whether to speak slowly (default: False)
            
        Returns:
            Path to saved file
        """
        try:
            # Create gTTS object
            tts = gTTS(text=text, lang=lang, slow=slow)
            
            # Save to file
            tts.save(file_path)
            
            return file_path
            
        except Exception as e:
            raise Exception(f"Error synthesizing speech to file: {str(e)}")


# Singleton instance
tts_service = TTSService()
