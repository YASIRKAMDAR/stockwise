import type { Db } from '../db/pool.ts';
import type { Actor } from './actor.ts';
import { listTransfers } from './transfers.ts';
import { listRequests, warehouseOf } from './requests.ts';

/** Store / staff-held / in-transit balances per hotel × product. These are STOCK (balances). */
export async function stockMatrix(db: Db, orgId: string, hotelIds: string[]) {
  const r = await db.query(
    `WITH hp AS (
       SELECT h.id AS hotel_id, h.name AS hotel_name, h.code AS hotel_code, p.id AS product_id, p.name, p.sku, p.unit, p.icon
         FROM hotels h CROSS JOIN products p
        WHERE h.organization_id = $1 AND h.id = ANY($2::uuid[]) AND p.organization_id = $1 AND p.active)
     SELECT hp.*,
       COALESCE((SELECT b.quantity FROM stock_balances b JOIN stock_locations sl ON sl.id=b.location_id
                  WHERE sl.type='HOTEL_STORE' AND sl.hotel_id=hp.hotel_id AND b.product_id=hp.product_id), 0) AS store,
       COALESCE((SELECT sum(b.quantity) FROM stock_balances b JOIN stock_locations sl ON sl.id=b.location_id
                  WHERE sl.type='STAFF_BAG' AND sl.hotel_id=hp.hotel_id AND b.product_id=hp.product_id), 0) AS staff_held,
       COALESCE((SELECT sum(b.quantity) FROM stock_balances b JOIN stock_locations sl ON sl.id=b.location_id JOIN transfers t ON t.id=sl.transfer_id
                  WHERE sl.type='TRANSFER_IN_TRANSIT' AND t.from_hotel_id=hp.hotel_id AND b.product_id=hp.product_id), 0) AS transit_out,
       COALESCE((SELECT sum(b.quantity) FROM stock_balances b JOIN stock_locations sl ON sl.id=b.location_id JOIN transfers t ON t.id=sl.transfer_id
                  WHERE sl.type='TRANSFER_IN_TRANSIT' AND t.to_hotel_id=hp.hotel_id AND b.product_id=hp.product_id), 0) AS transit_in,
       COALESCE(s.reorder_threshold, 0) AS reorder_threshold, COALESCE(s.suggested_reorder_qty, 0) AS suggested_reorder_qty
     FROM hp LEFT JOIN hotel_product_settings s ON s.hotel_id = hp.hotel_id AND s.product_id = hp.product_id
     ORDER BY hp.hotel_code, hp.name`,
    [orgId, hotelIds],
  );
  return r.rows.map((x) => ({
    hotelId: x.hotel_id, hotelName: x.hotel_name, hotelCode: x.hotel_code, productId: x.product_id, name: x.name, sku: x.sku, unit: x.unit, icon: x.icon,
    store: x.store, staffHeld: x.staff_held, inTransitOut: x.transit_out, inTransitIn: x.transit_in,
    reorderThreshold: x.reorder_threshold, suggestedReorderQty: x.suggested_reorder_qty,
    low: x.reorder_threshold > 0 && x.store < x.reorder_threshold, out: x.store === 0,
  }));
}

