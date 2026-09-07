import React, { useRef, useEffect, useState, useCallback } from 'react';
import { InstructorAvatar, type AvatarState } from './InstructorAvatar';
import { api } from '../services/api';

declare global {
  interface Window {
    FaceDetection: any;
    Camera: any;
  }
}

interface User {
  id: string;
  name: string;
  primary_goal?: string;
}

interface FaceDetectionResult {
  identified: boolean;
  user?: User;
}

export const UserIdentification: React.FC<{ onUserIdentified: (user: User) => void }> = ({ onUserIdentified }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const faceDetectionRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const isInitializedRef = useRef(false);
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [message, setMessage] = useState<string>('Colócate frente a la cámara');
  const [showButtons, setShowButtons] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [faceStableCount, setFaceStableCount] = useState(0);
  const [lastEmbedding, setLastEmbedding] = useState<number[] | null>(null);

  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES';
      utterance.rate = 1;
      utterance.pitch = 1;
      
      utterance.onstart = () => setAvatarState('speaking');
      utterance.onend = () => setAvatarState('idle');
      
      window.speechSynthesis.speak(utterance);
    }
  };

  const extractEmbedding = (detections: any): number[] => {
    if (!detections || !Array.isArray(detections) || detections.length === 0) return [];

    const detection = detections[0];
    if (!detection) return [];

    const embedding: number[] = [];

    // Extraer boundingBox (relativeBoundingBox en MediaPipe Face Detection)
    const bbox = detection.boundingBox || detection.relativeBoundingBox;
    if (bbox) {
      embedding.push(
        bbox.xCenter || bbox.xmin || 0,
        bbox.yCenter || bbox.ymin || 0,
        bbox.width || (bbox.xmax - bbox.xmin) || 0,
        bbox.height || (bbox.ymax - bbox.ymin) || 0
      );
    }

    // Extraer keypoints si están disponibles
    const keypoints = detection.keypoints;
    if (keypoints && Array.isArray(keypoints)) {
      keypoints.forEach((point: any) => {
        if (point && typeof point.x === 'number' && typeof point.y === 'number') {
          embedding.push(point.x, point.y);
        }
      });
    }

    // Extraer confidence score
    const categories = detection.categories;
    if (categories && categories.length > 0) {
      embedding.push(categories[0].score || 0);
    }

    // Si el embedding es muy pequeño (<10), rellenar con valores del boundingBox
    // para tener suficiente data para comparación
    if (embedding.length < 10 && bbox) {
      const padding = 10 - embedding.length;
      for (let i = 0; i < padding; i++) {
        embedding.push(bbox.xCenter || 0);
      }
    }

    console.log(`📊 Embedding generado: ${embedding.length} elementos`);

    return embedding;
  };

  const identifyUser = useCallback(async (embedding: number[]) => {
    const payload = { face_embedding: embedding };

    try {
      setMessage('Identificando rostro...');
      setAvatarState('listening');

      console.log('📤 Enviando payload al backend:', {
        endpoint: '/users/identify',
        payloadLength: embedding.length
      });

      // Retry manual con máximo 2 intentos para evitar afectar MediaPipe
      let lastError: any = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const response = await api.post<FaceDetectionResult>('/users/identify', payload);

          console.log('✅ Respuesta del backend:', response.data);

          if (response.data.identified && response.data.user) {
            setCurrentUser(response.data.user);
            speak(`Hola ${response.data.user.name}. ¿Deseas iniciar tu rutina de entrenamiento?`);
            setMessage(`Hola ${response.data.user.name}. ¿Deseas iniciar tu rutina?`);
            setShowButtons(true);
            return;
          } else {
            speak('No te reconozco. ¿Deseas registrarte en el sistema?');
            setMessage('No te reconozco. ¿Deseas registrarte?');
            setShowButtons(true);
            return;
          }
        } catch (error: any) {
          lastError = error;
          console.error(`❌ Intento ${attempt} fallido:`, error.code || error.message);

          if (attempt < 2 && (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED')) {
            console.log('⏳ Esperando 2s para reintentar...');
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            throw error;
          }
        }
      }

      throw lastError;
    } catch (error: any) {
      console.error('❌ Error final en identificación:', error.code || error.message);

      // NO desmontar el componente - solo mostrar error y permitir reintentar
      if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED') {
        setMessage('⚠️ Servidor desconectado. Reintentando en 5s...');
        speak('El servidor está desconectado. Reintentando...');
        // Esperar 5 segundos y resetear para permitir nuevo intento
        setTimeout(() => {
          setMessage('Colócate frente a la cámara');
        }, 5000);
      } else {
        speak('Hubo un error al identificar tu rostro. Inténtalo nuevamente.');
        setMessage('Error de identificación. Inténtalo nuevamente.');
      }
    } finally {
      setIsDetecting(false);
      setFaceStableCount(0);
    }
  }, []);

  const onFaceDetectionResults = useCallback(async (results: any) => {
    if (results.detections && results.detections.length > 0) {
      const embedding = extractEmbedding(results.detections);

      if (embedding.length > 0) {
        setLastEmbedding(embedding);
        setFaceStableCount(prev => {
          const newCount = prev + 1;

          if (newCount >= 60 && !isDetecting) {
            console.log('🎯 Umbral alcanzado - Iniciando identificación');
            setIsDetecting(true);
            identifyUser(embedding);
          }
          return newCount;
        });
      }
    } else {
      setFaceStableCount(0);
      setLastEmbedding(null);
    }
  }, [isDetecting, identifyUser]);

  const handleVoiceCommand = (command: string) => {
    if (command.includes('sí') || command.includes('si') || command.includes('yes')) {
      handleYes();
    } else if (command.includes('no')) {
      handleNo();
    }
  };

  const handleYes = () => {
    if (currentUser) {
      speak(`Hola ${currentUser.name}. ¿Deseas iniciar tu rutina de entrenamiento?`);
      setMessage(`Hola ${currentUser.name}. ¿Deseas iniciar tu rutina?`);
      setShowButtons(true);
    } else {
      setShowRegisterModal(true);
    }
  };

  const handleNo = () => {
    speak('Entendido. Esperando a que te identifiques.');
    setMessage('Colócate frente a la cámara');
    setCurrentUser(null);
    setShowButtons(false);
  };

  const handleStartWorkout = () => {
    if (currentUser) {
      onUserIdentified(currentUser);
    }
  };

  const handleRegister = async (name: string) => {
    if (!lastEmbedding) {
      speak('No pude capturar tu rostro. Inténtalo nuevamente.');
      setMessage('Error capturando rostro. Inténtalo nuevamente.');
      return;
    }

    try {
      setMessage('Registrando usuario...');
      
      const response = await api.post<User>('/users/quick-register', {
        name,
        face_embedding: lastEmbedding,
        primary_goal: 'salud_general',
        target_rpe: 7.0
      });
      
      setCurrentUser(response.data);
      setShowRegisterModal(false);
      speak(`Bienvenido ${name}. ¿Deseas iniciar tu rutina de entrenamiento?`);
      setMessage(`Bienvenido ${name}. ¿Deseas iniciar tu rutina?`);
    } catch (error) {
      console.error('Error registering user:', error);
      speak('Hubo un error al registrarte. Inténtalo nuevamente.');
      setMessage('Error de registro. Inténtalo nuevamente.');
    }
  };

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recog = new SpeechRecognition();
      recog.lang = 'es-ES';
      recog.continuous = false;
      recog.interimResults = false;

      recog.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript.toLowerCase();
        handleVoiceCommand(transcript);
      };

      recog.onend = () => {
        setAvatarState('idle');
      };
    }

    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      if (faceDetectionRef.current) {
        faceDetectionRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!videoRef.current || isInitializedRef.current) return;

    const loadScript = (src: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        // Verificar si el script ya existe para evitar duplicados
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve();
        script.onerror = () => {
          console.error('❌ Error cargando script:', src);
          reject(new Error(`Error cargando ${src}`));
        };
        document.head.appendChild(script);
      });
    };

    const initializeMediaPipe = async () => {
      try {
        setMessage('Cargando scripts de MediaPipe...');

        // Cargar face_detection.js desde el CDN para asegurar consistencia de versión
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/face_detection.js');

        if (typeof window.FaceDetection === 'undefined') {
          throw new Error('FaceDetection no está disponible después de cargar el script');
        }

        setMessage('Cargando modelo de detección facial...');

        const faceDetection = new window.FaceDetection({
          locateFile: (file: string) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`;
          }
        });

        faceDetection.setOptions({
          model: 'full',
          minDetectionConfidence: 0.3
        });

        faceDetection.onResults((results: any) => {
          onFaceDetectionResults(results);
        });

        await faceDetection.initialize();

        faceDetectionRef.current = faceDetection;
        isInitializedRef.current = true;

        const camera = new window.Camera(videoRef.current, {
          onFrame: async () => {
            if (faceDetectionRef.current && videoRef.current && !isDetecting) {
              try {
                await faceDetectionRef.current.send({ image: videoRef.current });
              } catch (error) {
                // Silenciar errores de frame para no saturar consola
              }
            }
          },
          width: 640,
          height: 480
        });

        await camera.start();
        cameraRef.current = camera;
        setMessage('Colócate frente a la cámara');

      } catch (error) {
        console.error('Error al inicializar MediaPipe:', error);
        setMessage('Error al cargar el modelo de detección facial. Verifica tu conexión.');
        // NO resetear isInitializedRef.current aquí para evitar reintentos infinitos
        // Solo se resetea al desmontar el componente
      }
    };

    initializeMediaPipe();

    return () => {
      console.log('Limpiando recursos de MediaPipe (desmontaje)...');
      isInitializedRef.current = false;
      if (cameraRef.current) {
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      if (faceDetectionRef.current) {
        faceDetectionRef.current.close();
        faceDetectionRef.current = null;
      }
    };
  }, [onFaceDetectionResults]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <InstructorAvatar state={avatarState} message={message} />
      
      <div className="relative w-full max-w-2xl bg-black rounded-lg overflow-hidden shadow-xl border border-gray-800 mt-8">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className="w-full h-auto transform -scale-x-100"
        />
        
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-center">
          <p className="text-sm text-gray-300 mb-2">
            {faceStableCount > 0 
              ? `Detectando rostro... ${Math.min(faceStableCount, 60)}/60` 
              : 'Esperando detección facial...'}
          </p>
          {faceStableCount === 0 && (
            <button
              onClick={() => {
                speak('No te alcanzo a ver bien, acércate un poco a la cámara');
                setMessage('No te alcanzo a ver bien, acércate un poco a la cámara');
              }}
              className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg font-bold text-sm"
            >
              No me veo bien
            </button>
          )}
        </div>
      </div>

      {showButtons && (
        <div className="flex space-x-4 mt-6">
          <button
            onClick={handleYes}
            className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-bold text-lg"
          >
            Sí
          </button>
          <button
            onClick={handleNo}
            className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-lg font-bold text-lg"
          >
            No
          </button>
        </div>
      )}

      {currentUser && showButtons && (
        <button
          onClick={handleStartWorkout}
          className="mt-4 bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-lg font-bold text-lg"
        >
          Iniciar Entrenamiento
        </button>
      )}

      {showRegisterModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-8 rounded-lg max-w-md w-full">
            <h2 className="text-2xl font-bold mb-4">Registro Rápido</h2>
            <input
              type="text"
              placeholder="Tu nombre"
              className="w-full p-3 rounded bg-gray-700 text-white mb-4"
              id="register-name"
            />
            <div className="flex space-x-4">
              <button
                onClick={() => {
                  const nameInput = document.getElementById('register-name') as HTMLInputElement;
                  if (nameInput.value) {
                    handleRegister(nameInput.value);
                  }
                }}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold"
              >
                Registrarse
              </button>
              <button
                onClick={() => {
                  setShowRegisterModal(false);
                  handleNo();
                }}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg font-bold"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
