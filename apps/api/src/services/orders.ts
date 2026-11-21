import type { Db, Tx } from '../db/pool.ts';
import { withTx } from '../db/pool.ts';
import { err } from '../errors.ts';
import { requireHotel, type Actor } from './actor.ts';
import { consumeBatches, USE_FIRST_SQL } from './catalog.ts';
import { hashRequest, idempotent } from './idempotency.ts';
import { postEvent } from './ledger.ts';
import { storeLocation } from './locations.ts';
import { listRequests, warehouseOf } from './requests.ts';
import { stockMatrix } from './reports.ts';
import { normalizeDigits } from '../voice/fake.ts';

const ROLES = ['MANAGER', 'OWNER'] as const;
export interface OrderLineIn { productId: string; quantity: number; unitPrice?: number | null }

function mergeLines(lines: OrderLineIn[]) {
  const m = new Map<string, OrderLineIn>();
  for (const l of lines) { const p = m.get(l.productId); m.set(l.productId, p ? { ...p, quantity: p.quantity + l.quantity } : { ...l }); }
  return [...m.values()].filter((l) => l.quantity > 0);
}

async function writeLines(tx: Tx, orgId: string, orderId: string, lines: OrderLineIn[]) {
  const ids = lines.map((l) => l.productId);
  const p = await tx.query('SELECT id, last_price FROM products WHERE organization_id = $1 AND active AND id = ANY($2::uuid[])', [orgId, ids]);
  if (p.rowCount !== ids.length) throw err('INVALID_ROOM_OR_PRODUCT', 'Unknown or inactive item');
  const last = new Map(p.rows.map((r) => [r.id, r.last_price]));
  await tx.query('DELETE FROM purchase_order_lines WHERE order_id = $1', [orderId]);
  for (const l of lines) await tx.query('INSERT INTO purchase_order_lines (order_id, product_id, quantity, unit_price) VALUES ($1,$2,$3,$4)', [orderId, l.productId, l.quantity, l.unitPrice ?? last.get(l.productId) ?? null]);
}

/** Creates a draft order to a supplier. Nothing is ordered until it is sent. */
export async function createOrder(db: Db, actor: Actor, b: { siteId: string; supplierId: string; lines: OrderLineIn[]; note?: string | null; expectedDate?: string | null; source?: 'FORM' | 'VOICE' | 'CHAT' }) {
  await requireHotel(db, actor, b.siteId, [...ROLES]);
  const lines = mergeLines(b.lines);
  if (!lines.length) throw err('INVALID_INPUT', 'Add at least one item');
  return withTx(db, async (tx) => {
    const s = await tx.query('SELECT id, delivery_days FROM suppliers WHERE id = $1 AND organization_id = $2 AND active', [b.supplierId, actor.orgId]);
    if (!s.rowCount) throw err('NOT_FOUND', 'Supplier not found');
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['po-number|' + actor.orgId]);
    const n = await tx.query('SELECT COALESCE(max(number), 0) + 1 AS n FROM purchase_orders WHERE organization_id = $1', [actor.orgId]);
    const r = await tx.query(
      `INSERT INTO purchase_orders (organization_id, number, site_id, supplier_id, note, expected_date, created_by, source)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6::date, CURRENT_DATE + COALESCE($7::int, 2)), $8, $9) RETURNING id, number`,
      [actor.orgId, n.rows[0].n, b.siteId, b.supplierId, b.note ?? null, b.expectedDate ?? null, s.rows[0].delivery_days, actor.userId, b.source ?? 'FORM']);
    await writeLines(tx, actor.orgId, r.rows[0].id, lines);
    return { id: r.rows[0].id as string, number: r.rows[0].number as number, status: 'DRAFT' };
  });
}

