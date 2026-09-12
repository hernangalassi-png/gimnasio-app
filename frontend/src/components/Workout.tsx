import React, { useRef, useEffect, useState, useCallback } from 'react';
import { processPoseFrame, getEquipment, getRecommendedRoutines, log, type Equipment, type Exercise } from '../services/api';
import { Camera, Volume2, HelpCircle, X, Mic } from 'lucide-react';

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

export const Workout: React.FC<{ user?: User | null; stream?: MediaStream | null }> = ({ user, stream }) => {
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
  const [showExample, setShowExample] = useState(false);
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

  const setExercise = (ex: string) => { setExerciseState(ex); exerciseRef.current = ex; };

  const speak = useCallback((text: string, onEnd?: () => void) => {
    log('TTS', 'Speak', { text: text.slice(0, 80), hasCallback: !!onEnd });
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      isSpeakingRef.current = true;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES';
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

  // Mostrar ejemplo del ejercicio actual (voz o botón)
  const showExerciseExample = useCallback(() => {
    if (helpActiveRef.current) return;
    const guide = EXERCISE_GUIDES[exerciseRef.current] || EXERCISE_GUIDES.squat;
    helpActiveRef.current = true;
    resumeAtRef.current = null;
    lastSpokenFeedbackRef.current = '';
    window.speechSynthesis?.cancel();
    setShowExample(true);
    speak(guide.spoken);
  }, [speak]);

  // Escucha de comandos de voz durante la rutina ("ejemplo", "cómo", "ayuda")
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (helpActiveRef.current || isSpeakingRef.current || recognitionRef.current) return;

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
      const transcript = event.results[0][0].transcript.toLowerCase();
      log('VOICE', 'Comando en workout', { transcript });
      if (/ejemplo|c[oó]mo|ayuda|enseñ|explica|mostr/.test(transcript)) {
        showExerciseExample();
      } else if (/sentadilla/.test(transcript)) {
        const rec = recommendations.find(r => r.exercise_type === 'squat');
        if (rec) { setExercise(rec.exercise_type); setSelectedTitle(rec.title); speak(`Cambiamos a ${rec.title}.`); }
      } else if (/flexion|lagartija|plancha de brazos/.test(transcript)) {
        const rec = recommendations.find(r => r.exercise_type === 'pushup');
        if (rec) { setExercise(rec.exercise_type); setSelectedTitle(rec.title); speak(`Cambiamos a ${rec.title}.`); }
      }
    };
    try {
      recog.start();
      recognitionRef.current = recog;
    } catch (e: any) {
      console.warn('[Workout start error]:', e.message);
      setMicBlocked(true);
    }
  }, [showExerciseExample, speak]);

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
        const [equipment, routines] = await Promise.all([
          getEquipment(),
          getRecommendedRoutines(user.id, [])
        ]);
        log('WORKOUT', 'Datos cargados', {
          equipment: equipment.length,
          routines: routines.map(r => r.id),
          elapsed_ms: Math.round(performance.now() - t0)
        });
        setAvailableEquipment(equipment);
        setRecommendations(routines);

        if (routines.length > 0) {
          const first = routines[0];
          setExercise(first.exercise_type);
          setSelectedTitle(first.title);

          const equipmentText = first.required_equipment_ids?.length
            ? ` Vamos a usar ${first.required_equipment_ids
                .map((id: string) => equipment.find((e: Equipment) => e.id === id)?.name || id)
                .join(', ')}.`
            : ' No necesitás equipamiento.';

          timer = setTimeout(() => {
            const greeting = user.name ? `Hola ${user.name}. ` : '';
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
    return () => { if (timer) clearTimeout(timer); };
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
              setReps(res.reps);
              setStage(res.stage);
              setFeedback(res.feedback);

              // Hablar solo cuando cambia el feedback importante y la intro ya terminó
              if (introDoneRef.current && res.feedback && res.feedback !== lastSpokenFeedbackRef.current) {
                const speakable = ['¡Buena repetición!', '¡Buena flexión!', 'Aléjate', 'No se detecta persona'];
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

      {/* Overlay de ejemplo del ejercicio */}
      {showExample && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
          <div className="bg-gray-900/95 border border-white/15 rounded-2xl shadow-2xl max-w-md w-full p-6 relative">
            <button
              onClick={() => { setShowExample(false); helpActiveRef.current = false; resumeAtRef.current = Date.now() + 1500; lastSpokenFeedbackRef.current = ''; window.speechSynthesis?.cancel(); }}
              className="absolute top-3 right-3 text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-white mb-4">
              {(EXERCISE_GUIDES[exercise] || EXERCISE_GUIDES.squat).title}
            </h3>
            <ol className="space-y-3">
              {(EXERCISE_GUIDES[exercise] || EXERCISE_GUIDES.squat).steps.map((step, i) => (
                <li key={i} className="flex items-start space-x-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-200">{step}</p>
                </li>
              ))}
            </ol>
            <button
              onClick={() => { setShowExample(false); helpActiveRef.current = false; resumeAtRef.current = Date.now() + 1500; lastSpokenFeedbackRef.current = ''; window.speechSynthesis?.cancel(); speak('Perfecto. Comienza cuando estés listo.'); }}
              className="mt-5 w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-bold text-sm transition"
            >
              Entendido, ¡vamos!
            </button>
          </div>
        </div>
      )}

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
              onClick={() => { setExercise(rec.exercise_type); setSelectedTitle(rec.title); speak(`Cambiamos a ${rec.title}. ${rec.description || ''}`); }}
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