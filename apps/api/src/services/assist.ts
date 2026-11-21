import type { Config } from '../config.ts';
import type { Db } from '../db/pool.ts';
import { err } from '../errors.ts';
import type { Actor } from './actor.ts';
import { requireHotel } from './actor.ts';
import { draftOf, getOrder, matchItems } from './orders.ts';

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

const DOC_TYPES = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

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
    if (!DOC_TYPES.test(mime)) throw err('INVALID_INPUT', 'Send a photo (JPEG, PNG, WebP) or a PDF');
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

const DOC_SCHEMA = {
  type: 'object', required: ['kind', 'lines'],
  properties: {
    kind: { type: 'string', enum: ['BILL', 'LIST', 'OTHER'], description: 'BILL = an invoice, bill or delivery note from a supplier. LIST = a list of items someone wants to buy. OTHER = anything else.' },
    supplierName: { type: ['string', 'null'] },
    lines: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, quantity: { type: ['number', 'null'] }, unitPrice: { type: ['number', 'null'] } } } },
    billTotal: { type: ['number', 'null'] },
    summary: { type: 'string', description: 'One short plain sentence saying what this document is' },
  },
};

/**
 * Reads a photo or PDF handed to the app with the + button and works out what to do with it. Saves nothing.
 * A supplier's bill for an order that is on its way becomes a pre-filled delivery check; any other list of items becomes an order draft.
 */
export async function readDocument(db: Db, cfg: Config, actor: Actor, siteId: string, file: Buffer, mime: string, fetchImpl: typeof fetch = fetch) {
  await requireHotel(db, actor, siteId, ['MANAGER', 'OWNER']);
  let doc: { kind: string; supplierName: string | null; lines: { name: string; quantity: number | null; unitPrice: number | null }[]; billTotal: number | null; summary: string } | null = null;
  if (mime === 'text/plain') {
    // Stand-in used by tests and demos: "BILL: Supplier" or "LIST: Supplier" on the first line, then "name, quantity, price".
    const [head, ...rest] = file.toString('utf8').split(/\r?\n/);
    const m = /^(BILL|LIST|OTHER)\s*:?\s*(.*)$/i.exec(head.trim());
    doc = { kind: (m?.[1] ?? 'OTHER').toUpperCase(), supplierName: m?.[2]?.trim() || null, billTotal: null, summary: head.trim(),
      lines: rest.map((l) => l.split(',').map((x) => x.trim())).filter((c) => c[0]).map((c) => ({ name: c[0], quantity: c[1] ? num(c[1]) : null, unitPrice: c[2] ? num(c[2]) : null })) };
  } else {
    if (!DOC_TYPES.test(mime)) throw err('INVALID_INPUT', 'Send a photo (JPEG, PNG, WebP) or a PDF');
    const out = await askGemini(cfg, [
      { text: 'This document comes from a hotel in India (it may be printed or handwritten, in English, Hindi or Gujarati). Say what kind it is, the supplier or shop name if one is shown, and every item line with its name as written, quantity and price for one unit (null when not shown). Do not guess numbers you cannot read.' },
      { inlineData: { mimeType: mime, data: file.toString('base64') } },
    ], { schema: DOC_SCHEMA, timeoutMs: 20000 }, fetchImpl);
    if (out && Array.isArray(out.lines)) doc = {
      kind: ['BILL', 'LIST'].includes(out.kind) ? out.kind : 'OTHER', supplierName: out.supplierName ? String(out.supplierName).slice(0, 80) : null,
      billTotal: out.billTotal == null ? null : num(out.billTotal), summary: String(out.summary ?? '').slice(0, 200),
      lines: out.lines.slice(0, 60).map((l: any) => ({ name: String(l.name ?? '').slice(0, 80), quantity: l.quantity == null ? null : num(l.quantity), unitPrice: l.unitPrice == null ? null : num(l.unitPrice) })).filter((l: any) => l.name),
    };
  }
  if (!doc) return { type: 'NONE', read: false, summary: null };
  if (!doc.lines.length) return { type: 'NONE', read: true, summary: doc.summary || null };

  const sups = (await db.query('SELECT id, name FROM suppliers WHERE organization_id = $1 AND active ORDER BY length(name) DESC', [actor.orgId])).rows as { id: string; name: string }[];
  const said = (doc.supplierName ?? '').toLowerCase();
  const supplier = said ? sups.find((s) => said.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(said)) ?? null : null;
  const clean = (n: string) => n.toLowerCase().replace(/[^\p{L}\p{M}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const lines = await matchItems(db, actor, siteId, supplier?.id ?? null, doc.lines.map((l) => ({ quantity: l.quantity == null ? null : Math.round(l.quantity), phrase: clean(l.name) })), true);
  lines.forEach((l, i) => { l.heard = doc!.lines[i]?.name ?? l.heard; });

  // A bill from a supplier whose order is on its way: this is the delivery being checked.
  if (doc.kind === 'BILL' && supplier) {
    const o = await db.query(`SELECT id FROM purchase_orders WHERE organization_id = $1 AND site_id = $2 AND supplier_id = $3 AND status IN ('SENT','PARTIAL') ORDER BY sent_at DESC NULLS LAST LIMIT 1`, [actor.orgId, siteId, supplier.id]);
    if (o.rowCount) {
      const order = await getOrder(db, actor, o.rows[0].id);
      const open = order.lines.filter((l) => l.quantity - l.received > 0);
      const got: { productId: string; name: string; quantity: number; unitPrice: number | null }[] = [];
      const extras: { name: string; quantity: number | null }[] = [];
      lines.forEach((l, i) => {
        const on = l.match && open.find((x) => x.productId === l.match.productId);
        if (on && l.quantity != null && !got.some((g) => g.productId === on.productId)) got.push({ productId: on.productId, name: on.name, quantity: l.quantity, unitPrice: doc!.lines[i]?.unitPrice ?? null });
        else extras.push({ name: l.heard, quantity: l.quantity });
      });
      if (got.length) return { type: 'DELIVERY', read: true, summary: doc.summary || null, orderId: order.id,
        bill: { read: true, lines: got, extras: extras.slice(0, 10), missing: open.filter((x) => !got.some((g) => g.productId === x.productId)).map((x) => x.productId), billTotal: doc.billTotal } };
    }
  }
  if (!lines.some((l) => l.match)) return { type: 'NONE', read: true, summary: doc.summary || null };
  return { type: 'ORDER', read: true, summary: doc.summary || null, draft: draftOf(doc.summary, supplier, lines) };
}