async function loadOrder(db: Db | Tx, actor: Actor, id: string, forUpdate = false) {
  const r = await db.query(`SELECT * FROM purchase_orders WHERE id = $1 AND organization_id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [id, actor.orgId]);
  if (!r.rowCount) throw err('NOT_FOUND', 'Order not found');
  await requireHotel(db, actor, r.rows[0].site_id, [...ROLES]);
  return r.rows[0];
}

export async function updateOrder(db: Db, actor: Actor, id: string, b: { lines?: OrderLineIn[]; supplierId?: string; note?: string | null; expectedDate?: string | null }) {
  return withTx(db, async (tx) => {
    const o = await loadOrder(tx, actor, id, true);
    if (o.status !== 'DRAFT') throw err('INVALID_INPUT', 'This order was already sent');
    if (b.supplierId) {
      const s = await tx.query('SELECT 1 FROM suppliers WHERE id = $1 AND organization_id = $2 AND active', [b.supplierId, actor.orgId]);
      if (!s.rowCount) throw err('NOT_FOUND', 'Supplier not found');
    }
    await tx.query('UPDATE purchase_orders SET supplier_id = COALESCE($2, supplier_id), note = CASE WHEN $3::boolean THEN $4 ELSE note END, expected_date = COALESCE($5::date, expected_date) WHERE id = $1',
      [id, b.supplierId ?? null, b.note !== undefined, b.note ?? null, b.expectedDate ?? null]);
    if (b.lines) { const lines = mergeLines(b.lines); if (!lines.length) throw err('INVALID_INPUT', 'Add at least one item'); await writeLines(tx, actor.orgId, id, lines); }
    return { id, status: 'DRAFT' };
  });
}

const fmtDate = (d: Date | string | null) => d ? new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;

/** The plain message that goes to the supplier on WhatsApp. No prices: the supplier quotes as they do today. */
export function orderMessage(o: { number: number; siteName: string; expectedDate: Date | string | null; lines: { name: string; quantity: number; unit: string }[] }) {
  const by = fmtDate(o.expectedDate);
  return [`Hello, order from ${o.siteName}:`, '', ...o.lines.map((l, i) => `${i + 1}. ${l.name} — ${l.quantity} ${l.unit}`), '', ...(by ? [`Please deliver by ${by}.`] : []), `Order ${o.number}. Thank you.`].join('\n');
}

export async function getOrder(db: Db, actor: Actor, id: string) {
  const o = await loadOrder(db, actor, id);
  const [lines, sup, site] = await Promise.all([
    db.query(
      `SELECT ol.product_id AS "productId", p.name, p.unit, p.photo_url AS "photoUrl", p.has_expiry AS "hasExpiry", ol.quantity, ol.unit_price, p.last_price,
              COALESCE((SELECT sum(dl.received + dl.rejected)::int FROM delivery_lines dl JOIN deliveries d ON d.id = dl.delivery_id WHERE d.order_id = ol.order_id AND dl.product_id = ol.product_id), 0) AS done,
              COALESCE((SELECT b.quantity FROM stock_balances b JOIN stock_locations sl ON sl.id = b.location_id WHERE sl.hotel_id = $2 AND sl.type = 'HOTEL_STORE' AND b.product_id = p.id), 0) AS store
         FROM purchase_order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = $1 ORDER BY p.name`, [id, o.site_id]),
    db.query('SELECT id, name, phone, on_whatsapp AS "onWhatsapp", delivery_days AS "deliveryDays" FROM suppliers WHERE id = $1', [o.supplier_id]),
    db.query('SELECT name FROM hotels WHERE id = $1', [o.site_id]),
  ]);
  const ls = lines.rows.map((l) => ({
    productId: l.productId, name: l.name, unit: l.unit, photoUrl: l.photoUrl, hasExpiry: l.hasExpiry, quantity: l.quantity, received: l.done, store: l.store,
    unitPrice: l.unit_price == null ? null : Number(l.unit_price), lastPrice: l.last_price == null ? null : Number(l.last_price),
  }));
  return {
    id: o.id, number: o.number, status: o.status, source: o.source, siteId: o.site_id, siteName: site.rows[0].name, supplier: sup.rows[0], note: o.note, expectedDate: o.expected_date,
    createdAt: o.created_at, sentAt: o.sent_at, lines: ls, total: Math.round(ls.reduce((t, l) => t + l.quantity * (l.unitPrice ?? 0), 0) * 100) / 100,
    message: orderMessage({ number: o.number, siteName: site.rows[0].name, expectedDate: o.expected_date, lines: ls }),
  };
}

export async function listOrders(db: Db, actor: Actor, siteId: string, status?: string) {
  await requireHotel(db, actor, siteId, [...ROLES]);
  const r = await db.query(
    `SELECT o.id, o.number, o.status, o.expected_date AS "expectedDate", o.created_at AS "createdAt", o.sent_at AS "sentAt", s.id AS supplier_id, s.name AS supplier_name,
            (SELECT count(*)::int FROM purchase_order_lines ol WHERE ol.order_id = o.id) AS items,
            (SELECT string_agg(p.name, ', ' ORDER BY p.name) FROM purchase_order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = o.id) AS names,
            (SELECT COALESCE(sum(ol.quantity * COALESCE(ol.unit_price, 0)), 0) FROM purchase_order_lines ol WHERE ol.order_id = o.id) AS total
       FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
      WHERE o.site_id = $1 AND ($2::text IS NULL OR o.status = ANY(string_to_array($2, ','))) ORDER BY o.created_at DESC LIMIT 100`, [siteId, status ?? null]);
  return r.rows.map((x) => ({ id: x.id, number: x.number, status: x.status, expectedDate: x.expectedDate, createdAt: x.createdAt, sentAt: x.sentAt, supplier: { id: x.supplier_id, name: x.supplier_name }, items: x.items, names: x.names, total: Number(x.total) }));
}

/** Marks the order as sent (the app then opens WhatsApp with the message). Ordering from a supplier links them to those categories. */
export async function sendOrder(db: Db, actor: Actor, id: string) {
  await withTx(db, async (tx) => {
    const o = await loadOrder(tx, actor, id, true);
    if (o.status === 'CANCELLED') throw err('INVALID_INPUT', 'This order was cancelled');
    if (o.status === 'DRAFT') {
      await tx.query(`UPDATE purchase_orders SET status = 'SENT', sent_at = now() WHERE id = $1`, [id]);
      await tx.query(
        `INSERT INTO supplier_categories (supplier_id, category_id)
         SELECT DISTINCT $2::uuid, p.category_id FROM purchase_order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = $1 AND p.category_id IS NOT NULL
         ON CONFLICT DO NOTHING`, [id, o.supplier_id]);
    }
  });
  return getOrder(db, actor, id);
}

export async function cancelOrder(db: Db, actor: Actor, id: string) {
  return withTx(db, async (tx) => {
    const o = await loadOrder(tx, actor, id, true);
    if (o.status === 'RECEIVED' || o.status === 'PARTIAL') throw err('INVALID_INPUT', 'Goods were already received on this order');
    await tx.query(`UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = $1`, [id]);
    return { id, status: 'CANCELLED' };
  });
}

/** What to order: items at or below their minimum, filled up to par, less what is already on order. Optionally only what one supplier sells. */
export async function suggestOrder(db: Db, actor: Actor, siteId: string, supplierId?: string) {
  await requireHotel(db, actor, siteId, [...ROLES]);
  const r = await db.query(
    `SELECT p.id AS "productId", p.name, p.unit, p.photo_url AS "photoUrl", p.last_price, s.reorder_threshold AS min, COALESCE(s.par_level, s.reorder_threshold * 2) AS par,
            COALESCE((SELECT b.quantity FROM stock_balances b JOIN stock_locations sl ON sl.id = b.location_id WHERE sl.hotel_id = $1 AND sl.type = 'HOTEL_STORE' AND b.product_id = p.id), 0) AS store,
            COALESCE((SELECT sum(ol.quantity)::int FROM purchase_orders o JOIN purchase_order_lines ol ON ol.order_id = o.id WHERE o.site_id = $1 AND o.status IN ('SENT','PARTIAL') AND ol.product_id = p.id), 0) AS on_order,
            (SELECT ol.quantity FROM purchase_orders o JOIN purchase_order_lines ol ON ol.order_id = o.id WHERE o.site_id = $1 AND o.status IN ('SENT','PARTIAL','RECEIVED') AND ol.product_id = p.id ORDER BY o.sent_at DESC LIMIT 1) AS last_qty
       FROM hotel_product_settings s JOIN products p ON p.id = s.product_id
      WHERE s.hotel_id = $1 AND p.active AND s.reorder_threshold > 0
        AND ($2::uuid IS NULL
             OR EXISTS (SELECT 1 FROM supplier_items si WHERE si.supplier_id = $2 AND si.product_id = p.id)
             OR EXISTS (SELECT 1 FROM supplier_categories sc WHERE sc.supplier_id = $2 AND sc.category_id = p.category_id AND sc.all_items)
             OR EXISTS (SELECT 1 FROM purchase_orders o JOIN purchase_order_lines ol ON ol.order_id = o.id WHERE o.supplier_id = $2 AND ol.product_id = p.id AND o.status <> 'CANCELLED'))
      ORDER BY p.name`, [siteId, supplierId ?? null]);
  return r.rows.filter((x) => x.store <= x.min).map((x) => ({
    productId: x.productId, name: x.name, unit: x.unit, photoUrl: x.photoUrl, store: x.store, min: x.min, par: x.par, onOrder: x.on_order, lastQuantity: x.last_qty,
    lastPrice: x.last_price == null ? null : Number(x.last_price), quantity: Math.max(0, x.par - x.store - x.on_order),
  })).filter((x) => x.quantity > 0);
}

export interface DeliveryLineIn { productId: string; received: number; rejected?: number; rejectReason?: string | null; unitPrice?: number | null; expiryDate?: string | null }

/**
 * Checks a delivery in. Received goods join the site's store through the ledger, each received line becomes a lot (with its use-by date
 * when the item has one), the item's last price is updated, and the order moves to PARTIAL or RECEIVED. Works without an order for direct buys.
 */
export async function receiveDelivery(db: Db, actor: Actor, b: { orderId?: string | null; siteId?: string; supplierId?: string; lines: DeliveryLineIn[]; billTotal?: number | null; note?: string | null; checkedBy?: 'COUNT' | 'BILL_PHOTO' }, idemKey: string) {
  const hash = hashRequest('delivery', b);
  return idempotent(db, actor, idemKey, hash, async (tx) => {
    let siteId = b.siteId, supplierId = b.supplierId;
    let ordered = new Map<string, { quantity: number; unit_price: string | null }>();
    if (b.orderId) {
      const o = await loadOrder(tx, actor, b.orderId, true);
      if (o.status === 'DRAFT') throw err('INVALID_INPUT', 'Send the order before checking its delivery');
      if (o.status === 'CANCELLED' || o.status === 'RECEIVED') throw err('INVALID_INPUT', `This order is already ${o.status.toLowerCase()}`);
      siteId = o.site_id; supplierId = o.supplier_id;
      ordered = new Map((await tx.query('SELECT product_id, quantity, unit_price FROM purchase_order_lines WHERE order_id = $1', [b.orderId])).rows.map((r) => [r.product_id, r]));
    }
    if (!siteId || !supplierId) throw err('INVALID_INPUT', 'Say which site and supplier this delivery is for');
    await requireHotel(tx, actor, siteId, [...ROLES]);
    const sup = await tx.query('SELECT 1 FROM suppliers WHERE id = $1 AND organization_id = $2', [supplierId, actor.orgId]);
    if (!sup.rowCount) throw err('NOT_FOUND', 'Supplier not found');
    const ids = b.lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw err('INVALID_INPUT', 'Each item can appear once');
    const prods = await tx.query('SELECT id, name, has_expiry, shelf_life_days FROM products WHERE organization_id = $1 AND active AND id = ANY($2::uuid[])', [actor.orgId, ids]);
    if (prods.rowCount !== ids.length) throw err('INVALID_ROOM_OR_PRODUCT', 'Unknown or inactive item');
    const pm = new Map(prods.rows.map((p) => [p.id, p]));
    for (const l of b.lines) {
      const p = pm.get(l.productId)!;
      if (l.received > 0 && p.has_expiry && !l.expiryDate) throw err('INVALID_INPUT', `${p.name} needs a use-by date`, { productId: l.productId, field: 'expiryDate' });
      if ((l.rejected ?? 0) > 0 && !l.rejectReason) throw err('INVALID_INPUT', `Say why ${p.name} was sent back`, { productId: l.productId, field: 'rejectReason' });
    }
    const got = b.lines.filter((l) => l.received > 0);
    let eventId: string | null = null;
    if (got.length) {
      const store = await storeLocation(tx, actor.orgId, siteId);
      const ev = await postEvent(tx, actor, { action: 'SUPPLIER_RECEIPT', hotelContextId: siteId, idempotencyKey: idemKey, requestHash: hash,
        movements: got.map((l) => ({ productId: l.productId, quantity: l.received, fromLocationId: null, toLocationId: store })), note: b.note ?? null });
      eventId = ev.eventId;
    }
    const d = await tx.query(
      `INSERT INTO deliveries (organization_id, order_id, site_id, supplier_id, received_by, event_id, bill_total, note, checked_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [actor.orgId, b.orderId ?? null, siteId, supplierId, actor.userId, eventId, b.billTotal ?? null, b.note ?? null, b.checkedBy ?? 'COUNT']);
    const deliveryId = d.rows[0].id as string;
    const flags: { productId: string; kind: 'PRICE_UP' | 'SHORT' | 'SENT_BACK'; detail: string }[] = [];
    let creditDue = 0;
    for (const l of b.lines) {
      const o = ordered.get(l.productId); const p = pm.get(l.productId)!;
      const price = l.unitPrice ?? (o?.unit_price == null ? null : Number(o.unit_price));
      await tx.query('INSERT INTO delivery_lines (delivery_id, product_id, ordered, received, rejected, reject_reason, unit_price, expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [deliveryId, l.productId, o?.quantity ?? null, l.received, l.rejected ?? 0, l.rejectReason ?? null, price, l.expiryDate ?? null]);
      if (l.received > 0) {
        await tx.query('INSERT INTO batches (organization_id, site_id, product_id, delivery_id, expiry_date, quantity_received, quantity_left) VALUES ($1,$2,$3,$4,$5,$6,$6)', [actor.orgId, siteId, l.productId, deliveryId, l.expiryDate ?? null, l.received]);
        if (price != null) await tx.query('UPDATE products SET last_price = $2 WHERE id = $1', [l.productId, price]);
        await tx.query('INSERT INTO supplier_items (supplier_id, product_id) SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM supplier_categories sc JOIN products p ON p.category_id = sc.category_id WHERE sc.supplier_id = $1 AND p.id = $2 AND NOT sc.all_items) ON CONFLICT DO NOTHING', [supplierId, l.productId]);
      }
      if (o?.unit_price != null && l.unitPrice != null && l.unitPrice > Number(o.unit_price) * 1.02) flags.push({ productId: l.productId, kind: 'PRICE_UP', detail: `${p.name} billed at ${l.unitPrice}, order said ${Number(o.unit_price)}` });
      if ((l.rejected ?? 0) > 0) { flags.push({ productId: l.productId, kind: 'SENT_BACK', detail: `${l.rejected} ${p.name} sent back: ${l.rejectReason}` }); creditDue += (l.rejected ?? 0) * (price ?? 0); }
      if (o && l.received + (l.rejected ?? 0) < o.quantity) flags.push({ productId: l.productId, kind: 'SHORT', detail: `${o.quantity - l.received - (l.rejected ?? 0)} ${p.name} still to come` });
    }
    let status: string | null = null;
    if (b.orderId) {
      const open = await tx.query(
        `SELECT count(*)::int AS n FROM purchase_order_lines ol WHERE ol.order_id = $1 AND ol.quantity >
           COALESCE((SELECT sum(dl.received + dl.rejected) FROM delivery_lines dl JOIN deliveries d ON d.id = dl.delivery_id WHERE d.order_id = ol.order_id AND dl.product_id = ol.product_id), 0)`, [b.orderId]);
      status = open.rows[0].n === 0 ? 'RECEIVED' : 'PARTIAL';
      await tx.query('UPDATE purchase_orders SET status = $2 WHERE id = $1', [b.orderId, status]);
    }
    return { status: 201, body: { deliveryId, eventId, orderStatus: status, flags, creditDue: Math.round(creditDue * 100) / 100 } };
  });
}

