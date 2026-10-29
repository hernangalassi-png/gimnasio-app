import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { InstructorAvatar, type AvatarState } from './InstructorAvatar';
import { api, log } from '../services/api';
import { applySpanishVoice } from '../services/tts';

declare global {
  interface Window {
    FaceDetection: any;
    FaceMesh: any;
  }
}

const MEDIAPIPE_LOCATE_FILE = (file: string): string => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4/${file}`;
};

let globalFaceDetectionInstance: any = null;
let globalFaceMeshInstance: any = null;

interface User {
  id: string;
  name: string;
  primary_goal?: string;
}

interface FaceDetectionResult {
  identified: boolean;
  user?: User;
  candidate?: User;
  similarity?: number;
}

// Tipos de entrenamiento que se ofrecen al identificar al usuario.
// El orden importa: 'peso muerto' debe matchear fuerza antes que descenso_peso ('peso').
const TRAINING_GOALS: Array<{ goal: string; label: string; re: RegExp }> = [
  { goal: 'fuerza', label: 'fuerza', re: /fuerza|fuerte|pesas|peso muerto|strength/i },
  { goal: 'hipertrofia', label: 'hipertrofia', re: /hipertrofia|volumen|m[úu]sculo|masa muscular|crecer/i },
  { goal: 'resistencia', label: 'resistencia', re: /resistencia|cardio|aguante|aer[óo]bico/i },
  { goal: 'movilidad', label: 'movilidad', re: /movilidad|flexibilidad|estirar|elongar/i },
  { goal: 'descenso_peso', label: 'descenso de peso', re: /bajar|perder|adelgazar|peso|quemar|grasa/i },
  { goal: 'salud_general', label: 'salud general', re: /salud|general|mantener|forma|tonificar/i },
];

const mapTrainingType = (transcript: string): { goal: string; label: string } | null => {
  for (const t of TRAINING_GOALS) {
    if (t.re.test(transcript)) return { goal: t.goal, label: t.label };
  }
  return null;
};

export const UserIdentification: React.FC<{ onUserIdentified: (user: User, members: User[], stream?: MediaStream | null, sessionGoal?: string | null) => void }> = ({ onUserIdentified }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const faceDetectionRef = useRef<any>(null);
  const faceMeshRef = useRef<any>(null);
  const meshEmbeddingRef = useRef<number[] | null>(null);
  const isProcessingMeshRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  const meshWaitStartRef = useRef(0);
  const stableFramesRef = useRef(0);
  const lastDetectionResultsRef = useRef<any>(null);
  const lastDeliveryMsRef = useRef(0);
  const resultsCountRef = useRef(0);
  const missesRef = useRef(0);
  const meshFirstResultLoggedRef = useRef(false);
  const meshBadLandmarksLoggedRef = useRef(false);
  const meshLastBadLogRef = useRef(0);
  const meshGoodRef = useRef(0);
  const meshDeadCountRef = useRef(0);
  const meshRecreateAttemptsRef = useRef(0);
  const meshGaveUpRef = useRef(false);
  const meshRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Resultado explícito del reconocimiento facial para el icono rostro
  const [faceIconResult, setFaceIconResult] = useState<'success' | 'error' | null>(null);

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
  const pendingCandidateRef = useRef<User | null>(null);
  const registrationStepRef = useRef<'idle' | 'asking_name' | 'asking_goal' | 'asking_session_goal' | 'confirming_identity'>('idle');
  const [registrationStep, setRegistrationStep] = useState<'idle' | 'asking_name' | 'asking_goal' | 'asking_session_goal' | 'confirming_identity'>('idle');
  const pendingSessionGoalRef = useRef<string | null>(null);
  const greetedRef = useRef(false); // "Hola {nombre}" solo en la PRIMERA identificación de la sesión

  const updateRegistrationStep = (step: 'idle' | 'asking_name' | 'asking_goal' | 'asking_session_goal' | 'confirming_identity') => {
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
      const chosenVoice = applySpanishVoice(utterance);
      log('TTS', 'Voz seleccionada', { name: chosenVoice?.name, lang: chosenVoice?.lang });
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

  const cosineSim = (a: number[], b: number[]): number => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / ((Math.sqrt(na) * Math.sqrt(nb)) || 1e-9);
  };

  // 468 landmarks de FaceMesh -> embedding denso invariante a posición y escala.
  // Mucho más discriminativo que el geométrico (bbox+keypoints ~10 dims).
  const landmarksToEmbedding = (landmarks: any[]): { emb: number[]; good: number } | null => {
    if (!landmarks || landmarks.length < 400) return null;
    // En algunos devices/builds wasm, ciertos landmarks llegan NaN/Infinity en
    // CADA frame. Se imputan al centroide (0 post-normalización) en vez de
    // descartar todo el vector: la señal de identidad queda casi intacta.
    let cx = 0, cy = 0, good = 0, bad = 0;
    for (const p of landmarks) {
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) { cx += p.x; cy += p.y; good++; }
      else bad++;
    }
    if (good < 400) {
      const now = performance.now();
      if (now - meshLastBadLogRef.current > 3000) {
        meshLastBadLogRef.current = now;
        log('MESH', 'Demasiados landmarks inválidos, descartado', { good, bad });
      }
      return null;
    }
    if (bad > 0 && !meshBadLandmarksLoggedRef.current) {
      meshBadLandmarksLoggedRef.current = true;
      log('MESH', 'Landmarks no finitos -> imputados al centroide', { bad, total: landmarks.length });
    }
    cx /= good; cy /= good;
    // Escala = distancia RMS al centroide (invariante a zoom/posición)
    let scale = 0;
    for (const p of landmarks) {
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) scale += (p.x - cx) ** 2 + (p.y - cy) ** 2;
    }
    scale = Math.sqrt(scale / good) || 1e-6;
    const emb: number[] = [];
    for (const p of landmarks) {
      const ok = Number.isFinite(p.x) && Number.isFinite(p.y);
      emb.push(ok ? (p.x - cx) / scale : 0, ok ? (p.y - cy) / scale : 0);
    }
    return { emb, good };
  };

  // El wasm de FaceMesh en algunos devices entra en un estado corrupto donde
  // devuelve los 468 landmarks NaN en TODOS los frames. Tras ~25 resultados
  // muertos seguidos se recrea la instancia (máx 2 intentos); si no se
  // recupera, se apaga el envío de frames y queda el fallback geométrico.
  const handleMeshResults = (res: any) => {
    const lms = res.multiFaceLandmarks?.[0];
    if (!meshFirstResultLoggedRef.current) {
      meshFirstResultLoggedRef.current = true;
      log('MESH', 'Primer resultado FaceMesh', { hasLandmarks: !!lms, faces: res.multiFaceLandmarks?.length ?? 0 });
    }
    if (!lms) return;
    const out = landmarksToEmbedding(lms);
    if (out) {
      meshDeadCountRef.current = 0;
      // Solo actualizar si el nuevo vector tiene igual o más landmarks válidos
      if (out.good >= meshGoodRef.current) {
        const prev = meshEmbeddingRef.current;
        if (!prev) {
          log('MESH', 'Primer embedding FaceMesh recibido', { dims: out.emb.length });
          meshEmbeddingRef.current = out.emb;
          meshGoodRef.current = out.good;
        } else if (cosineSim(prev, out.emb) < 0.7) {
          // Cambio brusco del descriptor (probablemente otra persona):
          // reiniciar el promedio para no mezclar caras distintas
          meshEmbeddingRef.current = out.emb;
          meshGoodRef.current = out.good;
        } else {
          // EMA (alpha=0.3): suaviza el jitter frame a frame; lo que se envía a
          // /identify es un promedio temporal, mucho más estable que un snapshot
          const alpha = 0.3;
          const blended = new Array<number>(prev.length);
          for (let i = 0; i < prev.length; i++) blended[i] = prev[i] * (1 - alpha) + out.emb[i] * alpha;
          meshEmbeddingRef.current = blended;
          meshGoodRef.current = Math.max(meshGoodRef.current, out.good);
        }
      }
    } else if (!meshGaveUpRef.current) {
      meshDeadCountRef.current += 1;
      if (meshDeadCountRef.current >= 25) {
        meshDeadCountRef.current = 0;
        recreateFaceMesh();
      }
    }
  };

  const recreateFaceMesh = () => {
    if (typeof window.FaceMesh === 'undefined') return;
    meshRecreateAttemptsRef.current += 1;
    if (meshRecreateAttemptsRef.current > 2) {
      meshGaveUpRef.current = true;
      faceMeshRef.current = null; // el loop deja de enviarle frames
      log('MESH', 'FaceMesh inválido persistente -> pausa 20s y reintento');
      // No rendirse definitivamente: las ráfagas 100% NaN suelen ser un estado
      // transitorio del wasm (throttle/pestaña). Reintentar cada 20s.
      if (meshRetryTimerRef.current) clearTimeout(meshRetryTimerRef.current);
      meshRetryTimerRef.current = setTimeout(() => {
        if (!meshGaveUpRef.current || faceMeshRef.current) return;
        meshGaveUpRef.current = false;
        meshRecreateAttemptsRef.current = 0;
        meshDeadCountRef.current = 0;
        log('MESH', 'Reintentando FaceMesh tras pausa');
        recreateFaceMesh();
      }, 20000);
      return;
    }
    log('MESH', 'Landmarks 100% NaN sostenidos -> recreando instancia', { attempt: meshRecreateAttemptsRef.current });
    const old = faceMeshRef.current;
    faceMeshRef.current = null;
    // Reiniciar la ventana de espera para darle al wasm de la nueva instancia
    // sus ~2-3s de warm-up antes de caer al fallback geométrico.
    meshWaitStartRef.current = 0;
    try { old?.close(); } catch (e) {}
    const inst = new window.FaceMesh({ locateFile: (f: string) => `mediapipe/${f}` });
    inst.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5 });
    inst.onResults(handleMeshResults);
    inst.initialize()
      .then(() => {
        globalFaceMeshInstance = inst;
        faceMeshRef.current = inst;
        meshGoodRef.current = 0;
        log('MESH', 'Instancia FaceMesh recreada OK');
      })
      .catch((e: any) => {
        log('MESH', 'Recreate FaceMesh falló', { error: String(e) });
        meshGaveUpRef.current = true;
      });
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

      const doIdentify = () => api.post<FaceDetectionResult>('/users/identify', payload, { timeout: 60000 });

      // Cold start de Render puede colgar la primera request: reintentamos una vez
      // ante errores de red (sin respuesta) o 5xx transitorios.
      const isRetryable = (err: any) => !err.response || (err.response.status >= 500 && err.response.status < 600);
      let response;
      try {
        response = await doIdentify();
      } catch (firstErr: any) {
        if (!isRetryable(firstErr)) throw firstErr;
        log('IDENTIFY', 'Fallo retryable (posible cold start), reintentando en 3s', { message: firstErr?.message });
        setMessage('Despertando el servidor, un momento...');
        await new Promise(r => setTimeout(r, 3000));
        response = await doIdentify();
      }

      log('IDENTIFY', 'Respuesta recibida', { identified: response.data.identified, user: response.data.user?.name, elapsed_ms: Math.round(performance.now() - t0) });

      if (response.data.identified && response.data.user) {
        setFaceIconResult('success');
        updateCurrentUser(response.data.user);
        addMember(response.data.user);
        setMode('members');
        const greeting = greetedRef.current ? response.data.user.name : `Hola ${response.data.user.name}`;
        greetedRef.current = true;
        speak(`${greeting}. ¿Vas a entrenar?`);
        setMessage(`${response.data.user.name} - ¿Vas a entrenar?`);
      } else if (response.data.candidate) {
        // Zona gris (0.45-0.6): probable match que no supera el umbral estricto.
        // Confirmar por voz en vez de forzar un re-registro que duplica usuarios.
        const cand = response.data.candidate;
        log('IDENTIFY', 'Candidato zona gris -> confirmación por voz', { user: cand.name, similarity: response.data.similarity });
        pendingCandidateRef.current = cand;
        updateRegistrationStep('confirming_identity');
        speak(`Creo que sos ${cand.name}. ¿Sos vos?`, () => startListening());
        setMessage(`¿Sos ${cand.name}? Respondé sí o no.`);
      } else {
        setFaceIconResult('error');
        setTimeout(() => setFaceIconResult(null), 1800);
        log('IDENTIFY', 'Usuario no reconocido -> iniciando registro por voz');
        isDetectingRef.current = true;
        updateRegistrationStep('asking_name');
        speak('No te reconozco. ¿Cómo te llamas?', () => {
          startListening();
        });
        setMessage('Dime tu nombre...');
      }
    } catch (error: any) {
      log('IDENTIFY', 'Error de conexión', {
        message: error?.message,
        status: error?.response?.status,
        detail: JSON.stringify(error?.response?.data?.detail)?.slice(0, 200),
        elapsed_ms: Math.round(performance.now() - t0)
      });
      setFaceIconResult('error');
      setMessage('Error de conexión.');
      setTimeout(() => {
          setFaceIconResult(null);
          isDetectingRef.current = false;
          stableFramesRef.current = 0;
          missesRef.current = 0;
          setFaceStableCount(0);
      }, 3000);
    }
  }, [addMember]);

  const onFaceDetectionResults = useCallback((results: any) => {
    if (isDetectingRef.current) return;

    // MediaPipe puede entregar el mismo objeto de resultados dos veces;
    // dedupe por identidad para no inflar el contador de frames estables.
    if (results === lastDetectionResultsRef.current) return;
    lastDetectionResultsRef.current = results;

    // El shim de MediaPipe entrega dos objetos distintos por el mismo frame
    // (~0ms de separación); los envíos reales del bucle llegan a >50ms.
    const nowMs = performance.now();
    if (nowMs - lastDeliveryMsRef.current < 40) return;
    lastDeliveryMsRef.current = nowMs;
    resultsCountRef.current += 1;

    const numFaces = results.detections ? results.detections.length : 0;
    if (numFaces > 0 || stableFramesRef.current > 0) {
      log('FACE', 'onResults', { faces: numFaces, stable: stableFramesRef.current, n: resultsCountRef.current });
    }

    if (results.detections && results.detections.length > 0) {
      missesRef.current = 0;
      const largest = selectLargestFace(results.detections);
      if (!largest) return; // bbox inválido: ni suma ni resetea

      const embedding = extractEmbedding(largest);
      if (embedding.length > 0) {
        // Preferir el embedding denso de FaceMesh (936 dims); el geométrico queda de fallback
        const best = meshEmbeddingRef.current && meshEmbeddingRef.current.length > 0
          ? meshEmbeddingRef.current
          : embedding;
        lastEmbeddingRef.current = best;
        stableFramesRef.current += 1;
        setFaceStableCount(stableFramesRef.current);
        const newCount = stableFramesRef.current;
        if (newCount >= 15 && !isDetectingRef.current) {
          const hasMeshEmb = !!(meshEmbeddingRef.current && meshEmbeddingRef.current.length > 0);
          if (!hasMeshEmb && !meshGaveUpRef.current) {
            // FaceMesh aún no entregó su primer resultado (warm-up wasm ~2-3s)
            // o está recreándose (faceMeshRef.current null mientras initialize()).
            // Esperar antes de caer al geométrico: ese vector de 10 dims codifica
            // posición de la cara, no identidad -> solo sirve de candidato.
            if (!meshWaitStartRef.current) {
              meshWaitStartRef.current = performance.now();
              log('FACE', 'Esperando primer embedding FaceMesh');
            }
            const waited = performance.now() - meshWaitStartRef.current;
            if (waited < 2500) {
              stableFramesRef.current -= 1; // mantener en 14 hasta el mesh o el timeout
              setFaceStableCount(stableFramesRef.current);
              return;
            }
            log('FACE', 'Timeout esperando FaceMesh -> fallback geométrico');
          }
          meshWaitStartRef.current = 0;
          log('FACE', '15 frames estables -> ejecutando identificación', { embeddingSource: hasMeshEmb ? 'facemesh' : 'geometric' });
          isDetectingRef.current = true;
          identifyUser(best);
        }
      }
    } else {
      // Umbral 15 (~1.5-3s sin cara): FaceDetection parpadea 1->0 frame a frame;
      // con 3 misses el flicker reseteaba el contador estable y borraba el
      // embedding FaceMesh acumulado (EMA), alargando la identificación.
      missesRef.current += 1;
      if (missesRef.current >= 15) {
        stableFramesRef.current = 0;
        setFaceStableCount(0);
        lastEmbeddingRef.current = null;
        meshEmbeddingRef.current = null;
        meshGoodRef.current = 0;
        meshWaitStartRef.current = 0;
      }
    }
  }, [identifyUser]);

  // Elegir el tipo de rutina y arrancar el workout. Compartido entre la voz
  // (asking_session_goal) y los chips táctiles que se muestran en pantalla.
  const startSessionWithGoal = (goal: string | null, label: string) => {
    pendingSessionGoalRef.current = goal;
    updateRegistrationStep('idle');
    log('VOICE', 'Tipo de entrenamiento elegido', { goal, label });
    speak(label, () => handleStartWorkoutForSelected());
    // Fallback por si el TTS quedó bloqueado por autoplay
    setTimeout(() => { if (!hasTransitionedRef.current) handleStartWorkoutForSelected(); }, 4000);
  };

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
        log('VOICE', 'Va a entrenar -> preguntando tipo de entrenamiento', { user: user?.name });
        updateRegistrationStep('asking_session_goal');
        // Prompt corto: las opciones se muestran como chips en pantalla y
        // también se pueden decir por voz. Enumerarlas todas por TTS alarga
        // mucho el flujo.
        speak('¿Qué querés entrenar hoy?');
        setMessage('Elegí o decí: fuerza, hipertrofia, resistencia, movilidad, bajar de peso o salud general.');
      } else if (isNegative && hasMember) {
        log('VOICE', 'Respuesta negativa -> agregar otro integrante');
        handleAddAnother();
      } else if (!hasMember) {
        // No hay usuario identificado esperando confirmación: ignorar ruido
        log('VOICE', 'Sin confirmación pendiente, ignorando', { transcript });
      } else {
        speak('No entendí. ¿Vas a entrenar? Responde sí o no.', () => startListening());
      }
      return;
    }

    // Zona gris de identificación: el backend sugirió un usuario probable
    if (currentStep === 'confirming_identity') {
      const cand = pendingCandidateRef.current;
      const isYes = /(^|\s)(s[ií]|yes|okay|ok|dale|claro|exacto|correcto|yo soy|el mismo|la misma)/i.test(transcript);
      const isNo = /(^|\s)(no|nunca|jamás|nop|negativo|otro|otra)/i.test(transcript);

      if (isYes && cand) {
        pendingCandidateRef.current = null;
        updateRegistrationStep('idle');
        setFaceIconResult('success');
        updateCurrentUser(cand);
        addMember(cand);
        setMode('members');
        const greeting = greetedRef.current ? cand.name : `Hola ${cand.name}`;
        greetedRef.current = true;
        speak(`${greeting}. ¿Vas a entrenar?`);
        setMessage(`${cand.name} - ¿Vas a entrenar?`);
      } else if (isNo || !cand) {
        pendingCandidateRef.current = null;
        updateRegistrationStep('asking_name');
        speak('De acuerdo, te registro como nuevo. ¿Cómo te llamas?', () => startListening());
        setMessage('Dime tu nombre...');
      } else {
        speak(`No entendí. ¿Sos ${cand.name}? Respondé sí o no.`, () => startListening());
      }
      return;
    }

    // El usuario ya confirmó que entrena: ahora elegimos el tipo de rutina
    if (currentStep === 'asking_session_goal') {
      const mapped = mapTrainingType(transcript);
      if (mapped) {
        startSessionWithGoal(mapped.goal, `Perfecto. Preparando tu rutina de ${mapped.label}.`);
      } else if (/cualquiera|lo de siempre|habitual|normal|da igual|toda/i.test(transcript)) {
        startSessionWithGoal(null, 'Perfecto. Armo tu rutina habitual.');
      } else {
        speak('No entendí. Tocá una opción en pantalla o decí el tipo de entrenamiento.', () => startListening());
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
      setFaceIconResult('success');
      updateCurrentUser(response.data);
      addMember(response.data);
      setMessage(`Bienvenido ${name}`);
      greetedRef.current = true; // "Bienvenido" ya es el saludo inicial
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
    const allMembers = membersRef.current.length > 0 ? membersRef.current : (user ? [user] : []);
    log('FLOW', 'Iniciando workout', { user: user?.name, members: allMembers.map(m => m.name) });
    if (user) {
      hasTransitionedRef.current = true;
      onUserIdentified(user, allMembers, streamRef.current, pendingSessionGoalRef.current);
    }
  }, [onUserIdentified]);

  const handleAddAnother = () => {
    stopListening();
    updateCurrentUser(null);
    updateShowButtons(false);
    updateRegistrationStep('idle');
    isDetectingRef.current = false;
    stableFramesRef.current = 0;
    missesRef.current = 0;
    setFaceStableCount(0);
    setFaceIconResult(null);
    pendingNameRef.current = '';
    lastEmbeddingRef.current = null;
    meshGoodRef.current = 0;
    meshEmbeddingRef.current = null;
    meshWaitStartRef.current = 0;
    setMode('detecting');
    setMessage('Colócate frente a la cámara para agregar otro integrante');
    speak('Colócate frente a la cámara para agregar otro integrante.', () => {});
  };

  useEffect(() => {
    return () => {
      stopListening();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (meshRetryTimerRef.current) {
        clearTimeout(meshRetryTimerRef.current);
        meshRetryTimerRef.current = null;
      }
      if (faceDetectionRef.current) {
        try {
          faceDetectionRef.current.close();
        } catch (e) {}
        faceDetectionRef.current = null;
        globalFaceDetectionInstance = null;
      }
      if (faceMeshRef.current) {
        try {
          faceMeshRef.current.close();
        } catch (e) {}
        faceMeshRef.current = null;
        globalFaceMeshInstance = null;
        meshEmbeddingRef.current = null;
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

        // FaceMesh: assets locales en public/mediapipe (sin dependencia de CDN)
        try {
          await loadScript('mediapipe/face_mesh.js');
          if (typeof window.FaceMesh !== 'undefined') {
            if (!globalFaceMeshInstance) {
              const tMesh = performance.now();
              globalFaceMeshInstance = new window.FaceMesh({ locateFile: (f: string) => `mediapipe/${f}` });
              globalFaceMeshInstance.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5 });
              await globalFaceMeshInstance.initialize();
              log('INIT', 'Modelo FaceMesh inicializado', { elapsed_ms: Math.round(performance.now() - tMesh) });
            }
            // onResults se reasigna en cada mount: el ref pertenece a esta instancia del componente
            globalFaceMeshInstance.onResults(handleMeshResults);
            faceMeshRef.current = globalFaceMeshInstance;
          } else {
            log('INIT', 'FaceMesh no disponible -> fallback a embedding geométrico');
          }
        } catch (meshErr) {
          log('INIT', 'FaceMesh falló; se continúa con embedding geométrico', { error: String(meshErr) });
        }

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
          // FaceMesh a menor frecuencia (cada 6 frames): solo alimenta el snapshot del embedding
          if (
            frameCountRef.current % 6 === 0 &&
            faceMeshRef.current &&
            !isProcessingMeshRef.current &&
            videoRef.current &&
            videoRef.current.readyState >= 2
          ) {
            isProcessingMeshRef.current = true;
            // Watchdog: si send() cuelga sin resolver, liberar el lock a los 1.5s
            let released = false;
            const release = () => {
              if (released) return;
              released = true;
              isProcessingMeshRef.current = false;
            };
            faceMeshRef.current.send({ image: videoRef.current })
              .catch((e: any) => { log('MESH', 'send error', { error: String(e) }); })
              .finally(release);
            setTimeout(() => {
              if (!released) {
                log('MESH', 'send timeout -> liberando lock');
                release();
              }
            }, 1500);
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

  // Icono rostro: scanning mientras hay cara estable o se consulta al backend;
  // success/error vienen del resultado explícito del identify/register
  const faceIconState: 'idle' | 'scanning' | 'success' | 'error' =
    faceIconResult ?? (faceStableCount > 0 ? 'scanning' : 'idle');

  return (
    <div className="overlay-container">
      <style>{`
        .face-id-badge {
          width: 34px; height: 34px; border-radius: 9999px;
          display: flex; align-items: center; justify-content: center;
          color: rgba(255,255,255,0.4);
          background: rgba(0,0,0,0.45);
          border: 1px solid rgba(255,255,255,0.12);
          backdrop-filter: blur(6px);
          transition: color .3s ease, box-shadow .3s ease, border-color .3s ease;
        }
        .face-id-badge[data-state="scanning"] {
          animation: faceIdPulse 1.8s ease-in-out infinite;
          border-color: rgba(103,232,249,0.5);
        }
        .face-id-badge[data-state="success"] {
          color: #4ade80; border-color: rgba(74,222,128,0.8);
          box-shadow: 0 0 14px rgba(74,222,128,0.7);
        }
        .face-id-badge[data-state="error"] {
          color: #f87171; border-color: rgba(248,113,113,0.8);
          box-shadow: 0 0 14px rgba(248,113,113,0.7);
        }
        @keyframes faceIdPulse {
          0%, 100% { color: #67e8f9; box-shadow: 0 0 4px rgba(103,232,249,0.3); }
          50%      { color: #a78bfa; box-shadow: 0 0 14px rgba(167,139,250,0.55); }
        }
      `}</style>
      {/* Cámara a pantalla completa */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="camera-fullscreen"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60 pointer-events-none" />

      {/* Indicador sutil de verificación facial (tipo privacy-dot): esquina sup. derecha */}
      <div className="absolute top-5 right-4 z-20 pointer-events-none">
        <div className="face-id-badge" data-state={faceIconState}>
          {faceIconState === 'success' ? (
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <path d="M6 12.5l4 4 8-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : faceIconState === 'error' ? (
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <ellipse cx="12" cy="12.5" rx="5" ry="6" stroke="currentColor" strokeWidth="1.6"/>
              <circle cx="10.2" cy="11" r="0.9" fill="currentColor"/>
              <circle cx="13.8" cy="11" r="0.9" fill="currentColor"/>
              <path d="M10.3 15.2c.7.7 2.7.7 3.4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          )}
        </div>
      </div>

      {/* Overlay inferior FIJO: orbe + mensaje. Nada más se renderiza en este
          contenedor, así que el orbe nunca se desplaza al aparecer paneles. */}
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
      </div>

      {/* Zona de acciones: panel translúcido sobre el orbe. Aparece/desaparece
          sin mover nada (posición absoluta independiente). */}
      <div className="absolute bottom-44 left-1/2 -translate-x-1/2 z-20 w-full max-w-md px-6 flex flex-col items-center space-y-3">
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

        {mode === 'members' && (
          <div className="bg-black/60 backdrop-blur-md border border-white/10 px-5 py-4 rounded-2xl shadow-xl w-full space-y-3">
            <p className="text-sm font-medium text-gray-100 text-center">Integrantes detectados:</p>
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
            {registrationStep === 'asking_session_goal' ? (
              // Chips de tipo de entrenamiento: el prompt por voz es corto y las
              // opciones se leen acá; también se pueden decir en voz alta.
              <div className="border-t border-white/10 pt-3 space-y-2">
                <p className="text-xs text-gray-400 text-center">Decí el tipo de entrenamiento o tocá una opción</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {TRAINING_GOALS.map((t) => (
                    <button
                      key={t.goal}
                      onClick={() => startSessionWithGoal(t.goal, `Perfecto. Preparando tu rutina de ${t.label}.`)}
                      className="px-3 py-2 rounded-lg text-sm font-bold bg-white/10 text-gray-100 hover:bg-blue-600 transition"
                    >
                      {t.label}
                    </button>
                  ))}
                  <button
                    onClick={() => startSessionWithGoal(null, 'Perfecto. Armo tu rutina habitual.')}
                    className="px-3 py-2 rounded-lg text-sm font-bold bg-white/10 text-gray-100 hover:bg-green-600 transition"
                  >
                    Lo de siempre
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => handleStartWorkoutForSelected()}
                className="w-full bg-green-600/90 hover:bg-green-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg transition"
              >
                Iniciar rutina
              </button>
            )}
          </div>
        )}

        {/* Solo queda el CTA principal: el resto del flujo es por voz */}
        {mode !== 'members' && showButtons && registrationStep === 'idle' && (
          <button
            onClick={() => { speak(`Perfecto. Iniciando tu rutina.`, () => handleStartWorkoutForSelected()); setTimeout(() => { if (!hasTransitionedRef.current) handleStartWorkoutForSelected(); }, 4000); }}
            className="w-full bg-green-600/90 hover:bg-green-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg transition"
          >
            Sí, iniciar rutina
          </button>
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