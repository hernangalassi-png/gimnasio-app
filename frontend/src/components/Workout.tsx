import React, { useRef, useEffect, useState } from 'react';
import { processPoseFrame } from '../services/api';
import { Camera, Volume2 } from 'lucide-react';

export const Workout: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reps, setReps] = useState<number>(0);
  const [stage, setStage] = useState<string>('UP');
  const [feedback, setFeedback] = useState<string>('Asegúrate de estar visible');
  const [exercise, setExercise] = useState<string>('squat');

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
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!videoRef.current) return;

      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async (blob) => {
          if (blob) {
            try {
              const res = await processPoseFrame(blob, exercise);
              setReps(res.reps);
              setStage(res.stage);
              setFeedback(res.feedback);
            } catch (err) {
              console.error("Error procesando frame", err);
            }
          }
        }, 'image/jpeg', 0.6);
      }
    }, 300);

    return () => clearInterval(interval);
  }, [exercise]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <div className="relative w-full max-w-2xl bg-black rounded-lg overflow-hidden shadow-xl border border-gray-800">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-auto transform -scale-x-100" />
        
        <div className="absolute top-4 left-4 bg-black/70 backdrop-blur px-4 py-2 rounded-lg flex items-center space-x-3">
          <Camera className="w-6 h-6 text-green-400" />
          <div>
            <p className="text-xs text-gray-400 font-bold uppercase">{exercise}</p>
            <p className="text-3xl font-extrabold text-white">{reps} <span className="text-sm font-normal text-gray-300">reps</span></p>
          </div>
        </div>

        <div className="absolute bottom-4 left-4 right-4 bg-black/80 backdrop-blur p-3 rounded-lg flex items-center justify-between border border-gray-700">
          <div className="flex items-center space-x-2">
            <Volume2 className="w-5 h-5 text-blue-400 animate-pulse" />
            <p className="text-sm font-medium text-gray-200">{feedback}</p>
          </div>
          <span className={`px-2 py-1 text-xs font-bold rounded ${stage === 'DOWN' ? 'bg-yellow-500 text-black' : 'bg-green-500 text-black'}`}>
            {stage}
          </span>
        </div>
      </div>

      <div className="mt-4 flex space-x-4">
        <button 
          onClick={() => setExercise('squat')}
          className={`px-4 py-2 rounded-lg font-bold ${exercise === 'squat' ? 'bg-blue-600' : 'bg-gray-800'}`}
        >
          Sentadillas
        </button>
        <button 
          onClick={() => setExercise('pushup')}
          className={`px-4 py-2 rounded-lg font-bold ${exercise === 'pushup' ? 'bg-blue-600' : 'bg-gray-800'}`}
        >
          Flexiones
        </button>
      </div>
    </div>
  );
};