/** Count verification status per hotel using its configured week start & timezone. */
export async function countStatus(db: Db, orgId: string, hotelIds: string[]) {
  const r = await db.query(
    `WITH h AS (
       SELECT id, name, code, timezone, count_week_start,
              ((date_trunc('day', now() AT TIME ZONE timezone)
                 - (((extract(dow FROM now() AT TIME ZONE timezone)::int - count_week_start + 7) % 7) * interval '1 day'))
                AT TIME ZONE timezone) AS week_start
         FROM hotels WHERE organization_id = $1 AND id = ANY($2::uuid[]))
     SELECT h.id, h.name, h.code, h.week_start,
            (SELECT max(submitted_at) FROM stock_counts c WHERE c.hotel_id = h.id AND c.status = 'SUBMITTED') AS last_submitted,
            (SELECT id FROM stock_counts c WHERE c.hotel_id = h.id AND c.status = 'DRAFT') AS draft_id
       FROM h ORDER BY h.code`,
    [orgId, hotelIds],
  );
  return r.rows.map((x) => {
    const ws = new Date(x.week_start).getTime();
    const last = x.last_submitted ? new Date(x.last_submitted).getTime() : null;
    const state = last && last >= ws ? 'COMPLETED' : last && last >= ws - 7 * 86_400_000 ? 'DUE' : 'OVERDUE';
    return { hotelId: x.id, hotelName: x.name, hotelCode: x.code, weekStart: x.week_start, lastSubmittedAt: x.last_submitted, draftCountId: x.draft_id, state };
  });
}

const NOT_REVERSED = `NOT EXISTS (SELECT 1 FROM inventory_events r WHERE r.reversal_of_event_id = e.id)`;

/** Room placements are a FLOW: "amenities placed in rooms", never guest consumption. */
export async function placementsTotal(db: Db, orgId: string, hotelIds: string[], from: Date, to: Date) {
  const r = await db.query(
    `SELECT e.hotel_context_id AS hotel_id, COALESCE(sum(l.quantity), 0) AS units
       FROM inventory_events e JOIN inventory_event_lines l ON l.event_id = e.id
      WHERE e.organization_id = $1 AND e.action = 'PLACE_IN_ROOM' AND e.hotel_context_id = ANY($2::uuid[])
        AND e.created_at >= $3 AND e.created_at < $4 AND ${NOT_REVERSED}
      GROUP BY e.hotel_context_id`,
    [orgId, hotelIds, from, to],
  );
  return new Map(r.rows.map((x) => [x.hotel_id as string, Number(x.units)]));
}

export async function overview(db: Db, orgId: string, hotelIds: string[], periodDays: number, scopeAll: boolean) {
  const to = new Date();
  const from = new Date(to.getTime() - periodDays * 86_400_000);
  const [matrix, counts, placed, hotels] = await Promise.all([
    stockMatrix(db, orgId, hotelIds),
    countStatus(db, orgId, hotelIds),
    placementsTotal(db, orgId, hotelIds, from, to),
    db.query('SELECT id, name, code FROM hotels WHERE id = ANY($1::uuid[]) ORDER BY code', [hotelIds]),
  ]);
  const per = hotels.rows.map((h) => {
    const rows = matrix.filter((m) => m.hotelId === h.id);
    return {
      hotelId: h.id, name: h.name, code: h.code,
      storeAvailableUnits: rows.reduce((s, m) => s + m.store, 0),
      staffHeldUnits: rows.reduce((s, m) => s + m.staffHeld, 0),
      inTransitOutUnits: rows.reduce((s, m) => s + m.inTransitOut, 0),
      placedInRoomsUnits: placed.get(h.id) ?? 0,
      lowStockCount: rows.filter((m) => m.low).length,
      countState: counts.find((c) => c.hotelId === h.id)?.state,
      lastCountAt: counts.find((c) => c.hotelId === h.id)?.lastSubmittedAt ?? null,
    };
  });
  return {
    asOf: to.toISOString(),
    scope: scopeAll ? 'ALL_HOTELS' : 'HOTEL',
    windowDays: periodDays,
    windowFrom: from.toISOString(),
    storeAvailableUnits: per.reduce((s, h) => s + h.storeAvailableUnits, 0),
    staffHeldUnits: per.reduce((s, h) => s + h.staffHeldUnits, 0),
    // Each transit location belongs to its sending hotel, so summing "out" never double counts.
    inTransitUnits: per.reduce((s, h) => s + h.inTransitOutUnits, 0),
    placedInRoomsUnits: per.reduce((s, h) => s + h.placedInRoomsUnits, 0),
    lowStockCount: per.reduce((s, h) => s + h.lowStockCount, 0),
    overdueCountHotels: per.filter((h) => h.countState === 'OVERDUE').length,
    hotels: per,
  };
}

