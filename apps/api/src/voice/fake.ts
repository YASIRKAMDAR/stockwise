/**
 * FAKE, rule-based text parser used only by FakeProvider for automated tests and local demos
 * without a Gemini key. It is NOT production speech understanding — it exists so the
 * resolver → proposal → confirm pipeline can be exercised deterministically in CI.
 */
import type { CatalogContext } from './prompt.ts';

const NATIVE_DIGITS: Record<string, string> = {};
'૦૧૨૩૪૫૬૭૮૯'.split('').forEach((c, i) => (NATIVE_DIGITS[c] = String(i)));
'०१२३४५६७८९'.split('').forEach((c, i) => (NATIVE_DIGITS[c] = String(i)));
export const normalizeDigits = (s: string) => s.replace(/[૦-૯०-९]/g, (c) => NATIVE_DIGITS[c]);

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10, bees: 20, pachees: 25, pachaas: 50, sau: 100,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'बीस': 20, 'पच्चीस': 25, 'पचास': 50, 'सौ': 100,
  'એક': 1, 'બે': 2, 'ત્રણ': 3, 'ચાર': 4, 'પાંચ': 5, 'છ': 6, 'સાત': 7, 'આઠ': 8, 'નવ': 9, 'દસ': 10, 'વીસ': 20, 'પચીસ': 25, 'પચાસ': 50, 'સો': 100,
};
const DIGIT_WORDS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']);
const NEG = /^(nahi|nahin|नहीं|નહીં|not)$/;

const has = (t: string, re: RegExp) => re.test(t);

function detectAction(t: string) {
  if (has(t, /running low|what.{0,10}low|\blow stock|kam hai|कम है|ઓછ|needs? attention|alerts?/)) return 'SHOW_ALERTS';
  if (has(t, /(show|open|dikhao|दिखाओ|બતાવો).{0,20}(transfers?|deliver)|\btransfers\b|deliveries|ટ્રાન્સફર બતાવો/)) return 'SHOW_TRANSFERS';
  if (has(t, /room use|usage|used in rooms|rooms? me kitna|kitna use/)) return 'SHOW_ROOM_USE';
  if (has(t, /(start|shuru|शुरू|શરૂ).{0,25}(count|ginti|गिनती|ગણતરી)|(count|ginti|गिनती|ગણતરી).{0,20}(start|shuru|शुरू|શરૂ)/)) return 'START_COUNT';
  if (has(t, /recent changes|show (the )?changes|history|badlav|बदलाव/)) return 'SHOW_CHANGES';
  if (has(t, /kitne|कितने|how many|કેટલા|bache|बचे|left\?|\bleft\b/)) return 'STOCK_QUERY';
  if (has(t, /pacha|પાછા|wapas|वापस|return/)) return 'RETURN_TO_STORE';
  if (has(t, /bhej|भेज|મોકલ|\bsent\b|\bsend\b/)) return 'TRANSFER_DISPATCH';
  if (has(t, /rakh|रख|મૂક|placed|\bplace\b|\bput\b/)) return 'PLACE_IN_ROOM';
  if (has(t, /liye|liya|लिए|लिया|took|taken|લીધ/)) return 'CHECKOUT_TO_STAFF';
  if (has(t, /(hotel|होटल|હોટેલ).{0,20}(se|से|થી|from).{0,20}(aaye|आए|આવ્યા|received|mila)/) || has(t, /received from hotel/)) return 'TRANSFER_RECEIPT';
  if (has(t, /aaye|aaya|आए|आया|આવ્યા|આવ્યો|received|arrived|delivered/)) return 'SUPPLIER_RECEIPT';
  return 'UNKNOWN';
}

interface Tok { text: string; start: number; end: number }

