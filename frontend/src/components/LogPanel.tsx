import React, { useRef, useState } from 'react';
import { getLogBuffer, copyLogBuffer, clearLogBuffer, logPaused, log } from '../services/api';

// Panel de debug flotante: botón chico abajo-izquierda que abre el buffer de logs
// con controles Pausar / Copiar / Limpiar. Pensado para capturar logs en el celu
// donde la consola del navegador no es accesible.
export const LogPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [feedback, setFeedback] = useState('');
  const snapshotRef = useRef<string[]>([]);

  const toggleOpen = () => {
    if (!open) {
      // Snapshot al abrir: el panel muestra lo que había hasta ese momento
      snapshotRef.current = [...getLogBuffer()];
    }
    setOpen(!open);
    setFeedback('');
  };

  const togglePause = () => {
    logPaused.current = !logPaused.current;
    setPaused(logPaused.current);
    log('LOG', logPaused.current ? 'Captura pausada' : 'Captura reanudada');
    if (logPaused.current) snapshotRef.current = [...getLogBuffer()];
  };

  const handleCopy = async () => {
    const lines = paused ? snapshotRef.current : getLogBuffer();
    const ok = paused
      ? await navigator.clipboard.writeText(lines.join('\n')).then(() => true).catch(() => false)
      : await copyLogBuffer();
    setFeedback(ok ? `${lines.length} líneas copiadas` : 'No se pudo copiar');
    setTimeout(() => setFeedback(''), 2500);
  };

  const handleClear = () => {
    clearLogBuffer();
    snapshotRef.current = [];
    setFeedback('Buffer limpiado');
    setTimeout(() => setFeedback(''), 2500);
  };

  const lines = paused ? snapshotRef.current : getLogBuffer();

  return (
    <>
      <button
        onClick={toggleOpen}
        className="fixed bottom-3 left-3 z-[60] w-9 h-9 rounded-full bg-black/60 border border-white/20 text-[10px] font-bold text-gray-300 backdrop-blur-sm"
        aria-label="Logs"
      >
        LOG
      </button>

      {open && (
        <div className="fixed bottom-14 left-3 z-[60] w-[calc(100vw-24px)] max-w-md bg-black/90 border border-white/20 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col max-h-[60vh]">
          <div className="flex items-center gap-2 p-2 border-b border-white/10">
            <button
              onClick={togglePause}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                paused ? 'bg-yellow-600/80 text-white' : 'bg-white/10 text-gray-200 hover:bg-white/20'
              }`}
            >
              {paused ? 'Reanudar' : 'Pausar'}
            </button>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600/80 text-white hover:bg-blue-600 transition"
            >
              Copiar
            </button>
            <button
              onClick={handleClear}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 text-gray-200 hover:bg-white/20 transition"
            >
              Limpiar
            </button>
            <span className="ml-auto text-[10px] text-gray-400 px-1">
              {feedback || `${lines.length} líneas`}
            </span>
            <button
              onClick={toggleOpen}
              className="px-2 py-1 rounded-lg text-xs text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <pre className="p-2 overflow-auto text-[9px] leading-tight text-gray-300 font-mono whitespace-pre-wrap break-all">
            {lines.join('\n') || '(sin logs)'}
          </pre>
        </div>
      )}
    </>
  );
};
