// Selección de voz TTS compartida: preferencia rioplatense/latinoamericana.
// getVoices() puede devolver [] hasta que el navegador carga las voces,
// por eso cacheamos y escuchamos 'voiceschanged'.

let cachedVoices: SpeechSynthesisVoice[] = [];

const refreshVoices = () => {
  if (!('speechSynthesis' in window)) return;
  const v = window.speechSynthesis.getVoices();
  if (v.length > 0) cachedVoices = v;
};

if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

export const pickSpanishVoice = (): SpeechSynthesisVoice | undefined => {
  if (cachedVoices.length === 0) refreshVoices();
  const voices = cachedVoices;
  return voices.find(v => /^es-(AR|UY|PY)/i.test(v.lang))
    || voices.find(v => /(argent|rioplat|latino|latin america)/i.test(v.name))
    || voices.find(v => /^es-(419|MX|US|CO|CL|PE|VE|EC|BO)/i.test(v.lang))
    || voices.find(v => /^es/i.test(v.lang));
};

// Aplica la mejor voz al utterance. Devuelve la voz elegida (para logging).
export const applySpanishVoice = (utterance: SpeechSynthesisUtterance): SpeechSynthesisVoice | undefined => {
  utterance.lang = 'es-AR';
  const voice = pickSpanishVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  return voice;
};