export async function addDeliveryPhoto(db: Db, actor: Actor, deliveryId: string, kind: 'BILL' | 'GOODS', data: Buffer, contentType: string) {
  const d = await db.query('SELECT site_id FROM deliveries WHERE id = $1 AND organization_id = $2', [deliveryId, actor.orgId]);
  if (!d.rowCount) throw err('NOT_FOUND', 'Delivery not found');
  await requireHotel(db, actor, d.rows[0].site_id, [...ROLES]);
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) throw err('INVALID_INPUT', 'Photos must be JPEG, PNG or WebP');
  const n = await db.query('SELECT count(*)::int AS n FROM delivery_photos WHERE delivery_id = $1', [deliveryId]);
  if (n.rows[0].n >= 6) throw err('INVALID_INPUT', 'A delivery can keep up to 6 photos');
  const r = await db.query('INSERT INTO delivery_photos (delivery_id, kind, content_type, data, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [deliveryId, kind, contentType, data, actor.userId]);
  return { id: r.rows[0].id as string, kind };
}

export async function getDeliveryPhoto(db: Db, actor: Actor, photoId: string) {
  const r = await db.query('SELECT ph.content_type, ph.data, d.site_id FROM delivery_photos ph JOIN deliveries d ON d.id = ph.delivery_id WHERE ph.id = $1 AND d.organization_id = $2', [photoId, actor.orgId]);
  if (!r.rowCount) throw err('NOT_FOUND', 'Photo not found');
  await requireHotel(db, actor, r.rows[0].site_id, [...ROLES]);
  return { contentType: r.rows[0].content_type as string, data: r.rows[0].data as Buffer };
}

