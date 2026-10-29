import { API_URL, log } from './api';

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LiveStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface LiveCallbacks {
  onToolCall?: (call: LiveToolCall) => void;
  onStatus?: (status: LiveStatus) => void;
  onTranscript?: (kind: 'input' | 'output', text: string) => void;
  onInterrupted?: () => void;
  onSpeaking?: (speaking: boolean) => void;
}

/**
 * Cliente del canal Gemini Live (vía proxy backend /live/ws).
 * Mic -> PCM Int16 16kHz -> WS -> Live API; audio de respuesta -> reproducción 24kHz.
 * Los tool calls viajan al gate de propuestas del componente.
 */
export class LiveVoiceClient {
  private ws: WebSocket | null = null;
  private micStream: MediaStream | null = null;
  private captureCtx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private nextPlayTime = 0;
  private playSources: AudioBufferSourceNode[] = [];
  private speakingTimer: ReturnType<typeof setTimeout> | null = null;
  // Half-duplex: mientras GALIA habla, no subir audio del mic (evita eco de parlante)
  private modelSpeaking = false;
  private modelMuteTimer: ReturnType<typeof setTimeout> | null = null;
  private callbacks: LiveCallbacks = {};
  private stopped = false;

  setCallbacks(cb: LiveCallbacks) {
    this.callbacks = cb;
  }

  private status(s: LiveStatus) {
    log('LIVE', 'Estado', { status: s });
    this.callbacks.onStatus?.(s);
  }

  async connect(): Promise<boolean> {
    this.stopped = false;
    const wsUrl = API_URL.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/live/ws';
    this.status('connecting');

    try {
      // Mic a 16kHz mono: formato nativo de entrada de Live API
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (e) {
      log('LIVE', 'Permiso de micrófono denegado', { error: e });
      this.status('error');
      return false;
    }

    const ready = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      // 25s: el backend hace accept() + connect a Gemini Live antes de mandar
      // 'ready'; en cold start de Render eso puede superar los 15s originales.
      const timeout = setTimeout(() => { try { ws.close(); } catch {} resolve(false); }, 25000);

      ws.onopen = () => log('LIVE', 'WS abierto, esperando ready');
      ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }

        if (msg.type === 'ready') {
          clearTimeout(timeout);
          log('LIVE', 'Sesión lista', { model: msg.model });
          resolve(true);
          return;
        }
        if (msg.type === 'error') {
          log('LIVE', 'Error del proxy', { detail: msg.detail });
          clearTimeout(timeout);
          resolve(false);
          return;
        }
        this.handleMessage(msg);
      };
      ws.onerror = () => { clearTimeout(timeout); resolve(false); };
      ws.onclose = () => {
        log('LIVE', 'WS cerrado');
        if (!this.stopped) this.status('disconnected');
      };
    });

    if (!ready) {
      this.disconnect();
      this.status('error');
      return false;
    }

    await this.startCapture();
    this.status('connected');
    return true;
  }

  private async startCapture() {
    this.captureCtx = new AudioContext({ sampleRate: 16000 });
    await this.captureCtx.audioWorklet.addModule('pcm-capture-worklet.js');
    const source = this.captureCtx.createMediaStreamSource(this.micStream!);
    this.workletNode = new AudioWorkletNode(this.captureCtx, 'pcm-capture');
    this.workletNode.port.onmessage = (ev) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.modelSpeaking) return; // GALIA hablando: no subir el eco del parlante
      // TTS local (intro de rutina, guías) suena por el mismo parlante: si lo
      // subimos, Live lo escucha, responde encima y se percibe ruido/doble voz.
      if (window.speechSynthesis?.speaking) return;
      const b64 = btoa(String.fromCharCode(...new Uint8Array(ev.data)));
      this.ws.send(JSON.stringify({ type: 'audio', data: b64 }));
    };
    source.connect(this.workletNode);
    // Sin destino -> no feedback del mic
    log('LIVE', 'Captura de mic iniciada (PCM 16kHz)');
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'audio':
        this.playPcm24(msg.data);
        break;
      case 'interrupted':
        this.clearPlayback();
        this.callbacks.onInterrupted?.();
        break;
      case 'tool_call':
        log('LIVE', 'Tool call recibido', { name: msg.name, id: msg.id });
        this.callbacks.onToolCall?.({ id: msg.id, name: msg.name, args: msg.args || {} });
        break;
      case 'tool_cancel':
        log('LIVE', 'Tool call cancelado por Live', { ids: msg.ids });
        break;
      case 'input_transcript':
        this.callbacks.onTranscript?.('input', msg.data);
        break;
      case 'output_transcript':
        this.callbacks.onTranscript?.('output', msg.data);
        break;
      case 'turn_complete':
        this.callbacks.onSpeaking?.(false);
        break;
    }
  }

  /** Reproduce PCM Int16 24kHz (formato de salida de Live API) */
  private playPcm24(b64: string) {
    if (!this.playbackCtx) this.playbackCtx = new AudioContext({ sampleRate: 24000 });
    const ctx = this.playbackCtx;
    // Autoplay policy: si el ctx quedó suspended, reanudar para que los chunks
    // no se acumulen en un tiempo congelado y suenen todos de golpe (ruido).
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x7fff;

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    // Lead de 60ms: buffer de jitter para que chunks que llegan con delay
    // variable no se programen "ya" y dejen micro-gaps (se escucha fritura).
    // Si la cola quedó atrás (underrun), nextPlayTime se re-ancla acá.
    const startAt = Math.max(now + 0.06, this.nextPlayTime);
    src.start(startAt);
    this.nextPlayTime = startAt + buffer.duration;
    this.playSources.push(src);
    src.onended = () => {
      this.playSources = this.playSources.filter((s) => s !== src);
    };

    this.callbacks.onSpeaking?.(true);
    if (this.speakingTimer) clearTimeout(this.speakingTimer);
    this.speakingTimer = setTimeout(() => this.callbacks.onSpeaking?.(false), 400);

    // Mantener el mic muteado hasta que la cola de reproducción drene (+150ms)
    this.modelSpeaking = true;
    if (this.modelMuteTimer) clearTimeout(this.modelMuteTimer);
    const unmuteInMs = Math.max(150, (this.nextPlayTime - now) * 1000 + 150);
    this.modelMuteTimer = setTimeout(() => { this.modelSpeaking = false; }, unmuteInMs);
  }

  private clearPlayback() {
    this.playSources.forEach((s) => { try { s.stop(); } catch {} });
    this.playSources = [];
    this.nextPlayTime = 0;
    this.modelSpeaking = false;
    if (this.modelMuteTimer) { clearTimeout(this.modelMuteTimer); this.modelMuteTimer = null; }
    this.callbacks.onSpeaking?.(false);
  }

  /** Respuesta de herramienta -> Live (resultado del árbitro local) */
  sendToolResponse(id: string, name: string, response: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'tool_response', id, name, response }));
    }
  }

  /** Texto contextual -> Live (estado de la sesión, ejercicio actual, etc.) */
  sendContext(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'text', data: text }));
    }
  }

  disconnect() {
    this.stopped = true;
    this.clearPlayback();
    try { this.ws?.send(JSON.stringify({ type: 'close' })); } catch {}
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.workletNode?.disconnect();
    this.workletNode = null;
    this.captureCtx?.close().catch(() => {});
    this.captureCtx = null;
    this.playbackCtx?.close().catch(() => {});
    this.playbackCtx = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.status('disconnected');
  }
}
