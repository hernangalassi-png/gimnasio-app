import axios from 'axios';

// Logger con timestamp para trazar la secuencia completa de la app.
// También alimenta un buffer interno que el LogPanel puede pausar/copiar.
const LOG_BUFFER_MAX = 800;
const logBuffer: string[] = [];
export const logPaused = { current: false };

export const log = (tag: string, msg: string, data?: unknown) => {
  const ts = new Date().toISOString();
  if (!logPaused.current) {
    const line = data !== undefined
      ? `[${ts}] [${tag}] ${msg} ${JSON.stringify(data)}`
      : `[${ts}] [${tag}] ${msg}`;
    logBuffer.push(line);
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX);
  }
  if (data !== undefined) {
    console.log(`[${ts}] [${tag}] ${msg}`, data);
  } else {
    console.log(`[${ts}] [${tag}] ${msg}`);
  }
};

export const getLogBuffer = (): string[] => logBuffer;
export const clearLogBuffer = () => { logBuffer.length = 0; };
export const copyLogBuffer = async (): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(logBuffer.join('\n'));
    return true;
  } catch {
    return false;
  }
};

// Forzar HTTPS estrictamente para evitar Mixed Content
const RENDER_API_URL = 'https://gimnasio-app-ryq8.onrender.com/api/v1';

// En dev (vite dev server) se puede overridear con VITE_API_URL en .env.development
// En producción el override NO aplica: siempre Render HTTPS
const DEV_API_URL = import.meta.env.DEV ? (import.meta.env.VITE_API_URL || '') : '';

// Validar que la URL sea HTTPS (solo aplica al default de producción)
if (!DEV_API_URL && !RENDER_API_URL.startsWith('https://')) {
  throw new Error('API_URL debe usar HTTPS obligatoriamente');
}

export const API_URL = DEV_API_URL || RENDER_API_URL;

log('API', 'API_URL configurada', { url: API_URL, devOverride: !!DEV_API_URL });

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 segundos timeout
});

// Interceptor para loggear peticiones con timestamp de inicio
api.interceptors.request.use(
  (config) => {
    (config as any).metadata = { startTime: performance.now() };
    const fullURL = `${config.baseURL}${config.url}`;
    log('HTTP', `→ ${config.method?.toUpperCase()} ${config.url}`, {
      fullURL,
      protocol: fullURL.startsWith('https://') ? 'HTTPS' : 'HTTP'
    });
    return config;
  },
  (error) => {
    console.error('Error en request interceptor:', error);
    return Promise.reject(error);
  }
);

// Interceptor para loggear respuestas con duración y errores, SIN retry automático
api.interceptors.response.use(
  (response) => {
    const start = (response.config as any).metadata?.startTime;
    const duration = start !== undefined ? Math.round(performance.now() - start) : -1;
    log('HTTP', `← ${response.status} ${response.config.url}`, { duration_ms: duration });
    return response;
  },
  (error) => {
    const config = error.config;
    const start = config?.metadata?.startTime;
    const duration = start !== undefined ? Math.round(performance.now() - start) : -1;

    log('HTTP', `← ERROR ${config?.url}`, {
      code: error.code,
      message: error.message,
      status: error.response?.status,
      duration_ms: duration
    });

    // NO reintentar automáticamente aquí para evitar afectar MediaPipe
    // El retry se maneja manualmente en identifyUser si es necesario
    return Promise.reject(error);
  }
);

export const processPoseFrame = async (imageBlob: Blob, exerciseType: string) => {
  const formData = new FormData();
  formData.append('file', imageBlob, 'frame.jpg');
  formData.append('exercise_type', exerciseType);

  const response = await api.post('/vision/process-pose', formData, {
    headers: { 
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export interface Equipment {
  id: string;
  name: string;
  category: string;
  is_available: boolean;
}

export interface Exercise {
  id: string;
  title: string;
  description?: string;
  target_muscles?: string[];
  required_equipment_ids?: string[];
  avatar_animation_id?: string;
  pose_landmarks_config?: Record<string, any>;
  exercise_type: string;
  suitable_goals?: string[];
  difficulty?: string;
}

export const getEquipment = async (): Promise<Equipment[]> => {
  const response = await api.get('/equipment/');
  return response.data;
};

export const getRecommendedRoutines = async (userId: string, availableEquipmentIds: string[], sessionGoal?: string): Promise<Exercise[]> => {
  const response = await api.post('/routines/recommend', {
    user_id: userId,
    available_equipment_ids: availableEquipmentIds,
    session_goal: sessionGoal,
  });
  return response.data;
};

// ---- Sesiones de entrenamiento (recibos durables APPLIED) ----

export interface WorkoutSession {
  id: string;
  session_mode: 'solo' | 'dueto' | 'grupo';
  user_ids: string[];
  started_at: string;
  ended_at?: string | null;
  status: 'in_progress' | 'completed' | 'cancelled';
}

export interface SessionSummary {
  session_id: string;
  session_mode: string;
  user_ids: string[];
  started_at: string;
  ended_at?: string | null;
  status: string;
  total_sets: number;
  total_volume_kg: number;
}

export interface LogSetPayload {
  user_id: string;
  exercise_id: string;
  set_number: number;
  target_reps: number;
  completed_reps: number;
  weight_used_kg?: number | null;
  rpe_reported?: number | null;
}

// Despierta el backend (Render free-tier cold start ~50-60s).
// Debe llamarse lo antes posible en el boot de la app, sin await.
export const warmUpBackend = () => {
  const t0 = performance.now();
  // /health vive en la raíz del API, fuera de /api/v1 -> ping directo
  fetch(`${API_URL.replace(/\/api\/v1$/, '')}/health`, { method: 'GET', mode: 'cors' })
    .then(r => log('WARMUP', 'Backend despierto', { status: r.status, elapsed_ms: Math.round(performance.now() - t0) }))
    .catch(e => log('WARMUP', 'Warm-up ping falló (se reintenta al primer request real)', { error: String(e) }));
};

export const startWorkoutSession = async (userIds: string[]): Promise<WorkoutSession> => {
  const response = await api.post('/sessions/start', { user_ids: userIds });
  return response.data;
};

export const logWorkoutSet = async (sessionId: string, payload: LogSetPayload) => {
  const response = await api.post(`/sessions/${sessionId}/log_set`, payload);
  return response.data;
};

export const endWorkoutSession = async (sessionId: string): Promise<SessionSummary> => {
  const response = await api.post(`/sessions/${sessionId}/end`);
  return response.data;
};