/** The home feed for a site: deliveries to check, hotels asking, items running low, lots to use first. */
export async function siteHome(db: Db, actor: Actor, siteId: string) {
  await requireHotel(db, actor, siteId, [...ROLES]);
  const wh = await warehouseOf(db, actor.orgId);
  const [due, matrix, useFirst, asking] = await Promise.all([
    listOrders(db, actor, siteId, 'SENT,PARTIAL'),
    stockMatrix(db, actor.orgId, [siteId]),
    db.query(
      `SELECT p.id AS "productId", p.name, p.unit, p.photo_url AS "photoUrl", sum(bt.quantity_left)::int AS quantity, min(bt.expiry_date) AS by, (min(bt.expiry_date) - CURRENT_DATE) AS days
         FROM batches bt JOIN products p ON p.id = bt.product_id
        WHERE bt.site_id = $1 AND bt.quantity_left > 0 AND bt.expiry_date <= CURRENT_DATE + ${USE_FIRST_SQL} GROUP BY p.id ORDER BY by, p.name LIMIT 20`, [siteId]),
    wh && wh.id === siteId ? listRequests(db, actor, [siteId], 'OPEN') : Promise.resolve([]),
  ]);
  const drafts = await listOrders(db, actor, siteId, 'DRAFT');
  return {
    siteId, isWarehouse: !!wh && wh.id === siteId,
    deliveriesDue: due, drafts,
    asking,
    low: matrix.filter((m: any) => m.low).map((m: any) => ({ productId: m.productId, name: m.name, unit: m.unit, store: m.store, min: m.reorderThreshold })),
    useFirst: useFirst.rows,
  };
}

