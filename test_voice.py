"""
Test script for voice services.
This script tests the STT, TTS, and conversation services.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.voice.stt_service import stt_service
from app.services.voice.tts_service import tts_service
from app.services.voice.conversation_service import assistant_service, IntentType


def test_stt_service():
    """Test Speech-to-Text service initialization."""
    print("[TEST] Testing STT Service...")
    
    try:
        # Test service initialization
        print(f"[OK] STT Service initialized")
        print(f"[OK] Recognizer: {type(stt_service.recognizer).__name__}")
        
        print("[OK] STT Service test passed")
        return True
    except Exception as e:
        print(f"[ERROR] STT Service test failed: {e}")
        return False


def test_tts_service():
    """Test Text-to-Speech service initialization."""
    print("[TEST] Testing TTS Service...")
    
    try:
        # Test service initialization
        print(f"[OK] TTS Service initialized")
        print(f"[OK] Default language: {tts_service.default_lang}")
        
        # Test speech synthesis
        test_text = "Hola, esto es una prueba de síntesis de voz."
        audio_bytes = tts_service.synthesize_speech(test_text, lang="es")
        
        if audio_bytes:
            print(f"[OK] Speech synthesis successful ({len(audio_bytes)} bytes)")
        else:
            print("[ERROR] Speech synthesis failed - no audio generated")
            return False
        
        print("[OK] TTS Service test passed")
        return True
    except Exception as e:
        print(f"[ERROR] TTS Service test failed: {e}")
        return False


def test_conversation_service():
    """Test conversation service initialization and intent detection."""
    print("[TEST] Testing Conversation Service...")
    
    try:
        # Test service initialization
        print(f"[OK] Conversation Service initialized")
        print(f"[OK] Intent patterns loaded: {len(assistant_service.intent_patterns)}")
        
        # Test intent detection
        test_inputs = [
            ("iniciar rutina", IntentType.START_ROUTINE),
            ("cuántas repeticiones llevo", IntentType.CHECK_REPS),
            ("pausa", IntentType.PAUSE),
            ("continuar", IntentType.RESUME),
            ("terminar", IntentType.END_SESSION),
            ("motivame", IntentType.MOTIVATION),
            ("ayuda", IntentType.HELP),
            ("texto desconocido", IntentType.UNKNOWN)
        ]
        
        for text, expected_intent in test_inputs:
            detected_intent = assistant_service.detect_intent(text)
            if detected_intent == expected_intent:
                print(f"[OK] Intent detection: '{text}' -> {detected_intent.value}")
            else:
                print(f"[ERROR] Intent detection failed: '{text}' expected {expected_intent.value}, got {detected_intent.value}")
                return False
        
        # Test response generation
        response = assistant_service.generate_response(IntentType.START_ROUTINE)
        print(f"[OK] Response generation: {response}")
        
        # Test context update
        assistant_service.update_context(10, "sentadillas")
        print(f"[OK] Context updated: {assistant_service.session_context}")
        
        # Test context reset
        assistant_service.reset_context()
        print(f"[OK] Context reset: {assistant_service.session_context}")
        
        print("[OK] Conversation Service test passed")
        return True
    except Exception as e:
        print(f"[ERROR] Conversation Service test failed: {e}")
        return False


def test_conversation_flow():
    """Test complete conversation flow."""
    print("[TEST] Testing Conversation Flow...")
    
    try:
        # Simulate a training session
        assistant_service.reset_context()
        
        # Start routine
        result = assistant_service.process_conversation("iniciar rutina")
        print(f"[OK] Start routine: {result['response']}")
        
        # Update context
        assistant_service.update_context(5, "sentadillas")
        
        # Check reps
        result = assistant_service.process_conversation("cuántas repeticiones llevo")
        print(f"[OK] Check reps: {result['response']}")
        
        # Ask for motivation
        result = assistant_service.process_conversation("motivame")
        print(f"[OK] Motivation: {result['response']}")
        
        # End session
        result = assistant_service.process_conversation("terminar")
        print(f"[OK] End session: {result['response']}")
        
        print("[OK] Conversation Flow test passed")
        return True
    except Exception as e:
        print(f"[ERROR] Conversation Flow test failed: {e}")
        return False


def main():
    """Run all voice service tests."""
    print("=" * 50)
    print("VOICE SERVICES TEST SUITE")
    print("=" * 50)
    
    results = []
    
    # Test STT service
    results.append(("STT Service", test_stt_service()))
    
    # Test TTS service
    results.append(("TTS Service", test_tts_service()))
    
    # Test conversation service
    results.append(("Conversation Service", test_conversation_service()))
    
    # Test conversation flow
    results.append(("Conversation Flow", test_conversation_flow()))
    
    # Summary
    print("\n" + "=" * 50)
    print("TEST SUMMARY")
    print("=" * 50)
    
    for test_name, passed in results:
        status = "[PASS]" if passed else "[FAIL]"
        print(f"{status} {test_name}")
    
    all_passed = all(result[1] for result in results)
    
    if all_passed:
        print("\n[OK] All tests passed!")
        return 0
    else:
        print("\n[ERROR] Some tests failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
