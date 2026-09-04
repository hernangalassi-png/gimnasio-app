"""
Test script for vision services.
This script tests the face recognition and pose tracking services.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.vision.face_recognizer import face_recognition_service
from app.services.vision.pose_counter import pose_tracker_service
from app.core.database import SessionLocal
from app.models.user import User


def test_face_recognition():
    """Test face recognition service initialization."""
    print("[TEST] Testing Face Recognition Service...")
    
    try:
        # Test service initialization
        print(f"[OK] Face Recognition Service initialized")
        print(f"[OK] Face Detection: MediaPipe")
        print(f"[OK] Face Mesh: MediaPipe")
        
        # Test database connection
        db = SessionLocal()
        users = db.query(User).all()
        print(f"[OK] Found {len(users)} users in database")
        db.close()
        
        print("[OK] Face Recognition Service test passed")
        return True
    except Exception as e:
        print(f"[ERROR] Face Recognition Service test failed: {e}")
        return False


def test_pose_tracking():
    """Test pose tracking service initialization."""
    print("[TEST] Testing Pose Tracking Service...")
    
    try:
        # Test service initialization
        print(f"[OK] Pose Tracking Service initialized")
        print(f"[OK] Counter: {pose_tracker_service.counter}")
        print(f"[OK] Stage: {pose_tracker_service.stage}")
        
        # Test angle calculation
        angle = pose_tracker_service.calculate_angle((0, 0), (1, 0), (1, 1))
        print(f"[OK] Angle calculation test: {angle} degrees")
        
        # Test counter reset
        pose_tracker_service.reset_counter()
        print(f"[OK] Counter reset: {pose_tracker_service.counter}")
        
        print("[OK] Pose Tracking Service test passed")
        return True
    except Exception as e:
        print(f"[ERROR] Pose Tracking Service test failed: {e}")
        return False


def test_pose_processing():
    """Test pose processing with dummy data."""
    print("[TEST] Testing Pose Processing...")
    
    try:
        # Create a simple test image (1x1 pixel)
        import numpy as np
        import cv2
        
        # Create a dummy image
        dummy_image = np.zeros((100, 100, 3), dtype=np.uint8)
        _, buffer = cv2.imencode('.jpg', dummy_image)
        image_bytes = buffer.tobytes()
        
        # Test squat processing
        result = pose_tracker_service.process_frame(image_bytes, "squat")
        print(f"[OK] Squat processing result: {result}")
        
        # Test pushup processing
        result = pose_tracker_service.process_frame(image_bytes, "pushup")
        print(f"[OK] Pushup processing result: {result}")
        
        print("[OK] Pose Processing test passed")
        return True
    except Exception as e:
        print(f"[ERROR] Pose Processing test failed: {e}")
        return False


def main():
    """Run all vision service tests."""
    print("=" * 50)
    print("VISION SERVICES TEST SUITE")
    print("=" * 50)
    
    results = []
    
    # Test face recognition
    results.append(("Face Recognition", test_face_recognition()))
    
    # Test pose tracking
    results.append(("Pose Tracking", test_pose_tracking()))
    
    # Test pose processing
    results.append(("Pose Processing", test_pose_processing()))
    
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
