import axios from 'axios';

// Forzar HTTPS estrictamente para evitar Mixed Content
const RENDER_API_URL = 'https://gimnasio-app-ryq8.onrender.com/api/v1';

// Validar que la URL sea HTTPS
if (!RENDER_API_URL.startsWith('https://')) {
  throw new Error('API_URL debe usar HTTPS obligatoriamente');
}

export const API_URL = RENDER_API_URL;

console.log('API_URL configurada (HTTPS forzado):', API_URL);

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 segundos timeout
});

// Interceptor para loggear peticiones
api.interceptors.request.use(
  (config) => {
    const fullURL = `${config.baseURL}${config.url}`;
    console.log('📡 Petición Axios:', {
      url: config.url,
      fullURL: fullURL,
      method: config.method,
      protocol: fullURL.startsWith('https://') ? 'HTTPS ✅' : 'HTTP ❌'
    });
    return config;
  },
  (error) => {
    console.error('Error en request interceptor:', error);
    return Promise.reject(error);
  }
);

// Interceptor solo para loggear errores, SIN retry automático
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const config = error.config;

    console.error('❌ Error en respuesta Axios:', {
      code: error.code,
      message: error.message,
      status: error.response?.status,
      url: config?.url,
      fullURL: config ? `${config.baseURL}${config.url}` : 'unknown'
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