// ---------- order from a spoken or typed sentence ----------

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, pandrah: 15, bees: 20, pachees: 25, tees: 30,
  chalis: 40, chalees: 40, pachas: 50, pachaas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90, be: 2, tran: 3, pach: 5, vees: 20, trees: 30,
};
const MULT: Record<string, number> = { hundred: 100, sau: 100, so: 100, thousand: 1000, hazar: 1000, hajar: 1000, dozen: 12, darjan: 12 };
const UNIT_WORDS = new Set(['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'litre', 'litres', 'liter', 'liters', 'ltr', 'l', 'pcs', 'pc', 'piece', 'pieces', 'packet', 'packets', 'pack', 'packs', 'pac', 'box', 'boxes',
  'bottle', 'bottles', 'btl', 'bag', 'bags', 'gram', 'grams', 'g', 'gm', 'ml', 'dz', 'roll', 'rolls', 'nos', 'no', 'nag']);
const FILLER = new Set(['of', 'the', 'a', 'an', 'and', 'please', 'order', 'from', 'send', 'need', 'want', 'ka', 'ki', 'ke', 'ko', 'se', 'aur', 'chahiye', 'mangwao', 'mangao', 'bhejo', 'to', 'for', 'us', 'me', 'ane', 'joiye', 'no', 'ni', 'na']);

