import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { InstructorAvatar, type AvatarState } from './InstructorAvatar';
import { api, log } from '../services/api';

declare global {
  interface Window {
    FaceDetection: any;
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

export const UserIdentification: React.FC<{ onUserIdentified: (user: User, stream?: MediaStream | null) => void }> = ({ onUserIdentified }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const faceDetectionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  const isProcessingFrameRef = useRef(false);
  const hasTransitionedRef = useRef(false);
  const isInitializedRef = useRef(false);
  
  const isDetectingRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef<any>(null);

  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [message, setMessage] = useState<string>('Cargando sistema...');
  const [showButtons, setShowButtons] = useState(false);
  const [faceStableCount, setFaceStableCount] = useState(0);

  // Refs espejo para evitar closures stale en callbacks de voz/MediaPipe
  const showButtonsRef = useRef(false);
  const currentUserRef = useRef<User | null>(null);

  // Control del bucle de escucha automática
  const shouldListenRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);

  // TTS bloqueado por autoplay: guardamos lo pendiente para reintentar con un gesto del usuario
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const pendingSpeakRef = useRef<{ text: string; callback?: () => void } | null>(null);

  const updateShowButtons = (v: boolean) => { setShowButtons(v); showButtonsRef.current = v; };
  const updateCurrentUser = (u: User | null) => { currentUserRef.current = u; };

  const [members, setMembers] = useState<User[]>([]);
  const [selectedMember, setSelectedMember] = useState<User | null>(null);
  const [mode, setMode] = useState<'detecting' | 'members'>('detecting');
  const membersRef = useRef<User[]>([]);
  const selectedMemberRef = useRef<User | null>(null);

  const selectMember = useCallback((user: User | null) => {
    setSelectedMember(user);
    selectedMemberRef.current = user;
  }, []);

  const addMember = useCallback((user: User) => {
    setMembers(prev => {
      if (prev.some(m => m.id === user.id)) return prev;
      return [...prev, user];
    });
    selectMember(user);
  }, [selectMember]);
  
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
    log('TTS', 'Speak', { text, hasCallback: !!callback });
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      isSpeakingRef.current = true;
      stopListening();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES';
      utterance.rate = 1;
      utterance.pitch = 1;

      utterance.onstart = () => {
        log('TTS', 'onstart: reproduciendo audio');
        setAvatarState('speaking');
      };
      utterance.onend = () => {
        setAvatarState('idle');
        isSpeakingRef.current = false;
        log('TTS', 'Fin de habla', { hasCallback: !!callback });
        if (callback) {
          callback();
        } else {
          startListening();
        }
      };
      utterance.onerror = (e: any) => {
        const err = e?.error || 'unknown';
        log('TTS', 'Error de síntesis', { error: err });
        // 'canceled'/'interrupted' = otro speak() lo reemplazó; no continuar el flujo desde acá
        if (err === 'canceled' || err === 'interrupted') return;
        setAvatarState('idle');
        isSpeakingRef.current = false;
        if (err === 'not-allowed') {
          // Autoplay policy: el navegador exige un gesto del usuario para reproducir audio
          pendingSpeakRef.current = { text, callback };
          setVoiceBlocked(true);
          setMessage('Tocá la pantalla para activar la voz');
          return;
        }
        // Otros errores: continuar el flujo sin audio para no colgar la app
        if (callback) {
          callback();
        } else {
          startListening();
        }
      };

      window.speechSynthesis.speak(utterance);
      // Chrome puede dejar la cola pausada después de cancel()
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      // Watchdog: si en 1.5s no arrancó ni terminó ni encoló, el navegador lo bloqueó en silencio
      setTimeout(() => {
        const synth = window.speechSynthesis;
        if (isSpeakingRef.current && !synth.speaking && !synth.pending) {
          log('TTS', 'Watchdog: utterance nunca inició (bloqueo silencioso)', { paused: synth.paused });
          isSpeakingRef.current = false;
          setAvatarState('idle');
          pendingSpeakRef.current = { text, callback };
          setVoiceBlocked(true);
          setMessage('Tocá la pantalla para activar la voz');
        }
      }, 1500);
    } else {
      if (callback) callback();
    }
  };

  const stopListening = () => {
    if (isListeningRef.current) {
      console.log("🎤 [Microfóno]: Deteniendo escucha.");
    }
    shouldListenRef.current = false;
    isListeningRef.current = false;
    setIsListening(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
  };

  const startListening = () => {
    if (isSpeakingRef.current || isListeningRef.current) {
      log('MIC', 'startListening ignorado (hablando o ya escuchando)');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("🎤 [Microfóno]: SpeechRecognition no soportado en este navegador.");
      setMicBlocked(true);
      return;
    }

    // Limpiar instancia previa sin apagar la intención de escuchar
    shouldListenRef.current = true;
    isListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }

    const recog = new SpeechRecognition();
    recog.lang = 'es-ES';
    recog.continuous = false;
    recog.interimResults = false;

    recog.onresult = (event: any) => {
      if (!isListeningRef.current) return;
      const transcript = event.results[0][0].transcript.trim();
      log('MIC', 'Voz capturada', { transcript });
      
      stopListening();
      handleVoiceCommand(transcript);
    };

    recog.onerror = (err: any) => {
      log('MIC', 'Error de micrófono', { error: err?.error });
      setAvatarState('idle');
      isListeningRef.current = false;
      setIsListening(false);

      const errorType = err?.error || '';
      if (errorType === 'not-allowed' || errorType === 'service-not-allowed') {
        // El navegador bloqueó el micrófono: requiere gesto manual del usuario
        console.warn("🎤 [Microfóno]: Permiso bloqueado. Se requiere botón manual.");
        shouldListenRef.current = false;
        setMicBlocked(true);
      } else if (errorType === 'no-speech' || errorType === 'aborted') {
        // Silencio o abort: onend se encargará de reconectar
      }
    };

    recog.onend = () => {
      log('MIC', 'onend disparado', { shouldListen: shouldListenRef.current, isSpeaking: isSpeakingRef.current });
      setAvatarState('idle');
      isListeningRef.current = false;
      setIsListening(false);

      // Bucle de reconexión automática: si el flujo espera escucha y no estamos hablando, reiniciar
      if (shouldListenRef.current && !isSpeakingRef.current) {
        console.log("🎤 [Microfóno]: Reconectando escucha en 600ms...");
        setTimeout(() => {
          if (shouldListenRef.current && !isSpeakingRef.current && !isListeningRef.current) {
            startListening();
          }
        }, 600);
      }
    };

    recognitionRef.current = recog;
    try {
      recog.start();
      isListeningRef.current = true;
      setIsListening(true);
      setMicBlocked(false);
      setAvatarState('listening');
      log('MIC', 'Escuchando activamente');
    } catch (err) {
      console.error("🎤 [Microfóno Start Error]:", err);
      isListeningRef.current = false;
      setIsListening(false);
      // Reintento con retardo por si el navegador rechazó el start inmediato
      setTimeout(() => {
        if (shouldListenRef.current && !isSpeakingRef.current && !isListeningRef.current) {
          startListening();
        }
      }, 800);
    }
  };

  const getFaceArea = (detection: any): number => {
    const bbox = detection?.boundingBox || detection?.relativeBoundingBox;
    if (!bbox) return 0;
    return (bbox.width || 0) * (bbox.height || 0);
  };

  const selectLargestFace = (detections: any[]): any | null => {
    if (!detections || detections.length === 0) return null;
    return detections.reduce((largest, current) => {
      return getFaceArea(current) > getFaceArea(largest) ? current : largest;
    }, detections[0]);
  };

  const extractEmbedding = (detection: any): number[] => {
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
    const t0 = performance.now();
    log('IDENTIFY', 'Enviando embedding al backend', { embeddingLen: embedding.length });
    const payload = { face_embedding: embedding };
    try {
      setMessage('Identificando rostro...');
      setAvatarState('listening');

      const response = await api.post<FaceDetectionResult>('/users/identify', payload, {
        timeout: 60000
      });

      log('IDENTIFY', 'Respuesta recibida', { identified: response.data.identified, user: response.data.user?.name, elapsed_ms: Math.round(performance.now() - t0) });

      if (response.data.identified && response.data.user) {
        updateCurrentUser(response.data.user);
        addMember(response.data.user);
        setMode('members');
        speak(`Hola ${response.data.user.name}. ¿Deseas iniciar tu rutina?`);
        setMessage(`Hola ${response.data.user.name}`);
      } else {
        log('IDENTIFY', 'Usuario no reconocido -> iniciando registro por voz');
        isDetectingRef.current = true;
        updateRegistrationStep('asking_name');
        speak('No te reconozco. ¿Cómo te llamas?', () => {
          startListening();
        });
        setMessage('Dime tu nombre...');
      }
    } catch (error: any) {
      log('IDENTIFY', 'Error de conexión', { message: error?.message, elapsed_ms: Math.round(performance.now() - t0) });
      setMessage('Error de conexión.');
      setTimeout(() => {
          isDetectingRef.current = false;
          setFaceStableCount(0);
      }, 3000);
    }
  }, [addMember]);

  const onFaceDetectionResults = useCallback((results: any) => {
    if (isDetectingRef.current) return;

    const numFaces = results.detections ? results.detections.length : 0;
    if (numFaces > 0 || faceStableCount > 0) {
      log('FACE', 'onResults', { faces: numFaces, stableCount: faceStableCount });
    }

    if (results.detections && results.detections.length > 0) {
      const largest = selectLargestFace(results.detections);
      if (!largest) {
        setFaceStableCount(0);
        lastEmbeddingRef.current = null;
        return;
      }

      const embedding = extractEmbedding(largest);
      if (embedding.length > 0) {
        lastEmbeddingRef.current = embedding;
        setFaceStableCount(prev => {
          const newCount = prev + 1;
          if (newCount >= 15 && !isDetectingRef.current) {
            log('FACE', '15 frames estables -> ejecutando identificación');
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
    log('VOICE', 'Comando recibido', { step: currentStep, transcript });

    // Si estamos en idle, manejamos el flujo normal de rutina de usuario ya registrado
    if (currentStep === 'idle') {
      // Nota: \b no funciona tras caracteres acentuados en JS, usamos lookarounds con \s/inicio
      const isAffirmative = /(^|\s)(s[ií]|yes|okay|ok|dale|claro|vamos|empezar?|iniciar?|comenzar?|rutina)/i.test(transcript);
      const isNegative = /(^|\s)(no|nunca|jamás|todavía no|todavia no|espera)/i.test(transcript);

      const hasMember = selectedMemberRef.current || membersRef.current.length > 0;
      if (isAffirmative && hasMember) {
        const user = selectedMemberRef.current || membersRef.current[membersRef.current.length - 1];
        log('VOICE', 'Confirmación afirmativa -> iniciando rutina', { user: user?.name });
        speak(`Perfecto${user?.name ? ' ' + user.name : ''}. Iniciando tu rutina.`);
        setTimeout(() => handleStartWorkoutForSelected(), 1200);
      } else if (isNegative && hasMember) {
        log('VOICE', 'Respuesta negativa -> agregar otro integrante');
        handleAddAnother();
      } else if (!hasMember) {
        // No hay usuario identificado esperando confirmación: ignorar ruido
        log('VOICE', 'Sin confirmación pendiente, ignorando', { transcript });
      } else {
        speak('No entendí. ¿Deseas iniciar tu rutina? Responde sí o no.', () => startListening());
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
      log('VOICE', 'Respuesta IA parse-speech', { nextStep, resolvedData, aiMessage });

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
      log('VOICE', 'Error en parse-speech', { error });
      speak('No te entendí bien, ¿podrías repetirlo?', () => {
        startListening();
      });
    }
  };

  const executeQuickRegister = async (name: string, goal: string) => {
    log('REGISTER', 'Ejecutando quick-register', { name, goal, hasEmbedding: !!lastEmbeddingRef.current });
    
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
      
      log('REGISTER', 'Usuario registrado', { id: response.data.id, name: response.data.name });
      updateCurrentUser(response.data);
      addMember(response.data);
      setMessage(`Bienvenido ${name}`);
      speak(`Bienvenido ${name}. ¿Quién más va a entrenar? Toca Iniciar rutina o Agregar otro.`, () => {});
      setMode('members');
    } catch (error) {
      log('REGISTER', 'Error en registro backend', { error });
      speak('Hubo un error al registrarte. Inténtalo nuevamente.');
      isDetectingRef.current = false;
    }
  };

  const handleStartWorkoutForSelected = useCallback(() => {
    stopListening();
    const user = selectedMemberRef.current || currentUserRef.current;
    log('FLOW', 'Iniciando workout', { user: user?.name });
    if (user) {
      hasTransitionedRef.current = true;
      onUserIdentified(user, streamRef.current);
    }
  }, [onUserIdentified]);

  const handleAddAnother = () => {
    stopListening();
    updateCurrentUser(null);
    updateShowButtons(false);
    updateRegistrationStep('idle');
    isDetectingRef.current = false;
    setFaceStableCount(0);
    pendingNameRef.current = '';
    lastEmbeddingRef.current = null;
    setMode('detecting');
    setMessage('Colócate frente a la cámara para agregar otro integrante');
    speak('Colócate frente a la cámara para agregar otro integrante.', () => {});
  };

  const handleResetAll = () => {
    log('FLOW', 'Reset completo de identificación');
    stopListening();
    updateCurrentUser(null);
    updateShowButtons(false);
    updateRegistrationStep('idle');
    isDetectingRef.current = false;
    setFaceStableCount(0);
    pendingNameRef.current = '';
    lastEmbeddingRef.current = null;
    setMembers([]);
    setSelectedMember(null);
    membersRef.current = [];
    selectedMemberRef.current = null;
    setMode('detecting');
    setMessage('Colócate frente a la cámara');
    speak('Esperando identificación.', () => {});
  };

  useEffect(() => {
    return () => {
      stopListening();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (faceDetectionRef.current) {
        try {
          faceDetectionRef.current.close();
        } catch (e) {}
        faceDetectionRef.current = null;
        globalFaceDetectionInstance = null;
      }
      if (hasTransitionedRef.current) {
        console.log('🔄 [UserIdentification cleanup]: cámara ya pasó a Workout, no detener tracks.');
      } else {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }
      }
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
      const t0 = performance.now();
      try {
        setMessage('Iniciando cámara...');
        log('INIT', 'Cargando script MediaPipe FaceDetection...');
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4/face_detection.js');
        log('INIT', 'Script MediaPipe cargado', { elapsed_ms: Math.round(performance.now() - t0) });
        if (typeof window.FaceDetection === 'undefined') throw new Error('FaceDetection no disponible');

        if (!globalFaceDetectionInstance) {
          const tModel = performance.now();
          globalFaceDetectionInstance = new window.FaceDetection({ locateFile: MEDIAPIPE_LOCATE_FILE });
          globalFaceDetectionInstance.setOptions({ model: 'full', minDetectionConfidence: 0.5 });
          await globalFaceDetectionInstance.initialize();
          log('INIT', 'Modelo FaceDetection inicializado', { elapsed_ms: Math.round(performance.now() - tModel) });
        } else {
          log('INIT', 'Reutilizando instancia global de FaceDetection');
        }
        globalFaceDetectionInstance.onResults((results: any) => onFaceDetectionResults(results));
        faceDetectionRef.current = globalFaceDetectionInstance;
        isInitializedRef.current = true;

        // Solicitamos el stream de cámara una sola vez y lo pasaremos a Workout sin recargarlo
        const tCam = performance.now();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
          audio: false
        });
        log('INIT', 'Stream de cámara obtenido', { elapsed_ms: Math.round(performance.now() - tCam) });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try { await videoRef.current.play(); } catch (e) {}
        }
        setMessage('Colócate frente a la cámara');

        // Bucle manual: detectamos cada 3 frames sin depender de Camera Utils
        const loop = async () => {
          if (hasTransitionedRef.current) return;
          frameCountRef.current += 1;
          if (
            frameCountRef.current % 3 === 0 &&
            videoRef.current &&
            faceDetectionRef.current &&
            !isDetectingRef.current &&
            !isProcessingFrameRef.current &&
            videoRef.current.readyState >= 2
          ) {
            isProcessingFrameRef.current = true;
            try {
              await faceDetectionRef.current.send({ image: videoRef.current });
            } catch (error) {
              console.error('❌ [FaceDetection send error]:', error);
            } finally {
              isProcessingFrameRef.current = false;
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
        log('INIT', 'Bucle de detección iniciado', { total_init_ms: Math.round(performance.now() - t0) });

      } catch (error) {
        log('INIT', 'Error inicialización cámara/modelo', { error });
        setMessage('Error al iniciar la cámara o el modelo facial.');
      }
    };
    log('INIT', 'UserIdentification montado, inicializando MediaPipe...');
    initializeMediaPipe();
  }, [onFaceDetectionResults]);

  // Desbloqueo de TTS: el primer gesto del usuario reintenta el mensaje pendiente
  useEffect(() => {
    const unlock = () => {
      if (pendingSpeakRef.current) {
        const pending = pendingSpeakRef.current;
        pendingSpeakRef.current = null;
        setVoiceBlocked(false);
        log('TTS', 'Gesto del usuario detectado: reintentando mensaje pendiente');
        speak(pending.text, pending.callback);
      }
    };
    document.addEventListener('pointerdown', unlock);
    return () => document.removeEventListener('pointerdown', unlock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="overlay-container">
      {/* Cámara a pantalla completa */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="camera-fullscreen"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60 pointer-events-none" />

      {/* Overlay superior: estado de detección */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
        <div className="bg-black/60 backdrop-blur-md border border-white/10 px-5 py-2 rounded-full shadow-xl">
          <p className="text-xs text-gray-200 font-medium">
            {faceStableCount > 0
              ? `Detectando rostro... ${Math.min(faceStableCount, 60)}/60`
              : 'Esperando detección facial...'}
          </p>
        </div>
      </div>

      {/* Overlay inferior: orbe + mensaje + acciones */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center space-y-4 w-full max-w-md px-6">
        {/* Orbe del asistente */}
        <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
          avatarState === 'speaking'
            ? 'bg-blue-500/80 shadow-[0_0_50px_rgba(59,130,246,0.8)] scale-110'
            : avatarState === 'listening'
              ? 'bg-green-500/70 shadow-[0_0_40px_rgba(34,197,94,0.7)] animate-pulse'
              : 'bg-blue-600/50 shadow-[0_0_25px_rgba(59,130,246,0.4)]'
        }`}>
          <InstructorAvatar state={avatarState} message="" />
        </div>

        {/* Mensaje del asistente */}
        <div className="bg-black/60 backdrop-blur-md border border-white/10 px-5 py-3 rounded-2xl shadow-xl w-full text-center">
          <p className="text-sm font-medium text-gray-100">{message}</p>
        </div>

        {/* Aviso de voz bloqueada por autoplay */}
        {voiceBlocked && (
          <button
            onClick={() => {
              if (pendingSpeakRef.current) {
                const pending = pendingSpeakRef.current;
                pendingSpeakRef.current = null;
                setVoiceBlocked(false);
                speak(pending.text, pending.callback);
              }
            }}
            className="bg-blue-600/90 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-lg transition animate-pulse"
          >
            🔊 Tocar para activar la voz
          </button>
        )}

        {/* Acciones */}
        {mode === 'members' ? (
          <div className="bg-black/70 backdrop-blur-md border border-white/10 px-5 py-4 rounded-2xl shadow-xl w-full space-y-4">
            <p className="text-sm font-medium text-gray-100">Integrantes detectados:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {members.map((m) => (
                <button
                  key={m.id}
                  onClick={() => selectMember(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                    selectedMember?.id === m.id ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-200 hover:bg-white/20'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => handleStartWorkoutForSelected()}
                className="flex-1 bg-green-600/90 hover:bg-green-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg transition"
              >
                Iniciar rutina
              </button>
              <button
                onClick={handleAddAnother}
                className="flex-1 bg-blue-600/90 hover:bg-blue-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg transition"
              >
                Agregar otro
              </button>
              <button
                onClick={handleResetAll}
                className="flex-1 bg-red-600/90 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg transition"
              >
                Reiniciar
              </button>
            </div>
          </div>
        ) : (
          <>
            {faceStableCount === 0 && registrationStep === 'idle' && !showButtons && (
              <button
                onClick={() => {
                  speak('No te alcanzo a ver bien, acércate un poco a la cámara');
                  setMessage('No te alcanzo a ver bien, acércate un poco a la cámara');
                }}
                className="bg-yellow-600/90 hover:bg-yellow-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-lg transition"
              >
                No me veo bien
              </button>
            )}

            {showButtons && registrationStep === 'idle' && (
              <div className="flex space-x-3 w-full">
                <button
                  onClick={() => { speak(`Perfecto. Iniciando tu rutina.`, () => {}); setTimeout(() => handleStartWorkoutForSelected(), 1200); }}
                  className="flex-1 bg-green-600/90 hover:bg-green-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg transition"
                >
                  Sí, iniciar rutina
                </button>
                <button
                  onClick={handleAddAnother}
                  className="flex-1 bg-blue-600/90 hover:bg-blue-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg transition"
                >
                  Agregar otro
                </button>
                <button
                  onClick={handleResetAll}
                  className="flex-1 bg-red-600/90 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg transition"
                >
                  Reiniciar
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Botón flotante de micrófono: indicador de estado + escucha manual de respaldo */}
      <button
        onClick={() => {
          if (isListening) {
            stopListening();
          } else {
            startListening();
          }
        }}
        title={micBlocked ? 'Micrófono bloqueado: toca para reintentar' : isListening ? 'Escuchando... toca para detener' : 'Toca para hablar'}
        className={`fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
          micBlocked
            ? 'bg-red-600/90 hover:bg-red-700 animate-pulse'
            : isListening
              ? 'bg-green-500/90 shadow-[0_0_25px_rgba(34,197,94,0.7)] animate-pulse'
              : 'bg-gray-700/80 backdrop-blur-md hover:bg-gray-600'
        }`}
      >
        {micBlocked ? (
          <MicOff className="w-6 h-6 text-white" />
        ) : (
          <Mic className="w-6 h-6 text-white" />
        )}
      </button>
    </div>
  );
};