export function fakeParse(input: string, ctx: CatalogContext) {
  const transcript = input.trim();
  const t = normalizeDigits(transcript.toLowerCase());
  const lang = /[઀-૿]/.test(t) ? 'gu-IN' : /[ऀ-ॿ]/.test(t) ? 'hi-IN' : /\b(mein|main|rakh|liye|bhej|aaye|nahi|se|ko)\b/.test(t) ? 'mixed' : 'en-IN';
  const toks: Tok[] = [];
  for (const m of t.matchAll(/[^\s,.?!]+/g)) toks.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });
  const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORDS[s] ?? null);

  const used = new Set<number>();
  const rooms: { idx: number; room: string }[] = [];
  let hotelCode: string | null = null;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i].text;
    if (/^(room|rum|kamra|कमरा|रूम|રૂમ|ઓરડો)$/.test(w)) {
      let digits = '';
      let j = i + 1;
      if (j < toks.length && /^\d+$/.test(toks[j].text)) { digits = toks[j].text; used.add(j); j++; }
      else while (j < toks.length && DIGIT_WORDS.has(toks[j].text)) { digits += String(WORDS[toks[j].text]); used.add(j); j++; }
      if (digits) rooms.push({ idx: i, room: digits });
    }
    if (/^(hotel|होटल|હોટેલ)$/.test(w)) {
      const n = toks[i + 1] && num(toks[i + 1].text);
      if (n != null) { hotelCode = String(n); used.add(i + 1); }
      else if (i > 0 && num(toks[i - 1].text) != null) { hotelCode = String(num(toks[i - 1].text)); used.add(i - 1); }
    }
  }
  // Self-corrections: "50 nahi 15" -> drop the first number.
  for (let i = 0; i + 2 < toks.length; i++) if (num(toks[i].text) != null && NEG.test(toks[i + 1].text) && num(toks[i + 2].text) != null) used.add(i);

  // Product matches, longest alias first, non-overlapping.
  const aliases = ctx.products.flatMap((p) => [p.name, p.sku.replace(/_/g, ' '), ...p.aliases].map((a) => ({ sku: p.sku, a: a.toLowerCase() })));
  aliases.sort((x, y) => y.a.length - x.a.length);
  const taken: [number, number][] = [];
  const hits: { sku: string; spoken: string; pos: number }[] = [];
  for (const { sku, a } of aliases) {
    let from = 0;
    while (a && (from = t.indexOf(a, from)) !== -1) {
      const end = from + a.length;
      const plural = t.slice(end).match(/^(e?s)\b/);
      const realEnd = plural ? end + plural[0].length : end;
      const before = from === 0 || /[\s,.]/.test(t[from - 1]);
      if (before && !taken.some(([s, e]) => from < e && realEnd > s)) { taken.push([from, realEnd]); hits.push({ sku, spoken: transcript.slice(from, realEnd), pos: from }); }
      from = realEnd;
    }
  }
  hits.sort((a, b) => a.pos - b.pos);

  const items = hits.map((h) => {
    const tokIdx = toks.findIndex((k) => k.start >= h.pos);
    let qty: number | null = null;
    for (let j = tokIdx - 1; j >= 0 && j >= tokIdx - 4; j--) {
      if (used.has(j)) continue;
      const n = num(toks[j].text);
      if (n != null && n > 0) { qty = n; used.add(j); break; }
    }
    const room = [...rooms].reverse().find((r) => toks[r.idx].start < h.pos)?.room ?? (rooms.length === 1 ? rooms[0].room : null);
    const sourceHint = /store se|storeroom|स्टोर से|સ્ટોરમાંથી|from (the )?store/.test(t) ? 'STORE' : null;
    return { spokenProduct: h.spoken, quantity: qty, roomNumber: room, targetHotelCode: hotelCode, sourceHint };
  });
  let action = detectAction(t);
  // "Room 203, two soap" with no verb: a room plus items means items were put in the room.
  if (action === 'UNKNOWN' && rooms.length && hits.length) action = 'PLACE_IN_ROOM';
  const INFO = new Set(['STOCK_QUERY', 'SHOW_ALERTS', 'SHOW_TRANSFERS', 'SHOW_ROOM_USE', 'SHOW_CHANGES', 'START_COUNT']);
  const missingQty = items.some((i) => i.quantity == null) && !INFO.has(action);
  const corrected = toks.some((k) => NEG.test(k.text));
  return {
    language: lang,
    action,
    transcript,
    items: INFO.has(action) && action !== 'STOCK_QUERY' ? [] : items,
    clarificationNeeded: action === 'UNKNOWN' || (!INFO.has(action) && (missingQty || !items.length)),
    clarificationQuestion: action === 'UNKNOWN' ? 'What did you do with the stock?' : INFO.has(action) ? null : missingQty ? 'How many?' : !items.length ? 'Which item?' : null,
    notes: corrected ? 'Speaker corrected a quantity' : hotelCode && INFO.has(action) ? `hotel:${hotelCode}` : null,
  };
}