/** Splits "twenty kilo butter, 15 kg cheese and hundred kilo rice" into [{quantity, phrase}]. */
export function splitSpokenOrder(text: string): { quantity: number | null; phrase: string }[] {
  const toks = normalizeDigits(text.toLowerCase()).replace(/[.;،]/g, ',').replace(/[^\p{L}\p{M}\p{N}, ]/gu, ' ').split(/\s+|(?=,)|(?<=,)/).filter(Boolean);
  const out: { quantity: number | null; phrase: string }[] = [];
  let qty: number | null = null, words: string[] = [];
  const flush = () => { if (words.length) out.push({ quantity: qty, phrase: words.join(' ') }); qty = null; words = []; };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === ',') { flush(); continue; }
    let n: number | null = /^\d+$/.test(t) ? Number(t) : t in WORDS ? WORDS[t] : null;
    const isMult = t in MULT;
    if (n !== null || isMult) {
      // A number starts a new item when the current one already has a quantity and a name.
      if (qty !== null && words.length) flush();
      let v = n ?? 1; let j = i + 1;
      if (isMult) v = MULT[t];
      // "one hundred fifty", "do sau", "twenty five"
      while (j < toks.length) {
        const u = toks[j];
        if (u in MULT) { v *= MULT[u]; j++; } else if (u in WORDS && WORDS[u] < 100 && (v % 100 === 0 || (v % 10 === 0 && WORDS[u] < 10))) { v += WORDS[u]; j++; } else if (/^\d+$/.test(u) && v % 100 === 0 && v >= 100 && Number(u) < 100) { v += Number(u); j++; } else break;
      }
      qty = qty === null ? v : qty; i = j - 1; continue;
    }
    if (UNIT_WORDS.has(t) || FILLER.has(t)) continue;
    words.push(t);
  }
  flush();
  return out;
}

