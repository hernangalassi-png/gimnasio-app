import React, { useRef, useEffect, useState, useCallback } from 'react';
import { processPoseFrame, getEquipment, getRecommendedRoutines, startWorkoutSession, logWorkoutSet, endWorkoutSession, log, type Equipment, type Exercise } from '../services/api';
import { LiveVoiceClient, type LiveToolCall } from '../services/liveVoice';
import { applySpanishVoice } from '../services/tts';
import { Camera, Volume2, HelpCircle, Mic } from 'lucide-react';

interface User {
  id: string;
  name: string;
  primary_goal?: string;
}

// Guías detalladas de ejecución por ejercicio
const EXERCISE_GUIDES: Record<string, { title: string; steps: string[]; spoken: string }> = {
  squat: {
    title: 'Cómo hacer Sentadillas',
    steps: [
      'Párate con los pies al ancho de hombros, puntas levemente hacia afuera',
      'Espalda recta y mirada al frente durante todo el movimiento',
      'Baja empujando las caderas hacia atrás, como sentándote en una silla',
      'Desciende hasta que tus muslos queden paralelos al piso (rodillas ~90°)',
      'Sube empujando con los talones, sin que las rodillas se cierren hacia adentro'
    ],
    spoken: 'Para hacer sentadillas correctamente: párate con los pies al ancho de hombros. Mantén la espalda recta y baja empujando las caderas hacia atrás, como si te sentaras. Baja hasta que tus muslos queden paralelos al piso y sube empujando con los talones. No dejes que las rodillas se cierren hacia adentro.'
  },
  pushup: {
    title: 'Cómo hacer Flexiones',
    steps: [
      'Apoya las manos en el piso al ancho de hombros, brazos extendidos',
      'Cuerpo en línea recta de cabeza a talones, abdomen contraído',
      'Baja el pecho flexionando los codos hasta casi tocar el piso',
      'Sube empujando el piso hasta extender los brazos completamente',
      'No dejes caer las caderas ni arquees la espalda'
    ],
    spoken: 'Para hacer flexiones correctamente: apoya las manos en el piso al ancho de hombros. Mantén el cuerpo en línea recta de cabeza a talones con el abdomen contraído. Baja el pecho flexionando los codos hasta casi tocar el piso y sube empujando hasta extender los brazos. No dejes caer las caderas.'
  }
};

