import cv2
import numpy as np
import mediapipe as mp

mp_pose = mp.solutions.pose

def calculate_angle(a, b, c):
    """Calcula el ángulo entre tres puntos (en grados)."""
    a = np.array(a)  # Cadera
    b = np.array(b)  # Rodilla
    c = np.array(c)  # Tobillo
    
    radians = np.arctan2(c[1] - b[1], c[0] - b[0]) - np.arctan2(a[1] - b[1], a[0] - b[0])
    angle = np.abs(radians * 180.0 / np.pi)
    
    if angle > 180.0:
        angle = 360 - angle
        
    return angle

def process_squat_frame(image_bytes, current_state):
    """
    Procesa un frame codificado en bytes, valida visibilidad de cuerpo entero y calcula reps.
    """
    np_arr = np.frombuffer(image_bytes, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if frame is None:
        return {"error": "Invalid image"}, 400

    image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    with mp_pose.Pose(static_image_mode=True, min_detection_confidence=0.5) as pose:
        results = pose.process(image_rgb)
        
        if not results.pose_landmarks:
            return {
                "reps": current_state.get("reps", 0),
                "stage": current_state.get("stage", "UP"),
                "feedback": "No se detecta persona en cámara"
            }

        landmarks = results.pose_landmarks.landmark

        # Obtener coordenadas de la pierna izquierda
        hip = [landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].x, landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].y]
        knee = [landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value].x, landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value].y]
        ankle = [landmarks[mp_pose.PoseLandmark.LEFT_ANKLE.value].x, landmarks[mp_pose.PoseLandmark.LEFT_ANKLE.value].y]

        # Validar confianza de visibilidad (> 0.7)
        hip_vis = landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].visibility
        knee_vis = landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value].visibility
        ankle_vis = landmarks[mp_pose.PoseLandmark.LEFT_ANKLE.value].visibility

        if hip_vis < 0.7 or knee_vis < 0.7 or ankle_vis < 0.7:
            return {
                "reps": current_state.get("reps", 0),
                "stage": current_state.get("stage", "UP"),
                "feedback": "Aléjate: se requiere cuerpo completo"
            }

        # Calcular ángulo articular de la rodilla
        angle = calculate_angle(hip, knee, ankle)
        
        reps = current_state.get("reps", 0)
        stage = current_state.get("stage", "UP")
        feedback = "Mantén la postura"

        if angle > 160:
            stage = "UP"
            feedback = "Buena extensión. Baja de nuevo"
        elif angle < 90 and stage == "UP":
            stage = "DOWN"
            reps += 1
            feedback = "¡Buena profundidad! Sube"

        return {
            "reps": reps,
            "stage": stage,
            "feedback": feedback,
            "angle": round(angle, 1)
        }