/** Turns a spoken or typed order into a draft the user can discard, edit or confirm. Nothing is saved here. */
export async function draftOrderFromText(db: Db, actor: Actor, b: { siteId: string; text: string; supplierId?: string | null }) {
  await requireHotel(db, actor, b.siteId, [...ROLES]);
  const text = b.text.slice(0, 1000);
  const lower = ' ' + normalizeDigits(text.toLowerCase()) + ' ';
  const sups = (await db.query('SELECT id, name, phone FROM suppliers WHERE organization_id = $1 AND active ORDER BY length(name) DESC', [actor.orgId])).rows;
  let supplier = b.supplierId ? sups.find((s) => s.id === b.supplierId) : undefined;
  let rest = text;
  if (!supplier) for (const s of sups) {
    const nm = s.name.toLowerCase();
    const first = nm.split(/\s+/).filter((w: string) => w.length > 2);
    if (lower.includes(' ' + nm + ' ') || lower.includes(' ' + nm + ',') || lower.includes(' ' + nm + '.')) { supplier = s; rest = text.replace(new RegExp(s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ','); break; }
    if (first.length >= 2 && first.every((w: string) => lower.includes(' ' + w))) { supplier = s; rest = first.reduce((acc: string, w: string) => acc.replace(new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), ''), text); break; }
  }
  const lines = await matchItems(db, actor, b.siteId, supplier?.id ?? null, splitSpokenOrder(rest));
  return draftOf(text, supplier, lines);
}

