import { LANG_CODES, type Lang } from '../i18n';

/** Browser speech recognition (Chrome/Android). Used to turn speech into text when no
 * audio model is configured, and to hear a spoken "yes/no" on the check screen. */
const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
export const hasSpeechRecognition = () => !!SR;

export interface Listener { stop: () => void; abort: () => void }
export function recognize(lang: Lang, opts: { onInterim?: (t: string) => void; onEnd: (text: string, error?: string) => void; continuous?: boolean }): Listener | null {
  if (!SR) return null;
  try {
    const r = new SR();
    r.lang = LANG_CODES[lang]; r.interimResults = !!opts.onInterim; r.maxAlternatives = 1; r.continuous = !!opts.continuous;
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

/** Keeps listening until stopped (Chrome ends a session after silence, so it restarts).
 * Each finished phrase is passed to onPhrase. */
export function listenContinuously(lang: Lang, h: { onPhrase: (t: string) => void; onInterim?: (t: string) => void; onStop: (error?: string) => void }): Listener | null {
  if (!SR) return null;
  let active = true; let r: any = null; let fatal: string | undefined;
  const open = () => {
    r = new SR(); r.lang = LANG_CODES[lang]; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) h.onPhrase(t.trim()); else interim += t;
      }
      h.onInterim?.(interim.trim());
    };
    r.onerror = (e: any) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') { fatal = e.error; active = false; } };
    r.onend = () => { if (active) { try { open(); } catch { active = false; h.onStop(fatal); } } else h.onStop(fatal); };
    r.start();
  };
  try { open(); } catch { return null; }
  return { stop: () => { active = false; try { r?.stop(); } catch { /* stopped */ } }, abort: () => { active = false; try { r.onend = null; r?.abort(); } catch { /* stopped */ } } };
}

const NUM_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10, bees: 20, pachas: 50, pachaas: 50,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'बीस': 20, 'पचास': 50,
  'એક': 1, 'બે': 2, 'ત્રણ': 3, 'ચાર': 4, 'પાંચ': 5, 'છ': 6, 'સાત': 7, 'આઠ': 8, 'નવ': 9, 'દસ': 10, 'વીસ': 20, 'પચાસ': 50,
};
const HUNDRED = new Set(['hundred', 'sau', 'सौ', 'સો']);
const nativeDigits = (s: string) => s.replace(/[૦-૯]/g, (d) => String(d.charCodeAt(0) - 0x0ae6)).replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));

export interface CountProduct { productId: string; name: string; sku: string; aliases: string[] }
/** "soap 180, shampoo 110" / "180 soap" / "shampoo one hundred ten" → [{productId, qty}] plus anything not understood. */
export function parseCountSpeech(text: string, products: CountProduct[]) {
  const s = ' ' + nativeDigits(text.toLowerCase()).replace(/[,.;:!?।]/g, ' ') + ' ';
  const names = products.flatMap((p) => [p.name, p.sku.replace(/_/g, ' '), ...p.aliases].filter(Boolean).map((a) => ({ p, a: a.toLowerCase() })));
  names.sort((x, y) => y.a.length - x.a.length);
  const taken: [number, number, CountProduct][] = [];
  for (const { p, a } of names) {
    let from = 0;
    while ((from = s.indexOf(a, from)) !== -1) {
      const end = from + a.length; const plural = s.slice(end).match(/^(e?s)(?=\s)/); const realEnd = plural ? end + plural[0].length : end;
      if (/\s/.test(s[from - 1] ?? ' ') && /\s/.test(s[realEnd] ?? ' ') && !taken.some(([x, y]) => from < y && realEnd > x)) taken.push([from, realEnd, p]);
      from = realEnd;
    }
  }
  taken.sort((a, b) => a[0] - b[0]);
  // Numbers, merging "one hundred eighty" / "180" into a single value with its position.
  const nums: { start: number; end: number; v: number }[] = [];
  const re = /\S+/g; let m: RegExpExecArray | null; let cur: { start: number; end: number; v: number; part: number } | null = null;
  const flush = () => { if (cur) nums.push({ start: cur.start, end: cur.end, v: cur.v + cur.part }); cur = null; };
  while ((m = re.exec(s))) {
    const w = m[0]; const inName = taken.some(([x, y]) => m!.index >= x && m!.index < y);
    const d = /^\d+$/.test(w) ? Number(w) : NUM_WORDS[w];
    if (!inName && d != null) { if (cur && /^\d+$/.test(w)) flush(); cur = cur ?? { start: m.index, end: 0, v: 0, part: 0 }; cur.part += d; cur.end = m.index + w.length; }
    else if (!inName && cur && HUNDRED.has(w)) { cur.v += (cur.part || 1) * 100; cur.part = 0; cur.end = m.index + w.length; }
    else if (!inName && !cur && HUNDRED.has(w)) { cur = { start: m.index, end: m.index + w.length, v: 100, part: 0 }; }
    else if (w === 'and' && cur) { /* "one hundred and ten" */ }
    else flush();
  }
  flush();
  // "180 soap and 110 shampoo": the speaker puts numbers first.
  const numberFirst = !!nums.length && !!taken.length && nums[0].start < taken[0][0];
  const used = new Set<number>(); const out: { productId: string; name: string; qty: number }[] = [];
  taken.forEach(([x, y, p], i) => {
    const nextStart = taken[i + 1]?.[0] ?? Infinity; const prevEnd = taken[i - 1]?.[1] ?? -1;
    const after = () => nums.findIndex((n, j) => !used.has(j) && n.start >= y && n.start < nextStart); // "soap 180"
    const before = () => nums.findIndex((n, j) => !used.has(j) && n.end <= x && n.start > prevEnd); // "180 soap"
    let k = numberFirst ? before() : after();
    if (k < 0) k = numberFirst ? after() : before();
    if (k >= 0) { used.add(k); out.push({ productId: p.productId, name: p.name, qty: nums[k].v }); }
  });
  const understood = out.length > 0;
  return { items: out, missed: !understood && text.trim() ? text.trim() : null, productsWithoutNumber: taken.filter(([, , p]) => !out.some((o) => o.productId === p.productId)).map(([, , p]) => p.name) };
}
