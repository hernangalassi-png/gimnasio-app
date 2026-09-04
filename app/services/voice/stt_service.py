import speech_recognition as sr
import io
import tempfile
import os
from typing import Optional


class STTService:
    def __init__(self):
        self.recognizer = sr.Recognizer()
        
    def transcribe_audio(self, audio_bytes: bytes, language: str = "es-ES") -> str:
        """
        Convert audio bytes to text using Google Speech Recognition.
        
        Args:
            audio_bytes: Audio data as bytes (WAV, MP3, OGG, etc.)
            language: Language code for transcription (default: Spanish)
            
        Returns:
            Transcribed text
        """
        try:
            # Create a temporary file to store the audio
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
                temp_file.write(audio_bytes)
                temp_file_path = temp_file.name
            
            try:
                # Load audio from file
                with sr.AudioFile(temp_file_path) as source:
                    audio_data = self.recognizer.record(source)
                
                # Transcribe using Google Speech Recognition
                text = self.recognizer.recognize_google(audio_data, language=language)
                return text
                
            finally:
                # Clean up temporary file
                if os.path.exists(temp_file_path):
                    os.remove(temp_file_path)
                    
        except sr.UnknownValueError:
            return ""
        except sr.RequestError as e:
            raise Exception(f"Speech recognition service error: {str(e)}")
        except Exception as e:
            raise Exception(f"Error transcribing audio: {str(e)}")
    
    def transcribe_from_file(self, file_path: str, language: str = "es-ES") -> str:
        """
        Convert audio file to text.
        
        Args:
            file_path: Path to audio file
            language: Language code for transcription (default: Spanish)
            
        Returns:
            Transcribed text
        """
        try:
            with sr.AudioFile(file_path) as source:
                audio_data = self.recognizer.record(source)
            
            text = self.recognizer.recognize_google(audio_data, language=language)
            return text
            
        except sr.UnknownValueError:
            return ""
        except sr.RequestError as e:
            raise Exception(f"Speech recognition service error: {str(e)}")
        except Exception as e:
            raise Exception(f"Error transcribing audio: {str(e)}")


# Singleton instance
stt_service = STTService()
