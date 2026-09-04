import cv2
import numpy as np
import mediapipe as mp
from typing import Dict, Tuple
from enum import Enum


class ExerciseType(str, Enum):
    SQUAT = "squat"
    PUSHUP = "pushup"


class PoseStage(str, Enum):
    UP = "up"
    DOWN = "down"


class PoseTrackerService:
    def __init__(self):
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            static_image_mode=True,
            model_complexity=1,
            smooth_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.counter = 0
        self.stage = PoseStage.UP
        self.exercise_type = None

    def calculate_angle(self, a: Tuple[float, float], b: Tuple[float, float], c: Tuple[float, float]) -> float:
        a, b, c = np.array(a), np.array(b), np.array(c)
        radians = np.arctan2(c[1] - b[1], c[0] - b[0]) - np.arctan2(a[1] - b[1], a[0] - b[0])
        angle = np.abs(radians * 180.0 / np.pi)
        if angle > 180.0:
            angle = 360.0 - angle
        return angle

    def process_squat(self, landmarks) -> Dict:
        # Extraer landmarks y visibilidad
        l_hip = landmarks[self.mp_pose.PoseLandmark.LEFT_HIP.value]
        l_knee = landmarks[self.mp_pose.PoseLandmark.LEFT_KNEE.value]
        l_ankle = landmarks[self.mp_pose.PoseLandmark.LEFT_ANKLE.value]

        r_hip = landmarks[self.mp_pose.PoseLandmark.RIGHT_HIP.value]
        r_knee = landmarks[self.mp_pose.PoseLandmark.RIGHT_KNEE.value]
        r_ankle = landmarks[self.mp_pose.PoseLandmark.RIGHT_ANKLE.value]

        # Seleccionar el lado con mayor visibilidad promedio
        left_vis = (l_hip.visibility + l_knee.visibility + l_ankle.visibility) / 3
        right_vis = (r_hip.visibility + r_knee.visibility + r_ankle.visibility) / 3

        best_vis = max(left_vis, right_vis)

        # Validar cuerpo completo visible (umbral 0.65)
        if best_vis < 0.65:
            return {
                "reps": self.counter,
                "stage": self.stage.value,
                "angle": 0,
                "feedback": "Aléjate: se requiere cuerpo completo"
            }

        if left_vis >= right_vis:
            angle = self.calculate_angle([l_hip.x, l_hip.y], [l_knee.x, l_knee.y], [l_ankle.x, l_ankle.y])
        else:
            angle = self.calculate_angle([r_hip.x, r_hip.y], [r_knee.x, r_knee.y], [r_ankle.x, r_ankle.y])

        # Lógica de conteo de sentadilla
        feedback = "Mantén el movimiento"
        if angle > 160:
            self.stage = PoseStage.UP
            feedback = "Buena extensión"
        elif angle < 90:
            if self.stage == PoseStage.UP:
                self.counter += 1
                self.stage = PoseStage.DOWN
                feedback = "¡Buena repetición!"
            else:
                feedback = "Sube para completar"

        return {
            "reps": self.counter,
            "stage": self.stage.value,
            "angle": round(angle, 1),
            "feedback": feedback
        }

    def process_pushup(self, landmarks) -> Dict:
        l_sh = landmarks[self.mp_pose.PoseLandmark.LEFT_SHOULDER.value]
        l_el = landmarks[self.mp_pose.PoseLandmark.LEFT_ELBOW.value]
        l_wr = landmarks[self.mp_pose.PoseLandmark.LEFT_WRIST.value]

        r_sh = landmarks[self.mp_pose.PoseLandmark.RIGHT_SHOULDER.value]
        r_el = landmarks[self.mp_pose.PoseLandmark.RIGHT_ELBOW.value]
        r_wr = landmarks[self.mp_pose.PoseLandmark.RIGHT_WRIST.value]

        left_vis = (l_sh.visibility + l_el.visibility + l_wr.visibility) / 3
        right_vis = (r_sh.visibility + r_el.visibility + r_wr.visibility) / 3

        if max(left_vis, right_vis) < 0.65:
            return {
                "reps": self.counter,
                "stage": self.stage.value,
                "angle": 0,
                "feedback": "Ajusta la cámara para ver torso y brazos"
            }

        if left_vis >= right_vis:
            angle = self.calculate_angle([l_sh.x, l_sh.y], [l_el.x, l_el.y], [l_wr.x, l_wr.y])
        else:
            angle = self.calculate_angle([r_sh.x, r_sh.y], [r_el.x, r_el.y], [r_wr.x, r_wr.y])

        feedback = "Mantén la postura"
        if angle > 160:
            self.stage = PoseStage.UP
            feedback = "Brazos extendidos"
        elif angle < 90:
            if self.stage == PoseStage.UP:
                self.counter += 1
                self.stage = PoseStage.DOWN
                feedback = "¡Buena flexión!"

        return {
            "reps": self.counter,
            "stage": self.stage.value,
            "angle": round(angle, 1),
            "feedback": feedback
        }

    def reset_counter(self):
        self.counter = 0
        self.stage = PoseStage.UP

    def set_exercise_type(self, exercise_type: ExerciseType):
        self.exercise_type = exercise_type
        self.reset_counter()

    def process_frame(self, image_bytes: bytes, exercise_type: str) -> Dict:
        try:
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if img is None:
                return {"reps": self.counter, "stage": self.stage.value, "angle": 0, "feedback": "Imagen inválida"}

            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            results = self.pose.process(img_rgb)

            if not results.pose_landmarks:
                return {
                    "reps": self.counter,
                    "stage": self.stage.value,
                    "angle": 0,
                    "feedback": "No se detecta persona"
                }

            if self.exercise_type != exercise_type:
                self.set_exercise_type(ExerciseType(exercise_type))

            if exercise_type == ExerciseType.SQUAT.value:
                return self.process_squat(results.pose_landmarks.landmark)
            elif exercise_type == ExerciseType.PUSHUP.value:
                return self.process_pushup(results.pose_landmarks.landmark)
            else:
                return {
                    "reps": self.counter,
                    "stage": self.stage.value,
                    "angle": 0,
                    "feedback": "Ejercicio no soportado"
                }

        except Exception as e:
            return {
                "reps": self.counter,
                "stage": self.stage.value,
                "angle": 0,
                "feedback": f"Error interno: {str(e)}"
            }

    def close(self):
        self.pose.close()


pose_tracker_service = PoseTrackerService()