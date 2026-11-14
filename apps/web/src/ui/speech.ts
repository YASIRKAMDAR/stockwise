import { LANG_CODES, type Lang } from '../i18n';

/** Browser speech recognition (Chrome/Android). Used to turn speech into text when no
 * audio model is configured, and to hear a spoken "yes/no" on the check screen. */
const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
export const hasSpeechRecognition = () => !!SR;

export interface Listener { stop: () => void; abort: () => void }
export function recognize(lang: Lang, opts: { onInterim?: (t: string) => void; onEnd: (text: string, error?: string) => void }): Listener | null {
  if (!SR) return null;
  try {
    const r = new SR();
    r.lang = LANG_CODES[lang]; r.interimResults = !!opts.onInterim; r.maxAlternatives = 1; r.continuous = false;
    let text = ''; let err: string | undefined;
    r.onresult = (e: any) => { text = Array.from(e.results).map((x: any) => x[0].transcript).join(' '); opts.onInterim?.(text); };
    r.onerror = (e: any) => { err = e.error; };
    r.onend = () => opts.onEnd(text.trim(), err);
    r.start();
    return { stop: () => { try { r.stop(); } catch { /* already stopped */ } }, abort: () => { try { r.onend = null; r.abort(); } catch { /* already stopped */ } } };
  } catch { return null; }
}

const YES = ['haan', 'han', 'ha', 'haa', 'yes', 'yeah', 'yep', 'ok', 'okay', 'theek', 'thik', 'sahi', 'हाँ', 'हां', 'हा', 'ठीक', 'सही', 'ओके', 'હા', 'હાં', 'બરાબર', 'ઓકે', 'સાચું'];
const NO = ['nahi', 'nahin', 'na', 'no', 'nope', 'cancel', 'नहीं', 'नही', 'ना', 'ના', 'નહીં', 'નથી'];
export function yesNo(text: string): 'yes' | 'no' | null {
  const w = text.toLowerCase().split(/[\s,.!?।]+/);
  if (w.some((x) => NO.includes(x))) return 'no';
  if (w.some((x) => YES.includes(x))) return 'yes';
  return null;
}

/** Wait for any speech currently playing to finish (max ~8s). */
export function afterSpeech(): Promise<void> {
  return new Promise((res) => {
    if (typeof speechSynthesis === 'undefined') return res();
    const start = Date.now();
    const tick = () => (!speechSynthesis.speaking || Date.now() - start > 8000 ? res() : setTimeout(tick, 150));
    setTimeout(tick, 300);
  });
}

export function chime() {
  try {
    const a = new (window.AudioContext || (window as any).webkitAudioContext)();
    [660, 880].forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain(); const t0 = a.currentTime + i * 0.12;
      o.frequency.value = f; g.gain.setValueAtTime(0.15, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
      o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + 0.3);
    });
  } catch { /* audio unavailable */ }
}