export const Workout: React.FC<{ user?: User | null; members?: User[]; stream?: MediaStream | null; sessionGoal?: string | null; onBack?: () => void }> = ({ user, members, stream, sessionGoal, onBack }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isProcessingRef = useRef(false);
  const lastSpokenFeedbackRef = useRef<string>('');
  const exerciseRef = useRef<string>('squat');
  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const [reps, setReps] = useState<number>(0);
  const [stage, setStage] = useState<string>('up');
  const [feedback, setFeedback] = useState<string>('Asegúrate de estar visible');
  const [exercise, setExerciseState] = useState<string>('squat');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);
  const [recommendations, setRecommendations] = useState<Exercise[]>([]);
  const [availableEquipment, setAvailableEquipment] = useState<Equipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string>('');
  const introDoneRef = useRef(false);
  const activeRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const helpActiveRef = useRef(false);
  const resumeAtRef = useRef<number | null>(null);

  // ---- Estado de sesión durable (recibos APPLIED) ----
  const sessionIdRef = useRef<string | null>(null);
  const sessionEndedRef = useRef(false);
  const lastPoseRepsRef = useRef(0);
  const activeExerciseIdRef = useRef<string | null>(null);
  const setCountByExerciseRef = useRef<Record<string, number>>({});

  // ---- Gate de propuestas por voz (ADN: propuesta -> decisión -> APPLIED) ----
  const pendingProposalRef = useRef<{
    id: string;
    action: 'change_exercise' | 'end_workout';
    payload: { rec?: Exercise; toolCallId?: string; toolCallName?: string };
    question: string;
    expiresAt: number;
  } | null>(null);
  const proposalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setPendingProposalUI] = useState<string | null>(null);
  const repsDisplayRef = useRef(0);

  // ---- Canal Gemini Live (voz natural); fallback: SpeechRecognition + regex ----
  const liveClientRef = useRef<LiveVoiceClient | null>(null);
  const liveActiveRef = useRef(false);
  const liveToolHandlerRef = useRef<(c: LiveToolCall) => void>(() => {});
  const [liveConnected, setLiveConnected] = useState(false);

  const setExercise = (ex: string) => { setExerciseState(ex); exerciseRef.current = ex; };

  const speak = useCallback((text: string, onEnd?: () => void) => {
    log('TTS', 'Speak', { text: text.slice(0, 80), hasCallback: !!onEnd });
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      isSpeakingRef.current = true;
      const utterance = new SpeechSynthesisUtterance(text);
      applySpanishVoice(utterance);
      utterance.rate = 1;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        if (onEnd) onEnd();
      };
      window.speechSynthesis.speak(utterance);
    } else if (onEnd) {
      onEnd();
    }
  }, []);

  // Cierre de la guía: reanuda poses tras 1.5s de gracia y avisa a Live.
  // Guardado por helpActiveRef: un cierre manual dispara cancel() -> onend ->
  // segundo intento de cierre, y el fallback por timeout puede llegar después.
  const closeExerciseExample = useCallback((resumeMessage?: string) => {
    if (!helpActiveRef.current) return;
    helpActiveRef.current = false;
    resumeAtRef.current = Date.now() + 1500;
    lastSpokenFeedbackRef.current = '';
    window.speechSynthesis?.cancel();
    liveClientRef.current?.sendContext('El usuario cerró la explicación del ejercicio. El entrenamiento se reanudó.');
    if (resumeMessage) speak(resumeMessage);
  }, [speak]);

  // Mostrar ejemplo del ejercicio actual (voz o botón).
  // Pausa el procesamiento de poses (helpActiveRef) y avisa a Live para que no
  // hable mientras suena la guía: la explicación debe salir limpia.
  const showExerciseExample = useCallback(() => {
    if (helpActiveRef.current) return;
    const guide = EXERCISE_GUIDES[exerciseRef.current] || EXERCISE_GUIDES.squat;
    helpActiveRef.current = true;
    resumeAtRef.current = null;
    lastSpokenFeedbackRef.current = '';
    window.speechSynthesis?.cancel();
    liveClientRef.current?.sendContext('El usuario pidió la explicación del ejercicio. No hables ni des feedback hasta que la explicación termine y se reanude el entrenamiento.');
    // La guía es SOLO hablada (sin panel): al terminar el TTS se reanuda el
    // feedback de poses. También se puede cortar diciendo cualquier comando.
    speak(guide.spoken, () => closeExerciseExample());
    // Fallback si el TTS no dispara onend (voz bloqueada o error de síntesis)
    setTimeout(() => closeExerciseExample(), 35000);
  }, [speak, closeExerciseExample]);

  // Persiste la serie pendiente del ejercicio actual (el contador backend resetea al cambiar de tipo)
  const flushPendingSet = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const exerciseId = activeExerciseIdRef.current;
    const reps = lastPoseRepsRef.current;
    if (!sessionId || !exerciseId || reps <= 0 || !user?.id) return;
    const setNumber = (setCountByExerciseRef.current[exerciseId] || 0) + 1;
    setCountByExerciseRef.current[exerciseId] = setNumber;
    lastPoseRepsRef.current = 0;
    try {
      await logWorkoutSet(sessionId, {
        user_id: user.id,
        exercise_id: exerciseId,
        set_number: setNumber,
        target_reps: reps,
        completed_reps: reps,
      });
      log('SET', 'Serie registrada (APPLIED)', { sessionId, exerciseId, setNumber, reps });
    } catch (err) {
      log('SET', 'Error registrando serie', { exerciseId, setNumber, error: err });
    }
  }, [user?.id]);

  // Cambio de ejercicio: persiste la serie anterior antes de resetear el contador
  const changeExercise = useCallback((rec: Exercise, announce?: string) => {
    if (rec.exercise_type === exerciseRef.current) return;
    flushPendingSet();
    setExercise(rec.exercise_type);
    setSelectedTitle(rec.title);
    activeExerciseIdRef.current = rec.id;
    speak(announce || `Cambiamos a ${rec.title}.`);
    liveClientRef.current?.sendContext(`El usuario cambió al ejercicio ${rec.title} (tipo ${rec.exercise_type}). El contador de repeticiones volvió a 0.`);
  }, [flushPendingSet, speak]);

  // ---- Máquina de propuestas: ningún comando mutador por voz ejecuta sin confirmación ----
  const clearProposal = useCallback(() => {
    if (proposalTimerRef.current) {
      clearTimeout(proposalTimerRef.current);
      proposalTimerRef.current = null;
    }
    pendingProposalRef.current = null;
    setPendingProposalUI(null);
  }, []);

  const proposeAction = useCallback((p: { id: string; action: 'change_exercise' | 'end_workout'; payload: { rec?: Exercise; toolCallId?: string; toolCallName?: string }; question: string }) => {
    clearProposal();
    pendingProposalRef.current = { ...p, expiresAt: Date.now() + 10000 };
    setPendingProposalUI(p.question);
    log('GATE', 'Propuesta emitida', { action: p.action, expires_in_s: 10 });
    proposalTimerRef.current = setTimeout(() => {
      if (pendingProposalRef.current?.id === p.id) {
        log('GATE', 'Propuesta expirada (EXPIRED)', { action: p.action });
        clearProposal();
      }
    }, 10000);
    speak(p.question);
  }, [clearProposal, speak]);

  // APPLIED: la propuesta solo se ejecuta tras confirmación explícita
  const applyProposal = useCallback((p: NonNullable<typeof pendingProposalRef.current>) => {
    log('GATE', 'Propuesta confirmada -> aplicando (APPLIED)', { action: p.action });
    // Si vino de un tool call de Live, responder el resultado al modelo
    if (p.payload.toolCallId && p.payload.toolCallName) {
      liveClientRef.current?.sendToolResponse(p.payload.toolCallId, p.payload.toolCallName, { result: 'applied' });
    }
    clearProposal();
    if (p.action === 'change_exercise' && p.payload.rec) {
      changeExercise(p.payload.rec, `Listo. Ahora hacemos ${p.payload.rec.title}.`);
    } else if (p.action === 'end_workout') {
      speak('Perfecto. Cerramos la rutina.', () => onBack?.());
    }
  }, [clearProposal, changeExercise, speak, onBack]);

  const cancelProposal = useCallback(() => {
    const p = pendingProposalRef.current;
    if (p) {
      log('GATE', 'Propuesta cancelada (CANCELLED)', { action: p.action });
      if (p.payload.toolCallId && p.payload.toolCallName) {
        liveClientRef.current?.sendToolResponse(p.payload.toolCallId, p.payload.toolCallName, { result: 'cancelled' });
      }
    }
    clearProposal();
    speak('Cancelado.');
  }, [clearProposal, speak]);

  // Árbitro de tool calls de Live: propuestas entran al gate; read-only ejecutan directo.
  // La app valida TODO contra su estado local - el modelo solo propone.
  const handleLiveToolCall = useCallback((call: LiveToolCall) => {
    log('LIVE', 'Arbitrando tool call', { name: call.name, args: call.args });
    const client = liveClientRef.current;

    switch (call.name) {
      case 'propose_change_exercise': {
        const exType = call.args?.exercise_type as string | undefined;
        const rec = recommendations.find(r => r.exercise_type === exType);
        if (!rec || rec.exercise_type === exerciseRef.current) {
          client?.sendToolResponse(call.id, call.name, { result: 'rejected', reason: 'ejercicio no disponible o ya activo' });
          return;
        }
        proposeAction({
          id: `live-${call.id}`,
          action: 'change_exercise',
          payload: { rec, toolCallId: call.id, toolCallName: call.name },
          question: `¿Cambiamos a ${rec.title}? Decí sí para confirmar.`
        });
        // No respondemos todavía: la respuesta viaja al confirmar/cancelar/expirar
        return;
      }
      case 'propose_end_workout': {
        proposeAction({
          id: `live-${call.id}`,
          action: 'end_workout',
          payload: { toolCallId: call.id, toolCallName: call.name },
          question: '¿Terminamos la rutina? Decí sí para confirmar.'
        });
        return;
      }
      case 'confirm_pending_action': {
        const pending = pendingProposalRef.current && Date.now() < pendingProposalRef.current.expiresAt
          ? pendingProposalRef.current
          : null;
        if (pending) {
          applyProposal(pending);
          client?.sendToolResponse(call.id, call.name, { result: 'applied' });
        } else {
          client?.sendToolResponse(call.id, call.name, { result: 'rejected', reason: 'no hay propuesta pendiente o expiró' });
        }
        return;
      }
      case 'cancel_pending_action': {
        const hadPending = !!pendingProposalRef.current;
        cancelProposal();
        client?.sendToolResponse(call.id, call.name, { result: hadPending ? 'cancelled' : 'nothing_pending' });
        return;
      }
      case 'show_exercise_example': {
        // Read-only: ejecución directa
        showExerciseExample();
        client?.sendToolResponse(call.id, call.name, { result: 'shown' });
        return;
      }
      case 'get_rep_count': {
        client?.sendToolResponse(call.id, call.name, { reps: repsDisplayRef.current, exercise: selectedTitle || exerciseRef.current });
        return;
      }
      default:
        log('LIVE', 'Tool call desconocido', { name: call.name });
        client?.sendToolResponse(call.id, call.name, { result: 'rejected', reason: 'herramienta desconocida' });
    }
  }, [recommendations, proposeAction, applyProposal, cancelProposal, showExerciseExample, selectedTitle]);

  // Ref espejo: el WS usa el handler más reciente sin re-registrar callbacks
  useEffect(() => { liveToolHandlerRef.current = handleLiveToolCall; }, [handleLiveToolCall]);

  const findExerciseMention = useCallback((transcript: string): Exercise | undefined => {
    if (/sentadilla/.test(transcript)) return recommendations.find(r => r.exercise_type === 'squat');
    if (/flexion|lagartija|plancha de brazos/.test(transcript)) return recommendations.find(r => r.exercise_type === 'pushup');
    return undefined;
  }, [recommendations]);

  // Árbitro de voz: mutadores pasan por propuesta->confirmación; read-only ejecutan directo
  const handleWorkoutVoice = useCallback((transcript: string) => {
    const isAffirmative = /(^|\s)(s[ií]|dale|ok|okay|bueno|perfecto|confirmo|vamos|adelante)/i.test(transcript);
    const isNegative = /(^|\s)(no|cancela|espera|pará|para|todav[ií]a no|mejor no)/i.test(transcript);
    const pending = pendingProposalRef.current && Date.now() < pendingProposalRef.current.expiresAt
      ? pendingProposalRef.current
      : null;

    if (pending) {
      if (isAffirmative) { applyProposal(pending); return; }
      if (isNegative) { cancelProposal(); return; }
      const correction = findExerciseMention(transcript);
      if (correction && correction.exercise_type !== exerciseRef.current) {
        log('GATE', 'Corrección detectada -> nueva propuesta', { nuevo: correction.title });
        proposeAction({
          id: `px-${Date.now()}`,
          action: 'change_exercise',
          payload: { rec: correction },
          question: `¿Querés cambiar a ${correction.title}? Decí sí para confirmar.`
        });
        return;
      }
      log('GATE', 'Input ambiguo con propuesta pendiente; ignorado', { transcript });
      return;
    }

    if (isAffirmative || isNegative) {
      log('GATE', 'Respuesta sin propuesta pendiente; ignorada', { transcript });
      return;
    }
    if (/ejemplo|c[oó]mo|ayuda|enseñ|explica|mostr/.test(transcript)) { showExerciseExample(); return; }
    if (/cu[aá]ntas|cu[aá]nto llevo|repeticiones|contador/.test(transcript)) {
      speak(`Llevás ${repsDisplayRef.current} repeticiones.`);
      return;
    }
    const rec = findExerciseMention(transcript);
    if (rec && rec.exercise_type !== exerciseRef.current) {
      proposeAction({
        id: `px-${Date.now()}`,
        action: 'change_exercise',
        payload: { rec },
        question: `¿Querés cambiar a ${rec.title}? Decí sí para confirmar.`
      });
      return;
    }
    if (/terminar|finalizar|salir|acabar/.test(transcript)) {
      proposeAction({
        id: `pw-${Date.now()}`,
        action: 'end_workout',
        payload: {},
        question: '¿Querés terminar la rutina? Decí sí para confirmar.'
      });
      return;
    }
    log('VOICE', 'Comando no reconocido', { transcript });
  }, [applyProposal, cancelProposal, findExerciseMention, proposeAction, showExerciseExample, speak]);

  // Escucha de comandos de voz durante la rutina ("ejemplo", "cómo", "ayuda")
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (helpActiveRef.current || recognitionRef.current || liveActiveRef.current) return;
    if (isSpeakingRef.current) {
      // Reintentar cuando termine el TTS: la confirmación por voz necesita el mic activo
      if (activeRef.current) setTimeout(startListening, 800);
      return;
    }

    const recog = new SpeechRecognition();
    recog.lang = 'es-ES';
    recog.continuous = false;
    recog.interimResults = false;
    recog.onstart = () => { setIsListening(true); setMicBlocked(false); };
    recog.onend = () => { setIsListening(false); recognitionRef.current = null; if (activeRef.current) setTimeout(startListening, 600); };
    recog.onerror = (e: any) => {
      console.warn('[Workout micrófono error]:', e.error);
      setIsListening(false);
      recognitionRef.current = null;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setMicBlocked(true);
      }
      if (activeRef.current) setTimeout(startListening, 1200);
    };
    recog.onresult = (event: any) => {
      // El mic capta el TTS propio (bocina) y llegaba como comando falso
      // ('no se detecta persona', 'buena repetición'...). Descartar el eco.
      if (isSpeakingRef.current) return;
      const transcript = event.results[0][0].transcript.toLowerCase();
      log('VOICE', 'Comando en workout', { transcript });
      handleWorkoutVoice(transcript);
    };
    try {
      recog.start();
      recognitionRef.current = recog;
    } catch (e: any) {
      console.warn('[Workout start error]:', e.message);
      setMicBlocked(true);
    }
  }, [showExerciseExample, handleWorkoutVoice, speak]);

  useEffect(() => {
    activeRef.current = true;
    const timer = setTimeout(startListening, 3500);
    return () => {
      activeRef.current = false;
      clearTimeout(timer);
      if (recognitionRef.current) {
        try { recognitionRef.current.onend = null; recognitionRef.current.stop(); } catch (e) {}
      }
    };
  }, [startListening]);

  // Cargar equipamiento, recomendaciones e iniciar guía por voz
  useEffect(() => {
    if (!user?.id) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      const t0 = performance.now();
      log('WORKOUT', 'Cargando equipamiento y recomendaciones', { userId: user.id });
      try {
        // user_ids para la sesión: usuario activo primero, luego el resto de integrantes (máx 2 por schema)
        const userIds = [...new Set([user.id, ...(members || []).map(m => m.id)])].slice(0, 2);
        if ((members?.length || 0) + 1 > 2) {
          log('SESSION', 'Backend limita sesiones a 2 usuarios; se trunca la lista', { members: (members || []).map(m => m.name) });
        }

        const [equipment, routines, session] = await Promise.all([
          getEquipment(),
          getRecommendedRoutines(user.id, [], sessionGoal || undefined),
          startWorkoutSession(userIds).catch(err => {
            log('SESSION', 'Error iniciando sesión', { error: err });
            return null;
          })
        ]);
        if (session) {
          sessionIdRef.current = session.id;
          log('SESSION', 'Sesión iniciada', { id: session.id, mode: session.session_mode, users: session.user_ids });
        }
        log('WORKOUT', 'Datos cargados', {
          equipment: equipment.length,
          routines: routines.map(r => r.id),
          elapsed_ms: Math.round(performance.now() - t0)
        });
        setAvailableEquipment(equipment);
        setRecommendations(routines);

        // Canal Gemini Live: si conecta, la voz natural reemplaza al reconocedor regex
        const live = new LiveVoiceClient();
        live.setCallbacks({
          onToolCall: (call) => liveToolHandlerRef.current(call),
          onStatus: (s) => {
            setLiveConnected(s === 'connected');
            liveActiveRef.current = s === 'connected';
            if (s === 'connected') {
              // Live toma el canal de voz: cortar el TTS intro local para que no
              // suene encima del audio PCM de Live (solape = ruido/doble voz).
              window.speechSynthesis?.cancel();
              isSpeakingRef.current = false;
            }
          },
          onSpeaking: (sp) => {
            // Cuando el modelo habla por el canal Live (PCM), cortar cualquier
            // TTS local en curso: los dos streams solapados se perciben como
            // ruido de "fritura" / crash de audio.
            if (sp) {
              window.speechSynthesis?.cancel();
              isSpeakingRef.current = false;
            }
            setIsSpeaking(sp);
          },
          onTranscript: (kind, text) => log('LIVE', 'Transcript', { kind, text: text.slice(0, 120) }),
        });
        live.connect().then(ok => {
          if (!ok) {
            log('LIVE', 'Live no disponible -> fallback a SpeechRecognition');
            return;
          }
          liveClientRef.current = live;
          // Detener el recognizer regex: Live es el canal de voz ahora
          try {
            if (recognitionRef.current) {
              recognitionRef.current.onend = null;
              recognitionRef.current.stop();
              recognitionRef.current = null;
            }
          } catch {}
          log('LIVE', 'Canal de voz natural activo');
          live.sendContext(`El usuario ${user.name} comenzó su rutina con ${routines[0]?.title || 'el primer ejercicio'}. Ejercicios disponibles: ${routines.map(r => `${r.title} (tipo ${r.exercise_type})`).join(', ')}. Ya lo saludaste por su nombre en la identificación, no repitas el saludo: dirigite a él solo por su nombre y avisale que puede pedirte cambiar de ejercicio, ver un ejemplo, o terminar la rutina.`);
        });

        if (routines.length > 0) {
          const first = routines[0];
          setExercise(first.exercise_type);
          setSelectedTitle(first.title);
          activeExerciseIdRef.current = first.id;

          const equipmentText = first.required_equipment_ids?.length
            ? ` Vamos a usar ${first.required_equipment_ids
                .map((id: string) => equipment.find((e: Equipment) => e.id === id)?.name || id)
                .join(', ')}.`
            : ' No necesitás equipamiento.';

          timer = setTimeout(() => {
            // Sin 'Hola': el saludo ya se dio en identificación; acá solo el nombre
            const greeting = user.name ? `${user.name}. ` : '';
            speak(`${greeting}Tu rutina de hoy empieza con ${first.title}.${equipmentText} ${first.description} Si necesitás ver cómo se hace, decí: ejemplo.`, () => {
              introDoneRef.current = true;
            });
          }, 500);
        } else {
          log('WORKOUT', 'Sin ejercicios recomendados para el perfil');
          setLoadError('No se encontraron ejercicios para tu perfil.');
        }
      } catch (err) {
        log('WORKOUT', 'Error cargando rutina', { error: err, elapsed_ms: Math.round(performance.now() - t0) });
        setLoadError('No se pudo cargar la rutina. Intentá de nuevo.');
      } finally {
        setIsLoading(false);
      }
    };

    load();
    return () => {
      if (timer) clearTimeout(timer);
      // Al desmontar: persistir serie pendiente y cerrar sesión (recibo APPLIED final)
      if (liveClientRef.current) {
        liveClientRef.current.disconnect();
        liveClientRef.current = null;
        liveActiveRef.current = false;
      }
      if (sessionIdRef.current && !sessionEndedRef.current) {
        sessionEndedRef.current = true;
        const sid = sessionIdRef.current;
        Promise.resolve()
          .then(() => flushPendingSet())
          .finally(() => {
            endWorkoutSession(sid)
              .then(s => log('SESSION', 'Sesión cerrada (APPLIED)', { id: sid, totalSets: s.total_sets, volumeKg: s.total_volume_kg }))
              .catch(e => log('SESSION', 'Error cerrando sesión', { id: sid, error: e }));
          });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    async function setupCamera() {
      if (videoRef.current) {
        if (stream) {
          log('WORKOUT', 'Reutilizando stream de cámara de identificación');
          videoRef.current.srcObject = stream;
          streamRef.current = stream;
          try { videoRef.current.play(); } catch (e) {}
        } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const tCam = performance.now();
          const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
          log('WORKOUT', 'Nuevo stream de cámara obtenido', { elapsed_ms: Math.round(performance.now() - tCam) });
          videoRef.current.srcObject = newStream;
          streamRef.current = newStream;
          try { videoRef.current.play(); } catch (e) {}
        }
      }
    }
    log('WORKOUT', 'Workout montado', { user: user?.name, hasStream: !!stream });
    setupCamera();

    return () => {
      window.speechSynthesis?.cancel();
      activeRef.current = false;
    };
  }, [stream]);

  // Loop de procesamiento: solo envía un frame si no hay petición en vuelo
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!videoRef.current || isProcessingRef.current) return;
      if (videoRef.current.readyState < 2) return;
      if (helpActiveRef.current) return;
      if (resumeAtRef.current && Date.now() < resumeAtRef.current) return;

      isProcessingRef.current = true;

      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, 320, 240);
        canvas.toBlob(async (blob) => {
          const tFrame = performance.now();
          try {
            if (blob) {
              const res = await processPoseFrame(blob, exercise);
              log('POSE', 'Frame procesado', {
                exercise,
                reps: res.reps,
                stage: res.stage,
                feedback: res.feedback,
                elapsed_ms: Math.round(performance.now() - tFrame)
              });
              lastPoseRepsRef.current = res.reps;
              repsDisplayRef.current = res.reps;
              setReps(res.reps);
              setStage(res.stage);
              setFeedback(res.feedback);

              // Hablar SOLO eventos de rep: los mensajes de posicionamiento
              // ('Aléjate', 'No se detecta persona') quedan solo en pantalla —
              // hablados eran invasivos (interrumpían guías y comandos) y el
              // mic reconocía la propia voz como comandos falsos.
              if (introDoneRef.current && !helpActiveRef.current && res.feedback && res.feedback !== lastSpokenFeedbackRef.current) {
                const speakable = ['¡Buena repetición!', '¡Buena flexión!'];
                if (speakable.some(s => res.feedback.includes(s))) {
                  lastSpokenFeedbackRef.current = res.feedback;
                  speak(res.feedback);
                }
              }
            }
          } catch (err: any) {
            log('POSE', 'Error procesando frame', { message: err?.message, elapsed_ms: Math.round(performance.now() - tFrame) });
          } finally {
            isProcessingRef.current = false;
          }
        }, 'image/jpeg', 0.5);
      } else {
        isProcessingRef.current = false;
      }
    }, 500);

    return () => clearInterval(interval);
  }, [exercise, speak]);

  const selectedExercise = recommendations.find(r => r.exercise_type === exercise);
  const exerciseName = selectedTitle || selectedExercise?.title || (exercise === 'squat' ? 'Sentadillas' : 'Flexiones');

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

      {/* Overlay superior: contador */}
      <div className="absolute top-[calc(1.5rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-30">
        <div className="bg-black/70 backdrop-blur-md border border-white/10 px-6 py-3 rounded-2xl flex items-center space-x-4 shadow-2xl">
          <Camera className="w-6 h-6 text-green-400" />
          <div className="text-center">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{exerciseName}</p>
            <p className="text-4xl font-extrabold text-white leading-none">
              {reps} <span className="text-sm font-normal text-gray-300">reps</span>
            </p>
          </div>
          <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${stage === 'down' ? 'bg-yellow-500 text-black' : 'bg-green-500 text-black'}`}>
            {stage.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Overlay inferior: orbe + feedback */}
      <div className="absolute bottom-[calc(2rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-30 flex flex-col items-center space-y-4 w-full max-w-md px-6">
        {/* Orbe del asistente */}
        <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
          isSpeaking
            ? 'bg-blue-500 shadow-[0_0_50px_rgba(59,130,246,0.9)] scale-110'
            : 'bg-blue-600 shadow-[0_0_30px_rgba(59,130,246,0.6)]'
        }`}>
          <Volume2 className={`w-8 h-8 text-white ${isSpeaking ? 'animate-pulse' : ''}`} />
        </div>

        {/* Info de carga / error / equipo disponible */}
        <div className="bg-black/50 backdrop-blur-sm border border-white/10 px-4 py-2 rounded-xl w-full text-center">
          <p className="text-xs text-gray-300">
            {isLoading
              ? 'Cargando tu rutina...'
              : loadError
                ? loadError
                : `Equipo disponible: ${availableEquipment.filter(e => e.is_available).map(e => e.name).join(', ')}`}
          </p>
        </div>

        {/* Feedback hablado */}
        <div className="bg-black/70 backdrop-blur-md border border-white/10 px-5 py-3 rounded-2xl shadow-xl w-full text-center">
          <p className="text-sm font-medium text-gray-100">{feedback}</p>
        </div>

        {/* Selector de ejercicio + botón de ejemplo + micrófono */}
        <div className="flex space-x-3 items-center">
          {recommendations.map((rec) => (
            <button
              key={rec.id}
              onClick={() => changeExercise(rec, `Cambiamos a ${rec.title}. ${rec.description || ''}`)}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg transition ${selectedTitle === rec.title ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-300 backdrop-blur-md'}`}
            >
              {rec.title}
            </button>
          ))}
          <button
            onClick={showExerciseExample}
            title="Ver ejemplo del ejercicio"
            className="p-2.5 rounded-xl bg-white/10 text-gray-200 backdrop-blur-md hover:bg-white/20 shadow-lg transition"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          {liveConnected && (
            <span
              title="GALIA Live conectada - canal de voz natural"
              className="px-3 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-bold backdrop-blur-md"
            >
              GALIA
            </span>
          )}
          <button
            onClick={startListening}
            title="Activar micrófono"
            className={`p-2.5 rounded-xl shadow-lg transition ${
              micBlocked
                ? 'bg-red-500/80 text-white'
                : isListening
                  ? 'bg-green-500/80 text-white animate-pulse'
                  : 'bg-white/10 text-gray-200 backdrop-blur-md hover:bg-white/20'
            }`}
          >
            <Mic className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};