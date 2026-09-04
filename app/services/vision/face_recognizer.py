import cv2
import numpy as np
import mediapipe as mp
from typing import Optional, List
from sqlalchemy.orm import Session
from app.models.user import User
from app.core.database import SessionLocal


class FaceRecognitionService:
    def __init__(self):
        self.mp_face_detection = mp.solutions.face_detection
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_detection = self.mp_face_detection.FaceDetection(
            model_selection=0, min_detection_confidence=0.5
        )
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=True, max_num_faces=1, min_detection_confidence=0.5
        )
        
    def register_user_face(self, user_id: str, image_bytes: bytes, db: Session) -> List[float]:
        """
        Extract face embedding from an image and save it to the database.
        
        Args:
            user_id: UUID of the user
            image_bytes: Image data as bytes
            db: Database session
            
        Returns:
            Face embedding as a list of floats
        """
        try:
            # Convert bytes to numpy array
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img is None:
                raise ValueError("Invalid image data")
            
            # Convert BGR to RGB for MediaPipe
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            
            # Detect face landmarks using Face Mesh
            results = self.face_mesh.process(img_rgb)
            
            if not results.multi_face_landmarks:
                raise ValueError("No face detected in image")
            
            # Extract face landmarks as embedding (simplified version)
            landmarks = results.multi_face_landmarks[0]
            embedding = []
            
            for landmark in landmarks.landmark:
                embedding.extend([landmark.x, landmark.y, landmark.z])
            
            # Update user in database
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                user.face_embedding = embedding
                db.commit()
                db.refresh(user)
            
            return embedding
            
        except Exception as e:
            raise Exception(f"Error extracting face embedding: {str(e)}")
    
    def identify_user(self, image_bytes: bytes, threshold: float = 0.6, db: Session = None) -> Optional[str]:
        """
        Identify user from face image by comparing with stored embeddings.
        
        Args:
            image_bytes: Image data as bytes
            threshold: Similarity threshold (lower = more strict)
            db: Database session (optional, will create if not provided)
            
        Returns:
            User ID if recognized, None otherwise
        """
        try:
            # Convert bytes to numpy array
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img is None:
                raise ValueError("Invalid image data")
            
            # Convert BGR to RGB for MediaPipe
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            
            # Detect face landmarks using Face Mesh
            results = self.face_mesh.process(img_rgb)
            
            if not results.multi_face_landmarks:
                return None
            
            # Extract face landmarks as embedding
            landmarks = results.multi_face_landmarks[0]
            input_embedding = []
            
            for landmark in landmarks.landmark:
                input_embedding.extend([landmark.x, landmark.y, landmark.z])
            
            input_embedding = np.array(input_embedding)
            
            # Get all users with face embeddings from database
            if db is None:
                db = SessionLocal()
            
            users_with_faces = db.query(User).filter(User.face_embedding.isnot(None)).all()
            
            if not users_with_faces:
                return None
            
            # Find best match
            best_match_id = None
            best_distance = float('inf')
            
            for user in users_with_faces:
                if user.face_embedding:
                    stored_embedding = np.array(user.face_embedding)
                    # Calculate Euclidean distance
                    distance = np.linalg.norm(input_embedding - stored_embedding)
                    
                    if distance < best_distance and distance < threshold:
                        best_distance = distance
                        best_match_id = user.id
            
            return best_match_id
            
        except Exception as e:
            print(f"Error identifying user: {str(e)}")
            return None


# Singleton instance
face_recognition_service = FaceRecognitionService()
