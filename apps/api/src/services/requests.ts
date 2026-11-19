import type { Db, Tx } from '../db/pool.ts';
import { err } from '../errors.ts';
import { requireHotel, type Actor } from './actor.ts';
import { dispatchTransfer } from './transfers.ts';

/** The organisation's warehouse site, if one is set up. */
export async function warehouseOf(db: Db | Tx, orgId: string) {
  const r = await db.query(`SELECT id, name FROM hotels WHERE organization_id = $1 AND kind = 'WAREHOUSE' AND active LIMIT 1`, [orgId]);
  return r.rows[0] as { id: string; name: string } | undefined;
}

function merge(lines: { productId: string; quantity: number }[]) {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity);
  return [...m.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

/** A hotel asks the warehouse for stock. Nothing moves until the warehouse sends. */
export async function createRequest(db: Db, actor: Actor, body: { hotelId: string; lines: { productId: string; quantity: number }[]; note?: string | null }) {
  await requireHotel(db, actor, body.hotelId);
  const wh = await warehouseOf(db, actor.orgId);
  if (!wh) throw err('INVALID_INPUT', 'No warehouse is set up for this organisation');
  if (wh.id === body.hotelId) throw err('INVALID_INPUT', 'The warehouse cannot ask itself');
  const lines = merge(body.lines);
  if (!lines.length) throw err('INVALID_INPUT', 'Nothing to request');
  const prod = await db.query('SELECT id FROM products WHERE organization_id = $1 AND active AND id = ANY($2::uuid[])', [actor.orgId, lines.map((l) => l.productId)]);
  if (prod.rowCount !== lines.length) throw err('INVALID_ROOM_OR_PRODUCT', 'Unknown or inactive product');
  const r = await db.query(
    `INSERT INTO stock_requests (organization_id, hotel_id, warehouse_id, requested_by, note) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
    [actor.orgId, body.hotelId, wh.id, actor.userId, body.note ?? null]);
  for (const l of lines) await db.query('INSERT INTO stock_request_lines (request_id, product_id, quantity) VALUES ($1,$2,$3)', [r.rows[0].id, l.productId, l.quantity]);
  return { status: 201, body: { requestId: r.rows[0].id, status: 'OPEN', createdAt: r.rows[0].created_at } };
}

/** Requests visible to the actor: a hotel sees its own; the warehouse sees every hotel's. */
export async function listRequests(db: Db, actor: Actor, hotelIds: string[], status?: string) {
  const r = await db.query(
    `SELECT r.id, r.status, r.note, r.created_at, r.decided_at, r.transfer_id, r.hotel_id, h.name AS hotel_name, r.warehouse_id, w.name AS warehouse_name,
            u.display_name AS requested_by, t.ref_code AS transfer_ref,
            json_agg(json_build_object('productId', p.id, 'name', p.name, 'unit', p.unit, 'quantity', l.quantity,
              'warehouseStock', COALESCE((SELECT b.quantity FROM stock_balances b JOIN stock_locations sl ON sl.id = b.location_id
                                           WHERE sl.hotel_id = r.warehouse_id AND sl.type = 'HOTEL_STORE' AND b.product_id = p.id), 0)) ORDER BY p.name) AS lines
       FROM stock_requests r
       JOIN hotels h ON h.id = r.hotel_id JOIN hotels w ON w.id = r.warehouse_id JOIN users u ON u.id = r.requested_by
       LEFT JOIN transfers t ON t.id = r.transfer_id
       JOIN stock_request_lines l ON l.request_id = r.id JOIN products p ON p.id = l.product_id
      WHERE r.organization_id = $1 AND (r.hotel_id = ANY($2::uuid[]) OR r.warehouse_id = ANY($2::uuid[]))
        AND ($3::text IS NULL OR r.status = $3)
      GROUP BY r.id, h.name, w.name, u.display_name, t.ref_code
      ORDER BY r.created_at DESC LIMIT 200`,
    [actor.orgId, hotelIds, status ?? null]);
  const now = Date.now();
  return r.rows.map((x) => ({
    id: x.id, status: x.status, note: x.note, createdAt: x.created_at, decidedAt: x.decided_at, transferId: x.transfer_id, transferRef: x.transfer_ref,
    hotel: { id: x.hotel_id, name: x.hotel_name }, warehouse: { id: x.warehouse_id, name: x.warehouse_name }, requestedBy: x.requested_by,
    lines: x.lines, ageHours: Math.round(((now - new Date(x.created_at).getTime()) / 3_600_000) * 10) / 10,
  }));
}

/** The warehouse sends: a normal transfer is created (so receiving and short deliveries work unchanged) and the request is marked SENT. */
export async function dispatchRequest(db: Db, actor: Actor, requestId: string, body: { lines?: { productId: string; quantity: number }[]; note?: string | null }, idemKey: string) {
  const r = await db.query('SELECT * FROM stock_requests WHERE id = $1 AND organization_id = $2', [requestId, actor.orgId]);
  const req = r.rows[0];
  if (!req) throw err('NOT_FOUND', 'Request not found');
  await requireHotel(db, actor, req.warehouse_id);
  if (req.status !== 'OPEN') throw err('INVALID_INPUT', `Request is already ${req.status.toLowerCase()}`);
  const asked = (await db.query('SELECT product_id, quantity FROM stock_request_lines WHERE request_id = $1', [requestId])).rows;
  const lines = merge((body.lines?.length ? body.lines : asked.map((l) => ({ productId: l.product_id, quantity: l.quantity }))).filter((l) => l.quantity > 0));
  if (!lines.length) throw err('INVALID_INPUT', 'Nothing to send');
  const out = await dispatchTransfer(db, actor, { fromHotelId: req.warehouse_id, toHotelId: req.hotel_id, lines, note: body.note ?? req.note ?? null } as any, idemKey);
  if (out.status === 201 || out.status === 200) {
    await db.query(`UPDATE stock_requests SET status = 'SENT', transfer_id = $2, decided_by = $3, decided_at = now() WHERE id = $1 AND status = 'OPEN'`, [requestId, (out.body as any).transferId, actor.userId]);
  }
  return out;
}

export async function declineRequest(db: Db, actor: Actor, requestId: string, note?: string | null) {
  const r = await db.query('SELECT * FROM stock_requests WHERE id = $1 AND organization_id = $2', [requestId, actor.orgId]);
  const req = r.rows[0];
  if (!req) throw err('NOT_FOUND', 'Request not found');
  const byHotel = req.hotel_id && (await requireHotel(db, actor, req.hotel_id).then(() => true, () => false));
  const byWarehouse = await requireHotel(db, actor, req.warehouse_id).then(() => true, () => false);
  if (!byHotel && !byWarehouse) throw err('FORBIDDEN', 'Not your request');
  if (req.status !== 'OPEN') throw err('INVALID_INPUT', `Request is already ${req.status.toLowerCase()}`);
  const status = byWarehouse && !byHotel ? 'DECLINED' : 'CANCELLED';
  await db.query(`UPDATE stock_requests SET status = $2, decided_by = $3, decided_at = now(), note = COALESCE($4, note) WHERE id = $1`, [requestId, status, actor.userId, note ?? null]);
  return { id: requestId, status };
}

/** Called when a transfer is fully received: the request it came from is done. */
export async function closeRequestForTransfer(tx: Tx, transferId: string) {
  await tx.query(`UPDATE stock_requests SET status = 'RECEIVED' WHERE transfer_id = $1 AND status = 'SENT'`, [transferId]);
}

// ---------- auto-request schedules ----------

export async function listSchedules(db: Db, actor: Actor, hotelIds: string[]) {
  const r = await db.query(
    `SELECT s.id, s.hotel_id, h.name AS hotel_name, s.weekday, s.hour, s.active, s.last_run_at, s.last_request_id
       FROM request_schedules s JOIN hotels h ON h.id = s.hotel_id
      WHERE s.organization_id = $1 AND s.hotel_id = ANY($2::uuid[]) ORDER BY h.name, s.weekday, s.hour`, [actor.orgId, hotelIds]);
  return r.rows.map((x) => ({ id: x.id, hotel: { id: x.hotel_id, name: x.hotel_name }, weekday: x.weekday, hour: x.hour, active: x.active, lastRunAt: x.last_run_at, lastRequestId: x.last_request_id }));
}

export async function upsertSchedule(db: Db, actor: Actor, body: { hotelId: string; weekday: number; hour: number; active?: boolean }) {
  await requireHotel(db, actor, body.hotelId);
  const wh = await warehouseOf(db, actor.orgId);
  if (!wh || wh.id === body.hotelId) throw err('INVALID_INPUT', 'Schedules are for hotels asking the warehouse');
  const r = await db.query(
    `INSERT INTO request_schedules (organization_id, hotel_id, weekday, hour, active, created_by) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (hotel_id, weekday, hour) DO UPDATE SET active = EXCLUDED.active RETURNING id`,
    [actor.orgId, body.hotelId, body.weekday, body.hour, body.active ?? true, actor.userId]);
  return { id: r.rows[0].id };
}

export async function deleteSchedule(db: Db, actor: Actor, id: string) {
  const r = await db.query('SELECT hotel_id FROM request_schedules WHERE id = $1 AND organization_id = $2', [id, actor.orgId]);
  if (!r.rowCount) throw err('NOT_FOUND', 'Schedule not found');
  await requireHotel(db, actor, r.rows[0].hotel_id);
  await db.query('DELETE FROM request_schedules WHERE id = $1', [id]);
  return { ok: true };
}

/** What a hotel would ask for right now to get back to par: par − store − on the way − already requested, per product. */
export async function topUpLines(db: Db | Tx, orgId: string, hotelId: string, warehouseId: string) {
  const r = await db.query(
    `SELECT p.id AS product_id, p.name,
            COALESCE(hps.par_level, COALESCE(hps.reorder_threshold, 0) * 2) AS par,
            COALESCE((SELECT b.quantity FROM stock_balances b JOIN stock_locations sl ON sl.id = b.location_id WHERE sl.hotel_id = $2 AND sl.type='HOTEL_STORE' AND b.product_id = p.id), 0) AS store,
            COALESCE((SELECT sum(tl.sent_qty - tl.received_qty - tl.resolved_short_qty) FROM transfers t JOIN transfer_lines tl ON tl.transfer_id = t.id
                       WHERE t.to_hotel_id = $2 AND t.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED') AND tl.product_id = p.id), 0) AS on_the_way,
            COALESCE((SELECT sum(l.quantity) FROM stock_requests r JOIN stock_request_lines l ON l.request_id = r.id
                       WHERE r.hotel_id = $2 AND r.status = 'OPEN' AND l.product_id = p.id), 0) AS requested,
            COALESCE((SELECT b.quantity FROM stock_balances b JOIN stock_locations sl ON sl.id = b.location_id WHERE sl.hotel_id = $3 AND sl.type='HOTEL_STORE' AND b.product_id = p.id), 0) AS warehouse
       FROM products p LEFT JOIN hotel_product_settings hps ON hps.product_id = p.id AND hps.hotel_id = $2
      WHERE p.organization_id = $1 AND p.active AND (p.room_item OR EXISTS (SELECT 1 FROM stock_balances b0 JOIN stock_locations l0 ON l0.id = b0.location_id WHERE l0.hotel_id = $2 AND b0.product_id = p.id) OR EXISTS (SELECT 1 FROM hotel_product_settings s0 WHERE s0.hotel_id = $2 AND s0.product_id = p.id)) ORDER BY p.name`, [orgId, hotelId, warehouseId]);
  return r.rows.map((x) => ({ productId: x.product_id, name: x.name, par: Number(x.par), store: Number(x.store), onTheWay: Number(x.on_the_way), requested: Number(x.requested), warehouse: Number(x.warehouse),
    quantity: Math.max(0, Number(x.par) - Number(x.store) - Number(x.on_the_way) - Number(x.requested)) }));
}

/** Runs every due schedule once: creates the top-up request as the schedule's creator. Safe to call often (a schedule runs at most once per slot). */
export async function runDueSchedules(db: Db, now = new Date()) {
  const due = await db.query(
    `SELECT s.*, h.timezone FROM request_schedules s JOIN hotels h ON h.id = s.hotel_id WHERE s.active AND h.active`);
  const ran: string[] = [];
  for (const s of due.rows) {
    // Local time at the hotel.
    const local = new Date(now.toLocaleString('en-US', { timeZone: s.timezone || 'Asia/Kolkata' }));
    if (local.getDay() !== s.weekday || local.getHours() < s.hour) continue;
    // The slot this week, in UTC terms: skip if already run since then.
    const slotLocal = new Date(local); slotLocal.setHours(s.hour, 0, 0, 0);
    const msSinceSlot = local.getTime() - slotLocal.getTime();
    const slotUtc = new Date(now.getTime() - msSinceSlot);
    if (s.last_run_at && new Date(s.last_run_at) >= slotUtc) continue;
    const wh = await warehouseOf(db, s.organization_id);
    if (!wh) continue;
    const lines = (await topUpLines(db, s.organization_id, s.hotel_id, wh.id)).filter((l) => l.quantity > 0).map((l) => ({ productId: l.productId, quantity: l.quantity }));
    let requestId: string | null = null;
    if (lines.length) {
      const r = await db.query(
        `INSERT INTO stock_requests (organization_id, hotel_id, warehouse_id, requested_by, note) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [s.organization_id, s.hotel_id, wh.id, s.created_by, 'Scheduled top-up to par']);
      requestId = r.rows[0].id;
      for (const l of lines) await db.query('INSERT INTO stock_request_lines (request_id, product_id, quantity) VALUES ($1,$2,$3)', [requestId, l.productId, l.quantity]);
    }
    await db.query('UPDATE request_schedules SET last_run_at = $2, last_request_id = COALESCE($3, last_request_id) WHERE id = $1', [s.id, now, requestId]);
    ran.push(s.id);
  }
  return { ran: ran.length };
}