/** Finds the catalog item for each phrase. `loose` (for names read off paper, which carry extra words) falls back to the first two words. */
export async function matchItems(db: Db, actor: Actor, siteId: string, supplierId: string | null, parts: { quantity: number | null; phrase: string }[], loose = false) {
  const lines: any[] = [];
  for (const part of parts) {
    const words = part.phrase.split(' ').filter((w) => w.length > 1).slice(0, 6);
    if (!words.length) continue;
    const find = (ws: string[]) => db.query(
      `SELECT p.id, p.name, p.unit, p.photo_url AS "photoUrl", p.last_price,
              (SELECT count(*)::int FROM purchase_orders o JOIN purchase_order_lines ol ON ol.order_id = o.id WHERE ol.product_id = p.id AND o.status <> 'CANCELLED' AND ($4::uuid IS NULL OR o.supplier_id = $4)) AS times,
              EXISTS (SELECT 1 FROM stock_balances sb JOIN stock_locations sl ON sl.id = sb.location_id WHERE sl.hotel_id = $3 AND sb.product_id = p.id) AS stocked
         FROM products p
        WHERE p.organization_id = $1 AND p.active
          AND (SELECT bool_and(lower(p.name) LIKE w OR EXISTS (SELECT 1 FROM product_aliases a WHERE a.product_id = p.id AND lower(a.alias) LIKE w)) FROM unnest($2::text[]) AS w)
        ORDER BY (lower(p.name) = $5) DESC, times DESC, stocked DESC, length(p.name), p.name LIMIT 4`, [actor.orgId, ws.map((w) => `%${w.replace(/(es|s)$/, '')}%`), siteId, supplierId, part.phrase]);
    let r = await find(words);
    const fuzzy = loose && !r.rowCount && words.length > 2;
    if (fuzzy) r = await find(words.slice(0, 2));
    const c = r.rows.map((x) => ({ productId: x.id, name: x.name, unit: x.unit, photoUrl: x.photoUrl, lastPrice: x.last_price == null ? null : Number(x.last_price), times: x.times }));
    lines.push({ heard: part.phrase, quantity: part.quantity, match: c[0] ?? null, alternatives: c.slice(1), unsure: fuzzy || c.length !== 1 || part.quantity == null });
  }
  return lines;
}

export function draftOf(text: string, supplier: { id: string; name: string } | null | undefined, lines: any[]) {
  const ok = lines.filter((l) => l.match && l.quantity);
  return {
    text, supplier: supplier ? { id: supplier.id, name: supplier.name } : null, lines,
    total: Math.round(ok.reduce((t, l) => t + l.quantity * (l.match.lastPrice ?? 0), 0) * 100) / 100,
    ready: !!supplier && ok.length > 0 && ok.length === lines.length,
  };
}
