import React, { useRef, useEffect, useState, useCallback } from 'react';
import { InstructorAvatar, type AvatarState } from './InstructorAvatar';
import { api } from '../services/api';

declare global {
  interface Window {
    FaceDetection: any;
    Camera: any;
  }
}

const MEDIAPIPE_LOCATE_FILE = (file: string): string => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4/${file}`;
};

let globalFaceDetectionInstance: any = null;

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
  
  const isDetectingRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef<any>(null);

  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [message, setMessage] = useState<string>('Cargando sistema...');
  const [showButtons, setShowButtons] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [faceStableCount, setFaceStableCount] = useState(0);
  
  // Referencias seguras para la IA y los datos temporales
  const lastEmbeddingRef = useRef<number[] | null>(null);
  const pendingNameRef = useRef<string>('');
  const registrationStepRef = useRef<'idle' | 'asking_name' | 'asking_goal'>('idle');
  const [registrationStep, setRegistrationStep] = useState<'idle' | 'asking_name' | 'asking_goal'>('idle');

  const updateRegistrationStep = (step: 'idle' | 'asking_name' | 'asking_goal') => {
    setRegistrationStep(step);
    registrationStepRef.current = step;
  };

  const speak = (text: string, callback?: () => void) => {
    console.log("🗣️ [TTS Speak]:", text);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      isSpeakingRef.current = true;
      stopListening();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES';
      utterance.rate = 1;
      utterance.pitch = 1;
      
      utterance.onstart = () => setAvatarState('speaking');
      utterance.onend = () => {
        setAvatarState('idle');
        isSpeakingRef.current = false;
        console.log("🗣️ [TTS Fin]. Callback existe?", !!callback);
        if (callback) {
          callback();
        } else {
          startListening();
        }
      };
      
      window.speechSynthesis.speak(utterance);
    } else {
      if (callback) callback();
    }
  };

  const stopListening = () => {
    if (isListeningRef.current) {
      console.log("🎤 [Microfóno]: Deteniendo escucha.");
    }
    isListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
  };

  const startListening = () => {
    if (isSpeakingRef.current || isListeningRef.current) {
      console.log("🎤 [Microfóno]: No se puede iniciar (hablando o ya escuchando).");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("🎤 [Microfóno]: SpeechRecognition no soportado en este navegador.");
      return;
    }

    stopListening();

    const recog = new SpeechRecognition();
    recog.lang = 'es-ES';
    recog.continuous = false;
    recog.interimResults = false;

    recog.onresult = (event: any) => {
      if (!isListeningRef.current) return;
      const transcript = event.results[0][0].transcript.trim();
      console.log("🎙️ [VOZ CAPTURADA EXITOSA]:", transcript);
      
      stopListening();
      handleVoiceCommand(transcript);
    };

    recog.onerror = (err: any) => {
      console.error("🎤 [Microfóno Error]:", err);
      setAvatarState('idle');
      isListeningRef.current = false;
    };

    recog.onend = () => {
      console.log("🎤 [Microfóno]: Evento onend disparado.");
      setAvatarState('idle');
      isListeningRef.current = false;
    };

    recognitionRef.current = recog;
    try {
      recog.start();
      isListeningRef.current = true;
      setAvatarState('listening');
      console.log("🎤 [Microfóno]: Escuchando activamente...");
    } catch (err) {
      console.error("🎤 [Microfóno Start Error]:", err);
      isListeningRef.current = false;
    }
  };

  const extractEmbedding = (detections: any): number[] => {
    if (!detections || !Array.isArray(detections) || detections.length === 0) return [];
    const detection = detections[0];
    if (!detection) return [];
    const embedding: number[] = [];
    const bbox = detection.boundingBox || detection.relativeBoundingBox;
    if (bbox) {
      embedding.push(
        bbox.xCenter || bbox.xmin || 0,
        bbox.yCenter || bbox.ymin || 0,
        bbox.width || (bbox.xmax - bbox.xmin) || 0,
        bbox.height || (bbox.ymax - bbox.ymin) || 0
      );
    }
    const keypoints = detection.keypoints;
    if (keypoints && Array.isArray(keypoints)) {
      keypoints.forEach((point: any) => {
        if (point && typeof point.x === 'number' && typeof point.y === 'number') {
          embedding.push(point.x, point.y);
        }
      });
    }
    const categories = detection.categories;
    if (categories && categories.length > 0) {
      embedding.push(categories[0].score || 0);
    }
    if (embedding.length < 10 && bbox) {
      const padding = 10 - embedding.length;
      for (let i = 0; i < padding; i++) {
        embedding.push(bbox.xCenter || 0);
      }
    }
    return embedding;
  };

  const identifyUser = useCallback(async (embedding: number[]) => {
    console.log("🔍 [Identificación]: Enviando embedding al backend...");
    const payload = { face_embedding: embedding };
    try {
      setMessage('Identificando rostro...');
      setAvatarState('listening');

      const response = await api.post<FaceDetectionResult>('/users/identify', payload, {
        timeout: 60000
      });

      console.log("🔍 [Identificación Respuesta]:", response.data);

      if (response.data.identified && response.data.user) {
        setCurrentUser(response.data.user);
        setShowButtons(true);
        speak(`Hola ${response.data.user.name}. ¿Deseas iniciar tu rutina?`);
        setMessage(`Hola ${response.data.user.name}`);
      } else {
        console.log("👤 [Identificación]: Usuario no reconocido. Iniciando registro por IA.");
        isDetectingRef.current = true;
        updateRegistrationStep('asking_name');
        speak('No te reconozco. ¿Cómo te llamas?', () => {
          startListening();
        });
        setMessage('Dime tu nombre...');
      }
    } catch (error: any) {
      console.error('❌ [Error identificación]:', error);
      setMessage('Error de conexión.');
      setTimeout(() => {
          isDetectingRef.current = false;
          setFaceStableCount(0);
      }, 3000);
    }
  }, []);

  const onFaceDetectionResults = useCallback((results: any) => {
    if (isDetectingRef.current) return;

    if (results.detections && results.detections.length > 0) {
      const embedding = extractEmbedding(results.detections);
      if (embedding.length > 0) {
        lastEmbeddingRef.current = embedding;
        setFaceStableCount(prev => {
          const newCount = prev + 1;
          if (newCount >= 60 && !isDetectingRef.current) {
            console.log("🎯 [FaceDetection]: 60 fotogramas estables alcanzados. Ejecutando identificación.");
            isDetectingRef.current = true;
            identifyUser(embedding);
          }
          return newCount;
        });
      }
    } else {
      setFaceStableCount(0);
      lastEmbeddingRef.current = null;
    }
  }, [identifyUser]);

  // NUEVO: Manejador inteligente que consulta al backend de IA (/api/v1/ai/parse-speech)
  const handleVoiceCommand = async (transcript: string) => {
    const currentStep = registrationStepRef.current;
    console.log("🤖 [IA Voice Parse]: Paso actual =", currentStep, "| Texto capturado =", transcript);

    // Si estamos en idle, manejamos el flujo normal de rutina de usuario ya registrado
    if (currentStep === 'idle') {
      const isAffirmative = /s[ií]|yes|okay|ok|dale|claro/i.test(transcript);
      const isNegative = /no|nunca|jamás/i.test(transcript);

      if (isAffirmative && showButtons) {
        handleYes();
        setTimeout(() => handleStartWorkout(), 1000);
      } else if (isNegative && showButtons) {
        handleNo();
      } else {
        speak('No entendí. Por favor repite.', () => startListening());
      }
      return;
    }

    try {
      setMessage('Procesando con IA...');
      const response = await api.post('/ai/parse-speech', {
        step: currentStep,
        transcript: transcript,
        context: { name: pendingNameRef.current }
      });

      const { nextStep, resolvedData, aiMessage } = response.data;
      console.log("🤖 [IA Respuesta]:", { nextStep, resolvedData, aiMessage });

      // Guardamos los datos que la IA pudo extraer con éxito
      if (resolvedData?.name) {
        pendingNameRef.current = resolvedData.name;
      }

      const goalToUse = resolvedData?.goal || 'salud_general';

      // Si la IA indica que completamos el registro, ejecutamos el guardado
      if (nextStep === 'completed' || currentStep === 'asking_goal') {
        updateRegistrationStep('idle');
        speak(aiMessage, () => {
          executeQuickRegister(pendingNameRef.current, goalToUse);
        });
        return;
      }

      // Si avanzamos al siguiente paso conversacional
      updateRegistrationStep(nextStep);
      speak(aiMessage, () => {
        startListening();
      });
      setMessage('Escuchando respuesta...');

    } catch (error) {
      console.error('❌ [Error IA Parse Speech]:', error);
      speak('No te entendí bien, ¿podrías repetirlo?', () => {
        startListening();
      });
    }
  };

  const executeQuickRegister = async (name: string, goal: string) => {
    console.log("🚀 [executeQuickRegister]: Registrando usuario...", { name, goal, hasEmbedding: !!lastEmbeddingRef.current });
    
    if (!lastEmbeddingRef.current) {
      console.error("❌ [executeQuickRegister Error]: No hay embedding guardado en la referencia.");
      speak('No pude capturar tu rostro. Inténtalo nuevamente.');
      isDetectingRef.current = false;
      return;
    }

    try {
      setMessage('Registrando datos...');
      const response = await api.post<User>('/users/quick-register', {
        name: name || 'Usuario',
        face_embedding: lastEmbeddingRef.current,
        primary_goal: goal,
        target_rpe: 7.0
      });
      
      console.log("🚀 [executeQuickRegister Éxito]:", response.data);
      setCurrentUser(response.data);
      setShowButtons(true);
      setMessage(`Bienvenido ${name}`);
      
      setTimeout(() => {
        onUserIdentified(response.data);
      }, 2000);
    } catch (error) {
      console.error('❌ [Error registro backend]:', error);
      speak('Hubo un error al registrarte. Inténtalo nuevamente.');
      isDetectingRef.current = false;
    }
  };

  const handleYes = () => {
    stopListening();
    if (currentUser) {
      speak(`Excelente ${currentUser.name}. Iniciando rutina.`);
    }
  };

  const handleNo = () => {
    stopListening();
    speak('Entendido. Esperando a que te identifiques.');
    setMessage('Colócate frente a la cámara');
    setCurrentUser(null);
    setShowButtons(false);
    updateRegistrationStep('idle');
    isDetectingRef.current = false;
    setFaceStableCount(0);
    pendingNameRef.current = '';
  };

  const handleStartWorkout = () => {
    stopListening();
    if (currentUser) {
      onUserIdentified(currentUser);
    }
  };

  useEffect(() => {
    return () => {
      stopListening();
      if (cameraRef.current) cameraRef.current.stop();
      if (faceDetectionRef.current) faceDetectionRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (!videoRef.current || isInitializedRef.current) return;

    const loadScript = (src: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Error cargando ${src}`));
        document.head.appendChild(script);
      });
    };

    const initializeMediaPipe = async () => {
      try {
        setMessage('Iniciando cámara...');
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4/face_detection.js');
        if (typeof window.FaceDetection === 'undefined') throw new Error('FaceDetection no disponible');

        if (!globalFaceDetectionInstance) {
          globalFaceDetectionInstance = new window.FaceDetection({ locateFile: MEDIAPIPE_LOCATE_FILE });
          globalFaceDetectionInstance.setOptions({ model: 'full', minDetectionConfidence: 0.6 });
          await globalFaceDetectionInstance.initialize();
        }
        globalFaceDetectionInstance.onResults((results: any) => onFaceDetectionResults(results));
        faceDetectionRef.current = globalFaceDetectionInstance;
        isInitializedRef.current = true;

        const camera = new window.Camera(videoRef.current, {
          onFrame: async () => {
            if (faceDetectionRef.current && videoRef.current && !isDetectingRef.current) {
              try {
                await faceDetectionRef.current.send({ image: videoRef.current });
              } catch (error) {}
            }
          },
          width: 640,
          height: 480
        });
        await camera.start();
        cameraRef.current = camera;
        setMessage('Colócate frente a la cámara');

      } catch (error) {
        console.error('❌ [Error inicialización cámara]:', error);
        setMessage('Error al iniciar la cámara o el modelo facial.');
      }
    };
    initializeMediaPipe();
  }, [onFaceDetectionResults]);

  return (
    <div className="fixed inset-0 w-screen h-screen z-50 overflow-hidden bg-black">
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted 
        className="absolute inset-0 w-full h-full object-cover transform -scale-x-100 z-0"
      />
      <div className="absolute inset-0 bg-black/30 z-10 pointer-events-none" />

      <div className="absolute inset-0 z-20 flex flex-col justify-between p-6 pointer-events-none">
        <div className="flex flex-col items-center pt-6 pointer-events-auto">
          <div className="bg-gray-900/80 backdrop-blur-md border border-gray-700/60 p-4 rounded-2xl shadow-2xl flex flex-col items-center space-y-2 max-w-sm w-full">
            <InstructorAvatar state={avatarState} message={message} />
            <p className="text-xs text-gray-300 bg-black/50 py-1 px-3 rounded-full backdrop-blur-sm">
              {faceStableCount > 0 
                ? `Detectando rostro... ${Math.min(faceStableCount, 60)}/60` 
                : 'Esperando detección facial...'}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center pb-6 space-y-3 w-full max-w-sm mx-auto pointer-events-auto">
          {faceStableCount === 0 && registrationStep === 'idle' && (
            <button
              onClick={() => {
                speak('No te alcanzo a ver bien, acércate un poco a la cámara');
                setMessage('No te alcanzo a ver bien, acércate un poco a la cámara');
              }}
              className="w-full bg-yellow-600/90 hover:bg-yellow-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg backdrop-blur-sm transition"
            >
              No me veo bien
            </button>
          )}

          {showButtons && registrationStep === 'idle' && (
            <div className="flex space-x-3 w-full">
              <button
                onClick={handleYes}
                className="flex-1 bg-green-600/90 hover:bg-green-700 text-white py-3 rounded-xl font-bold text-base shadow-lg backdrop-blur-sm transition"
              >
                Sí
              </button>
              <button
                onClick={handleNo}
                className="flex-1 bg-red-600/90 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-base shadow-lg backdrop-blur-sm transition"
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};