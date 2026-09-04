import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'https://small-ideas-fly.loca.lt/api/v1';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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