import React, { useRef, useEffect, useState, useCallback } from 'react';
import { processPoseFrame } from '../services/api';
import { Camera, Volume2, HelpCircle, X } from 'lucide-react';

interface User {
  id: string;
  name: string;
  primary_goal?: string;
}

// Rutinas sugeridas según objetivo del usuario
const ROUTINES: Record<string, { exercise: string; name: string; instructions: string }> = {
  fuerza: {
    exercise: 'squat',
    name: 'Sentadillas',
    instructions: 'Tu rutina de hoy es fuerza. Empezamos con sentadillas. Aléjate de la cámara hasta que se vea tu cuerpo completo. Baja hasta que tus rodillas formen noventa grados y sube con fuerza. Yo cuento tus repeticiones.'
  },
  hipertrofia: {
    exercise: 'squat',
    name: 'Sentadillas',
    instructions: 'Tu rutina de hoy es hipertrofia. Empezamos con sentadillas controladas. Aléjate hasta verte de cuerpo completo. Baja lento, siente el músculo, y sube con control. Yo cuento tus repeticiones.'
  },
  resistencia: {
    exercise: 'squat',
    name: 'Sentadillas',
    instructions: 'Tu rutina de hoy es resistencia. Haremos sentadillas a ritmo constante. Aléjate hasta verte de cuerpo completo. Mantén un ritmo fluido, baja y sube sin pausa. Yo cuento tus repeticiones.'
  },
  salud_general: {
    exercise: 'squat',
    name: 'Sentadillas',
    instructions: 'Tu rutina de hoy es salud general. Empezamos suave con sentadillas. Aléjate hasta verte de cuerpo completo. Baja cómodo y sube sin forzar. Yo cuento tus repeticiones.'
  }
};

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

export const Workout: React.FC<{ user?: User | null }> = ({ user }) => {
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
  const introDoneRef = useRef(false);

  const setExercise = (ex: string) => { setExerciseState(ex); exerciseRef.current = ex; };

  const speak = useCallback((text: string, onEnd?: () => void) => {
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
    const guide = EXERCISE_GUIDES[exerciseRef.current] || EXERCISE_GUIDES.squat;
    setShowExample(true);
    speak(guide.spoken);
  }, [speak]);

  // Escucha de comandos de voz durante la rutina ("ejemplo", "cómo", "ayuda")
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    let active = true;
    const startRecog = () => {
      if (!active || isSpeakingRef.current) return;
      const recog = new SpeechRecognition();
      recog.lang = 'es-ES';
      recog.continuous = false;
      recog.interimResults = false;
      recog.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript.toLowerCase();
        console.log('🎙️ [Workout Voz]:', transcript);
        if (/ejemplo|c[oó]mo|ayuda|enseñ|explica|mostr/.test(transcript)) {
          showExerciseExample();
        } else if (/sentadilla/.test(transcript)) {
          setExercise('squat');
          speak('Cambiamos a sentadillas.');
        } else if (/flexion|lagartija|plancha de brazos/.test(transcript)) {
          setExercise('pushup');
          speak('Cambiamos a flexiones.');
        }
      };
      recog.onend = () => { if (active) setTimeout(startRecog, 800); };
      recog.onerror = () => { if (active) setTimeout(startRecog, 1500); };
      try { recog.start(); recognitionRef.current = recog; } catch (e) {}
    };

    const timer = setTimeout(startRecog, 3000);
    return () => {
      active = false;
      clearTimeout(timer);
      if (recognitionRef.current) {
        try { recognitionRef.current.onend = null; recognitionRef.current.stop(); } catch (e) {}
      }
    };
  }, [showExerciseExample, speak]);

  // Guía inicial por voz según el objetivo del usuario
  useEffect(() => {
    const goal = user?.primary_goal || 'salud_general';
    const routine = ROUTINES[goal] || ROUTINES.salud_general;
    setExercise(routine.exercise);

    const greeting = user?.name ? `Hola ${user.name}. ` : '';
    const timer = setTimeout(() => {
      speak(`${greeting}${routine.instructions} Si necesitas ver cómo se hace, decí: ejemplo.`, () => {
        introDoneRef.current = true;
      });
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function setupCamera() {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }
    }
    setupCamera();

    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
      window.speechSynthesis?.cancel();
    };
  }, []);

  // Loop de procesamiento: solo envía un frame si no hay petición en vuelo
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!videoRef.current || isProcessingRef.current) return;
      if (videoRef.current.readyState < 2) return;

      isProcessingRef.current = true;

      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, 320, 240);
        canvas.toBlob(async (blob) => {
          try {
            if (blob) {
              const res = await processPoseFrame(blob, exercise);
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
          } catch (err) {
            // Silenciar timeouts para no saturar consola
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

  const exerciseName = exercise === 'squat' ? 'Sentadillas' : 'Flexiones';

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
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
        <div className="bg-black/60 backdrop-blur-md border border-white/10 px-6 py-3 rounded-2xl flex items-center space-x-4 shadow-2xl">
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
              onClick={() => { setShowExample(false); window.speechSynthesis?.cancel(); }}
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
              onClick={() => { setShowExample(false); window.speechSynthesis?.cancel(); speak('Perfecto. Comienza cuando estés listo.'); }}
              className="mt-5 w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-bold text-sm transition"
            >
              Entendido, ¡vamos!
            </button>
          </div>
        </div>
      )}

      {/* Overlay inferior: orbe + feedback */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center space-y-4 w-full max-w-md px-6">
        {/* Orbe del asistente */}
        <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 ${
          isSpeaking
            ? 'bg-blue-500/80 shadow-[0_0_40px_rgba(59,130,246,0.7)] scale-110'
            : 'bg-blue-600/50 shadow-[0_0_20px_rgba(59,130,246,0.4)]'
        }`}>
          <Volume2 className={`w-7 h-7 text-white ${isSpeaking ? 'animate-pulse' : ''}`} />
        </div>

        {/* Feedback hablado */}
        <div className="bg-black/60 backdrop-blur-md border border-white/10 px-5 py-3 rounded-2xl shadow-xl w-full text-center">
          <p className="text-sm font-medium text-gray-100">{feedback}</p>
        </div>

        {/* Selector de ejercicio + botón de ejemplo */}
        <div className="flex space-x-3 items-center">
          <button
            onClick={() => { setExercise('squat'); speak('Cambiamos a sentadillas. Aléjate hasta verte de cuerpo completo.'); }}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg transition ${exercise === 'squat' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-300 backdrop-blur-md'}`}
          >
            Sentadillas
          </button>
          <button
            onClick={() => { setExercise('pushup'); speak('Cambiamos a flexiones. Coloca la cámara para ver tu torso y brazos.'); }}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg transition ${exercise === 'pushup' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-300 backdrop-blur-md'}`}
          >
            Flexiones
          </button>
          <button
            onClick={showExerciseExample}
            title="Ver ejemplo del ejercicio"
            className="p-2.5 rounded-xl bg-white/10 text-gray-200 backdrop-blur-md hover:bg-white/20 shadow-lg transition"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};