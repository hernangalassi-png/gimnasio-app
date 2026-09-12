import axios from 'axios';

// Logger con timestamp para trazar la secuencia completa de la app
export const log = (tag: string, msg: string, data?: unknown) => {
  const ts = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[${ts}] [${tag}] ${msg}`, data);
  } else {
    console.log(`[${ts}] [${tag}] ${msg}`);
  }
};

// Forzar HTTPS estrictamente para evitar Mixed Content
const RENDER_API_URL = 'https://gimnasio-app-ryq8.onrender.com/api/v1';

// Validar que la URL sea HTTPS
if (!RENDER_API_URL.startsWith('https://')) {
  throw new Error('API_URL debe usar HTTPS obligatoriamente');
}

export const API_URL = RENDER_API_URL;

log('API', 'API_URL configurada (HTTPS forzado)', API_URL);

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

export const getRecommendedRoutines = async (userId: string, availableEquipmentIds: string[]): Promise<Exercise[]> => {
  const response = await api.post('/routines/recommend', {
    user_id: userId,
    available_equipment_ids: availableEquipmentIds,
  });
  return response.data;
};