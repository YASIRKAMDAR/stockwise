import type { Config } from '../config.ts';
import type { Db } from '../db/pool.ts';
import { err } from '../errors.ts';
import type { Actor } from './actor.ts';
import { getOrder } from './orders.ts';

/** One JSON answer from Google's model. Returns null when the model is not switched on or does not answer: callers fall back to doing it by hand. */
async function askGemini(cfg: Config, parts: unknown[], o: { schema?: unknown; search?: boolean; timeoutMs?: number }, fetchImpl: typeof fetch = fetch): Promise<any | null> {
  if (cfg.VOICE_PROVIDER !== 'gemini' || !cfg.GEMINI_API_KEY) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), o.timeoutMs ?? 12000);
  try {
    const res = await fetchImpl(`${cfg.GEMINI_API_BASE}/models/${encodeURIComponent(cfg.GEMINI_MODEL)}:generateContent`, {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        ...(o.search ? { tools: [{ google_search: {} }] } : {}),
        // A fixed answer shape cannot always be combined with web search, so searches ask for JSON in the prompt instead.
        generationConfig: o.search ? { temperature: 0, maxOutputTokens: 2048 } : { responseMimeType: 'application/json', responseJsonSchema: o.schema, temperature: 0, maxOutputTokens: 2048 },
      }),
    });
    if (!res.ok) { console.warn(JSON.stringify({ msg: 'gemini assist failed', status: res.status, detail: (await res.text().catch(() => '')).slice(0, 300) })); return null; }
    const json: any = await res.json();
    const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
    const start = text.search(/[[{]/); const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  } catch (e) { console.warn(JSON.stringify({ msg: 'gemini assist error', error: String(e) })); return null; } finally { clearTimeout(t); }
}

const BILL_SCHEMA = {
  type: 'object', required: ['lines'],
  properties: {
    lines: { type: 'array', items: { type: 'object', required: ['name', 'quantity'], properties: {
      index: { type: ['integer', 'null'], description: 'Number of the matching ordered item, or null if it is not on the order' },
      name: { type: 'string' }, quantity: { type: 'number' }, unitPrice: { type: ['number', 'null'] } } } },
    billTotal: { type: ['number', 'null'] },
  },
};

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

/**
 * Reads a photo of the supplier's bill against one order. Nothing is saved: the app pre-fills the delivery check and the manager confirms.
 * Without Google's model, a plain-text "bill" (name, quantity, price per line) is read instead, which is what tests and demos use.
 */
export async function readBill(db: Db, cfg: Config, actor: Actor, orderId: string, image: Buffer, mime: string, fetchImpl: typeof fetch = fetch) {
  const order = await getOrder(db, actor, orderId);
  const open = order.lines.filter((l) => l.quantity - l.received > 0);
  let rows: { index: number | null; name: string; quantity: number | null; unitPrice: number | null }[] | null = null;
  let billTotal: number | null = null;
  if (mime === 'text/plain') {
    rows = image.toString('utf8').split(/\r?\n/).map((s) => s.split(',').map((x) => x.trim())).filter((c) => c.length >= 2 && c[0]).map((c) => {
      const i = open.findIndex((l) => l.name.toLowerCase() === c[0].toLowerCase());
      return { index: i < 0 ? null : i + 1, name: c[0], quantity: num(c[1]), unitPrice: c[2] ? num(c[2]) : null };
    });
  } else {
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw err('INVALID_INPUT', 'Photos must be JPEG, PNG or WebP');
    const list = open.map((l, i) => `${i + 1}. ${l.name} — ordered ${l.quantity - l.received} ${l.unit}`).join('\n');
    const out = await askGemini(cfg, [
      { text: `This is a photo of a supplier's bill or delivery note from India (it may be handwritten, in English, Hindi or Gujarati).\nThe order was:\n${list}\n\nFor every line on the bill give: index (the number of the matching ordered item, or null), name as written, quantity delivered, and unitPrice (price for one unit, before tax, or null if not shown). Also billTotal if shown. Do not guess numbers you cannot read: leave that line out.` },
      { inlineData: { mimeType: mime, data: image.toString('base64') } },
    ], { schema: BILL_SCHEMA }, fetchImpl);
    if (out && Array.isArray(out.lines)) {
      rows = out.lines.map((r: any) => ({ index: Number.isInteger(r.index) ? r.index : null, name: String(r.name ?? '').slice(0, 80), quantity: num(r.quantity), unitPrice: r.unitPrice == null ? null : num(r.unitPrice) }));
      billTotal = out.billTotal == null ? null : num(out.billTotal);
    }
  }
  if (!rows) return { read: false, lines: [], extras: [], missing: [], billTotal: null };
  const lines: { productId: string; name: string; quantity: number; unitPrice: number | null }[] = [];
  const extras: { name: string; quantity: number | null }[] = [];
  for (const r of rows) {
    const l = r.index != null ? open[r.index - 1] : undefined;
    if (!l || r.quantity == null || lines.some((x) => x.productId === l.productId)) { if (r.name) extras.push({ name: r.name, quantity: r.quantity }); continue; }
    lines.push({ productId: l.productId, name: l.name, quantity: Math.round(r.quantity), unitPrice: r.unitPrice });
  }
  return { read: true, lines, extras: extras.slice(0, 10), missing: open.filter((l) => !lines.some((x) => x.productId === l.productId)).map((l) => l.productId), billTotal };
}

/**
 * Looks an item up on the web so the manager can pick the right pack instead of typing it. Prices are a rough guide only.
 * Always a list to pick from; nothing is added to the item list here.
 */
export async function lookupItem(cfg: Config, q: string, fetchImpl: typeof fetch = fetch) {
  const query = q.trim().slice(0, 60);
  if (query.length < 3) throw err('INVALID_INPUT', 'Type at least 3 letters');
  if (cfg.NODE_ENV === 'test' && cfg.VOICE_PROVIDER !== 'gemini') {
    return { available: true, options: [{ name: `${query} 200 g`, brand: null, pack: '200 g', unit: 'PKT', approxPrice: 120 }, { name: `${query} 1 kg`, brand: null, pack: '1 kg', unit: 'KG', approxPrice: 560 }] };
  }
  const out = await askGemini(cfg, [{ text:
    `Search the web for the product "${query}" as sold in India (grocery, hotel and restaurant supplies).\n` +
    `Answer with ONLY a JSON array of up to 6 real pack sizes that are commonly sold, most common first. Each entry: ` +
    `{"name": full product name with pack size, "brand": brand or null, "pack": pack size such as "500 g" or "1 L", "unit": one of PCS, KG, LTR, PKT, BOX, BTL, CAN, "approxPrice": typical retail price in rupees as a number, or null if you did not find one}. ` +
    `Do not invent products or prices. If nothing is found answer [].` }], { search: true, timeoutMs: 15000 }, fetchImpl);
  if (!Array.isArray(out)) return { available: out !== null, options: [] };
  const units = new Set(['PCS', 'KG', 'LTR', 'PKT', 'BOX', 'BTL', 'CAN']);
  const options = out.filter((o: any) => o && typeof o.name === 'string' && o.name.trim().length >= 2).slice(0, 6).map((o: any) => ({
    name: String(o.name).trim().slice(0, 80), brand: o.brand ? String(o.brand).slice(0, 40) : null, pack: o.pack ? String(o.pack).slice(0, 20) : null,
    unit: units.has(String(o.unit).toUpperCase()) ? String(o.unit).toUpperCase() : 'PCS', approxPrice: o.approxPrice == null ? null : num(o.approxPrice),
  }));
  return { available: true, options };
}