export async function roomPlacements(db: Db, orgId: string, hotelIds: string[], from: Date, to: Date, roomId?: string, productId?: string) {
  const params = [orgId, hotelIds, from, to, roomId ?? null, productId ?? null];
  const base = `FROM inventory_events e JOIN inventory_event_lines l ON l.event_id = e.id JOIN hotels h ON h.id = e.hotel_context_id
     WHERE e.organization_id = $1 AND e.action = 'PLACE_IN_ROOM' AND e.hotel_context_id = ANY($2::uuid[])
       AND e.created_at >= $3 AND e.created_at < $4 AND ($5::uuid IS NULL OR l.room_id = $5) AND ($6::uuid IS NULL OR l.product_id = $6) AND ${NOT_REVERSED}`;
  const [rooms, products, series, total] = await Promise.all([
    db.query(`SELECT l.room_id, r.room_number, h.name AS hotel_name, h.id AS hotel_id, sum(l.quantity)::int AS units ${base.replace('JOIN hotels h', 'JOIN rooms r ON r.id = l.room_id JOIN hotels h')}
              GROUP BY l.room_id, r.room_number, h.name, h.id ORDER BY units DESC, r.room_number LIMIT 25`, params),
    db.query(`SELECT l.product_id, p.name, p.unit, sum(l.quantity)::int AS units ${base.replace('JOIN hotels h', 'JOIN products p ON p.id = l.product_id JOIN hotels h')}
              GROUP BY l.product_id, p.name, p.unit ORDER BY units DESC`, params),
    db.query(`SELECT to_char((e.created_at AT TIME ZONE h.timezone)::date, 'YYYY-MM-DD') AS day, h.id AS hotel_id, h.name AS hotel_name, sum(l.quantity)::int AS units ${base}
              GROUP BY 1, h.id, h.name ORDER BY 1`, params),
    db.query(`SELECT COALESCE(sum(l.quantity), 0)::int AS units, count(DISTINCT e.id)::int AS events ${base}`, params),
  ]);
  return {
    metric: 'AMENITIES_PLACED_IN_ROOMS',
    from: from.toISOString(), to: to.toISOString(),
    totalUnits: total.rows[0].units, placementEvents: total.rows[0].events,
    rooms: rooms.rows.map((x) => ({ roomId: x.room_id, roomNumber: x.room_number, hotelId: x.hotel_id, hotelName: x.hotel_name, units: x.units })),
    products: products.rows.map((x) => ({ productId: x.product_id, name: x.name, unit: x.unit, units: x.units })),
    series: series.rows.map((x) => ({ day: x.day, hotelId: x.hotel_id, hotelName: x.hotel_name, units: x.units })),
  };
}

export async function alerts(db: Db, actor: Actor, hotelIds: string[]) {
  const wh = await warehouseOf(db, actor.orgId);
  const whStock = wh ? await stockMatrix(db, actor.orgId, [wh.id]) : [];
  const openRequests = wh ? await listRequests(db, actor, hotelIds, 'OPEN').catch(() => []) : [];
  const [matrix, counts, transfers, variances, corrections, voice] = await Promise.all([
    stockMatrix(db, actor.orgId, hotelIds),
    countStatus(db, actor.orgId, hotelIds),
    listTransfers(db, actor, hotelIds, 'OPEN'),
    db.query(
      `SELECT c.id, c.hotel_id, h.name, c.submitted_at, sum(abs(l.physical_qty - l.expected_qty))::int AS abs_var, sum(l.expected_qty)::int AS expected
         FROM stock_counts c JOIN hotels h ON h.id = c.hotel_id JOIN stock_count_lines l ON l.count_id = c.id
        WHERE c.hotel_id = ANY($1::uuid[]) AND c.status='SUBMITTED' AND c.submitted_at > now() - interval '14 days'
        GROUP BY c.id, h.name`, [hotelIds]),
    db.query(`SELECT cr.id, cr.hotel_id, cr.note, cr.created_at, u.display_name FROM correction_requests cr JOIN users u ON u.id = cr.requested_by
               WHERE cr.hotel_id = ANY($1::uuid[]) AND cr.status = 'OPEN' ORDER BY cr.created_at`, [hotelIds]),
    db.query(`SELECT hotel_id, count(*)::int AS failed FROM voice_parse_attempts WHERE hotel_id = ANY($1::uuid[]) AND status='FAILED' AND created_at > now() - interval '24 hours' GROUP BY hotel_id`, [hotelIds]),
  ]);
  type Alert = { id: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; category: string; hotelId: string; title: string; detail: string; createdAt?: string };
  const out: Alert[] = [];
  for (const m of matrix.filter((m) => m.low)) {
    const atWarehouse = wh && m.hotelId !== wh.id ? whStock.find((w) => w.productId === m.productId)?.store : undefined;
    const alreadyAsked = openRequests.some((r) => r.hotel.id === m.hotelId && r.lines.some((l: any) => l.productId === m.productId));
    out.push({ id: `low:${m.hotelId}:${m.productId}`, severity: m.store === 0 ? 'HIGH' : 'MEDIUM', category: alreadyAsked ? 'LOW_STOCK_REQUESTED' : atWarehouse != null ? 'LOW_STOCK_ASK_WAREHOUSE' : 'LOW_STOCK', hotelId: m.hotelId,
      title: `${m.name} ${m.store === 0 ? 'out of stock' : 'low'} at ${m.hotelName}`,
      detail: `Store ${m.store} ${m.unit}, reorder at ${m.reorderThreshold}` + (atWarehouse != null ? ` · warehouse has ${atWarehouse}` : '') + (alreadyAsked ? ' · request sent' : '') });
  }
  if (wh && hotelIds.includes(wh.id))
    for (const r of openRequests)
      out.push({ id: `req:${r.id}`, severity: r.lines.some((l: any) => l.warehouseStock < l.quantity) ? 'MEDIUM' : 'LOW', category: 'STOCK_REQUEST', hotelId: wh.id,
        title: `${r.hotel.name} asks for ${r.lines.map((l: any) => `${l.quantity} ${l.name}`).join(', ')}`, detail: `Asked ${Math.round(r.ageHours)}h ago by ${r.requestedBy}`, createdAt: r.createdAt });
  for (const t of transfers.filter((t) => t.aged || t.status === 'DISCREPANCY'))
    out.push({ id: `tr:${t.id}`, severity: t.status === 'DISCREPANCY' ? 'HIGH' : 'MEDIUM', category: t.status === 'DISCREPANCY' ? 'TRANSFER_DISCREPANCY' : 'TRANSFER_AGED',
      hotelId: t.toHotel.id, title: `Transfer ${t.refCode} ${t.fromHotel.name} → ${t.toHotel.name}`, detail: `${t.outstandingUnits} units not received after ${Math.round(t.ageHours)}h`, createdAt: t.dispatchedAt });
  for (const c of counts.filter((c) => c.state === 'OVERDUE'))
    out.push({ id: `count:${c.hotelId}`, severity: 'MEDIUM', category: 'COUNT_OVERDUE', hotelId: c.hotelId, title: `Weekly count overdue at ${c.hotelName}`,
      detail: c.lastSubmittedAt ? `Last verified ${new Date(c.lastSubmittedAt).toISOString().slice(0, 10)}` : 'Never verified' });
  for (const v of variances.rows.filter((v) => v.abs_var >= Math.max(10, 0.05 * v.expected)))
    out.push({ id: `var:${v.id}`, severity: 'MEDIUM', category: 'LARGE_VARIANCE', hotelId: v.hotel_id, title: `Large count variance at ${v.name}`,
      detail: `${v.abs_var} units differed from system (of ${v.expected})`, createdAt: v.submitted_at });
  for (const c of corrections.rows)
    out.push({ id: `corr:${c.id}`, severity: 'LOW', category: 'CORRECTION_REQUEST', hotelId: c.hotel_id, title: `Correction requested by ${c.display_name}`, detail: c.note, createdAt: c.created_at });
  for (const v of voice.rows.filter((v) => v.failed >= 5))
    out.push({ id: `voice:${v.hotel_id}`, severity: 'LOW', category: 'VOICE_FAILURES', hotelId: v.hotel_id, title: 'Repeated voice failures', detail: `${v.failed} failed voice attempts in 24h` });
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface ActivityFilter { hotelIds: string[]; actorUserId?: string; action?: string; roomId?: string; productId?: string; from?: string; to?: string; cursor?: string; limit: number }

export async function activity(db: Db, orgId: string, f: ActivityFilter) {
  let cur: { t: string; id: string } | null = null;
  if (f.cursor) { try { cur = JSON.parse(Buffer.from(f.cursor, 'base64url').toString()); } catch { cur = null; } }
  // Pick the page of events first (index-friendly), then expand lines for just that page.
  const r = await db.query(
    `WITH page AS (
       SELECT e.* FROM inventory_events e
        WHERE e.organization_id = $1 AND e.hotel_context_id = ANY($2::uuid[])
          AND ($3::uuid IS NULL OR e.actor_user_id = $3) AND ($4::text IS NULL OR e.action = $4)
          AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM inventory_event_lines x WHERE x.event_id = e.id AND x.room_id = $5))
          AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM inventory_event_lines x WHERE x.event_id = e.id AND x.product_id = $6))
          AND ($7::timestamptz IS NULL OR e.created_at >= $7) AND ($8::timestamptz IS NULL OR e.created_at < $8)
          AND ($9::timestamptz IS NULL OR (e.created_at, e.id) < ($9, $10::uuid))
        ORDER BY e.created_at DESC, e.id DESC LIMIT $11)
     SELECT e.id, e.action, e.created_at, e.note, e.reason, e.reversal_of_event_id, e.related_transfer_id, e.related_stock_count_id, e.voice_proposal_id,
            e.hotel_context_id, h.name AS hotel_name, u.display_name AS actor_name, u.employee_code AS actor_code,
            (SELECT r.id FROM inventory_events r WHERE r.reversal_of_event_id = e.id) AS reversed_by,
            (SELECT json_agg(json_build_object('productId', l.product_id, 'name', p.name, 'unit', p.unit, 'quantity', l.quantity, 'roomNumber', rm.room_number,
                    'from', fl.type, 'to', tl.type, 'note', l.note) ORDER BY p.name)
               FROM inventory_event_lines l JOIN products p ON p.id = l.product_id LEFT JOIN rooms rm ON rm.id = l.room_id
               LEFT JOIN stock_locations fl ON fl.id = l.from_location_id LEFT JOIN stock_locations tl ON tl.id = l.to_location_id
              WHERE l.event_id = e.id) AS lines
       FROM page e JOIN users u ON u.id = e.actor_user_id LEFT JOIN hotels h ON h.id = e.hotel_context_id
      ORDER BY e.created_at DESC, e.id DESC`,
    [orgId, f.hotelIds, f.actorUserId ?? null, f.action ?? null, f.roomId ?? null, f.productId ?? null, f.from ?? null, f.to ?? null, cur?.t ?? null, cur?.id ?? null, f.limit + 1],
  );
  const rows = r.rows.slice(0, f.limit);
  const last = rows[rows.length - 1];
  return {
    items: rows.map((e) => ({
      eventId: e.id, action: e.action, createdAt: e.created_at, note: e.note, reason: e.reason, hotelId: e.hotel_context_id, hotelName: e.hotel_name,
      actor: { name: e.actor_name, code: e.actor_code }, reversalOf: e.reversal_of_event_id, reversedBy: e.reversed_by,
      transferId: e.related_transfer_id, countId: e.related_stock_count_id, viaVoice: !!e.voice_proposal_id, lines: e.lines,
    })),
    nextCursor: r.rows.length > f.limit && last ? Buffer.from(JSON.stringify({ t: last.created_at.toISOString(), id: last.id })).toString('base64url') : null,
  };
}

function csvCell(v: unknown) {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

export async function stockEventsCsv(db: Db, orgId: string, hotelIds: string[], from?: string, to?: string) {
  const r = await db.query(
    `SELECT e.created_at, e.id, e.action, h.name AS hotel, u.employee_code, p.sku, p.name AS product, l.quantity,
            fl.type AS from_type, tl.type AS to_type, rm.room_number, e.reason, e.note, e.reversal_of_event_id, t.ref_code
       FROM inventory_events e JOIN inventory_event_lines l ON l.event_id = e.id JOIN products p ON p.id = l.product_id
       JOIN users u ON u.id = e.actor_user_id LEFT JOIN hotels h ON h.id = e.hotel_context_id
       LEFT JOIN stock_locations fl ON fl.id = l.from_location_id LEFT JOIN stock_locations tl ON tl.id = l.to_location_id
       LEFT JOIN rooms rm ON rm.id = l.room_id LEFT JOIN transfers t ON t.id = e.related_transfer_id
      WHERE e.organization_id = $1 AND e.hotel_context_id = ANY($2::uuid[])
        AND ($3::timestamptz IS NULL OR e.created_at >= $3) AND ($4::timestamptz IS NULL OR e.created_at < $4)
      ORDER BY e.created_at, e.id LIMIT 100000`,
    [orgId, hotelIds, from ?? null, to ?? null],
  );
  return toCsv(
    ['timestamp_utc', 'event_id', 'action', 'hotel', 'employee_code', 'sku', 'product', 'quantity', 'from', 'to', 'room', 'reason', 'note', 'reversal_of', 'transfer_ref'],
    r.rows.map((x) => [x.created_at, x.id, x.action, x.hotel, x.employee_code, x.sku, x.product, x.quantity, x.from_type ?? 'EXTERNAL', x.to_type ?? (x.room_number ? 'ROOM_PLACEMENT' : 'EXTERNAL'), x.room_number, x.reason, x.note, x.reversal_of_event_id, x.ref_code]),
  );
}

export async function countsCsv(db: Db, orgId: string, hotelIds: string[]) {
  const r = await db.query(
    `SELECT c.id, h.name AS hotel, c.status, c.started_at, c.submitted_at, u.employee_code, p.sku, p.name, l.expected_qty, l.physical_qty, l.reason
       FROM stock_counts c JOIN hotels h ON h.id = c.hotel_id JOIN stock_count_lines l ON l.count_id = c.id JOIN products p ON p.id = l.product_id
       LEFT JOIN users u ON u.id = c.submitted_by
      WHERE c.organization_id = $1 AND c.hotel_id = ANY($2::uuid[]) AND c.status = 'SUBMITTED' ORDER BY c.submitted_at DESC, p.name`,
    [orgId, hotelIds],
  );
  return toCsv(['count_id', 'hotel', 'status', 'started_at_utc', 'submitted_at_utc', 'signed_off_by', 'sku', 'product', 'expected', 'physical', 'difference', 'reason'],
    r.rows.map((x) => [x.id, x.hotel, x.status, x.started_at, x.submitted_at, x.employee_code, x.sku, x.name, x.expected_qty, x.physical_qty, x.physical_qty - x.expected_qty, x.reason]));
}
