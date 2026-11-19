import type { Db, Tx } from '../db/pool.ts';
import { withTx } from '../db/pool.ts';
import { err } from '../errors.ts';
import { requireHotel, type Actor } from './actor.ts';
import { hashRequest, idempotent } from './idempotency.ts';
import { postEvent } from './ledger.ts';
import { storeLocation } from './locations.ts';

const COUNT_ROLES = ['MANAGER', 'OWNER'] as const;

async function loadCount(db: Db | Tx, actor: Actor, id: string, lock = false) {
  const c = await db.query(`SELECT * FROM stock_counts WHERE id = $1 AND organization_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [id, actor.orgId]);
  if (!c.rowCount) throw err('NOT_FOUND', 'Count not found');
  await requireHotel(db, actor, c.rows[0].hotel_id, [...COUNT_ROLES]);
  return c.rows[0];
}

/** Count is store-only. Staff-held and in-transit are returned separately for context, never counted. */
export async function getCount(db: Db | Tx, actor: Actor, id: string) {
  const c = await loadCount(db, actor, id);
  const lines = await db.query(
    `SELECT l.product_id, p.name, p.sku, p.unit, p.icon, l.expected_qty, l.expected_version, l.physical_qty, l.reason,
            COALESCE(sb.quantity, 0) AS current_qty, COALESCE(sb.version, 0) AS current_version,
            COALESCE((SELECT sum(b.quantity) FROM stock_balances b JOIN stock_locations sl ON sl.id = b.location_id
                       WHERE sl.type='STAFF_BAG' AND sl.hotel_id = $2 AND b.product_id = l.product_id), 0) AS staff_held,
            COALESCE((SELECT sum(b.quantity) FROM stock_balances b JOIN stock_locations sl ON sl.id = b.location_id JOIN transfers t ON t.id = sl.transfer_id
                       WHERE sl.type='TRANSFER_IN_TRANSIT' AND (t.from_hotel_id = $2 OR t.to_hotel_id = $2) AND b.product_id = l.product_id), 0) AS in_transit
       FROM stock_count_lines l JOIN products p ON p.id = l.product_id
       LEFT JOIN stock_balances sb ON sb.location_id = $3 AND sb.product_id = l.product_id
      WHERE l.count_id = $1 ORDER BY p.name`,
    [id, c.hotel_id, c.store_location_id],
  );
  const adj = await db.query(`SELECT id FROM inventory_events WHERE related_stock_count_id = $1`, [id]);
  const out = lines.rows.map((l) => ({
    productId: l.product_id, name: l.name, sku: l.sku, unit: l.unit, icon: l.icon,
    expectedQty: l.expected_qty, physicalQty: l.physical_qty, reason: l.reason,
    variance: l.physical_qty == null ? null : l.physical_qty - l.expected_qty,
    changedSinceSnapshot: c.status === 'DRAFT' && Number(l.current_version) !== Number(l.expected_version),
    currentQty: l.current_qty, staffHeld: l.staff_held, inTransit: l.in_transit,
  }));
  return {
    id: c.id, hotelId: c.hotel_id, status: c.status, startedAt: c.started_at, startedBy: c.started_by,
    submittedAt: c.submitted_at, submittedBy: c.submitted_by, note: c.note,
    lines: out, changedCount: out.filter((l) => l.changedSinceSnapshot).length,
    adjustmentEventIds: adj.rows.map((r) => r.id),
  };
}

async function snapshotLines(tx: Tx, countId: string, orgId: string, store: string, onlyProducts?: string[]) {
  await tx.query(
    `INSERT INTO stock_count_lines (count_id, product_id, expected_qty, expected_version)
     SELECT $1, p.id, COALESCE(sb.quantity, 0), COALESCE(sb.version, 0)
       FROM products p LEFT JOIN stock_balances sb ON sb.location_id = $3 AND sb.product_id = p.id
      WHERE p.organization_id = $2 AND p.active AND ($4::uuid[] IS NULL OR p.id = ANY($4::uuid[]))
        AND (p.room_item OR sb.product_id IS NOT NULL OR $4::uuid[] IS NOT NULL)
     ON CONFLICT (count_id, product_id) DO UPDATE SET expected_qty = EXCLUDED.expected_qty, expected_version = EXCLUDED.expected_version, physical_qty = NULL, reason = NULL`,
    [countId, orgId, store, onlyProducts ?? null],
  );
}

export async function startCount(db: Db, actor: Actor, hotelId: string) {
  return withTx(db, async (tx) => {
    await requireHotel(tx, actor, hotelId, [...COUNT_ROLES]);
    const existing = await tx.query(`SELECT id FROM stock_counts WHERE hotel_id = $1 AND status = 'DRAFT'`, [hotelId]);
    if (existing.rowCount) return getCount(tx, actor, existing.rows[0].id);
    const store = await storeLocation(tx, actor.orgId, hotelId);
    const c = await tx.query(
      `INSERT INTO stock_counts (organization_id, hotel_id, store_location_id, started_by) VALUES ($1,$2,$3,$4) RETURNING id`,
      [actor.orgId, hotelId, store, actor.userId],
    );
    await snapshotLines(tx, c.rows[0].id, actor.orgId, store);
    return getCount(tx, actor, c.rows[0].id);
  });
}

export async function patchCountLines(db: Db, actor: Actor, id: string, lines: { productId: string; physicalQty: number | null; reason?: string | null }[]) {
  return withTx(db, async (tx) => {
    const c = await loadCount(tx, actor, id, true);
    if (c.status !== 'DRAFT') throw err('INVALID_INPUT', 'Count is no longer editable');
    for (const l of lines) {
      const r = await tx.query(`UPDATE stock_count_lines SET physical_qty = $3, reason = $4 WHERE count_id = $1 AND product_id = $2`, [id, l.productId, l.physicalQty, l.reason ?? null]);
      if (!r.rowCount) throw err('INVALID_ROOM_OR_PRODUCT', 'Product not part of this count');
    }
    return getCount(tx, actor, id);
  });
}

/** Re-snapshot only products that moved since the count started; their physical qty must be re-entered. */
export async function refreshCount(db: Db, actor: Actor, id: string) {
  return withTx(db, async (tx) => {
    const c = await loadCount(tx, actor, id, true);
    if (c.status !== 'DRAFT') throw err('INVALID_INPUT', 'Count is no longer editable');
    const changed = await tx.query(
      `SELECT l.product_id FROM stock_count_lines l LEFT JOIN stock_balances sb ON sb.location_id = $2 AND sb.product_id = l.product_id
        WHERE l.count_id = $1 AND COALESCE(sb.version, 0) <> l.expected_version`,
      [id, c.store_location_id],
    );
    const ids = changed.rows.map((r) => r.product_id);
    if (ids.length) await snapshotLines(tx, id, actor.orgId, c.store_location_id, ids);
    return { ...(await getCount(tx, actor, id)), refreshedProducts: ids };
  });
}

export async function cancelCount(db: Db, actor: Actor, id: string) {
  return withTx(db, async (tx) => {
    const c = await loadCount(tx, actor, id, true);
    if (c.status !== 'DRAFT') throw err('INVALID_INPUT', 'Only draft counts can be cancelled');
    await tx.query(`UPDATE stock_counts SET status = 'CANCELLED' WHERE id = $1`, [id]);
    return getCount(tx, actor, id);
  });
}

/**
 * Signs off a count. Locks store balances, rejects with STALE_COUNT_SNAPSHOT if any product
 * moved since the snapshot (never overwrites concurrent activity), then posts ONE immutable
 * STOCK_ADJUSTMENT event carrying each variance.
 */
export async function submitCount(db: Db, actor: Actor, id: string, idemKey: string, note?: string) {
  const hash = hashRequest('count-submit:' + id, { note: note ?? null });
  return idempotent(db, actor, idemKey, hash, async (tx) => {
    const c = await loadCount(tx, actor, id, true);
    if (c.status !== 'DRAFT') throw err('INVALID_INPUT', 'Count already submitted or cancelled');
    const lines = (await tx.query(`SELECT product_id, expected_qty, expected_version, physical_qty, reason FROM stock_count_lines WHERE count_id = $1 ORDER BY product_id`, [id])).rows;
    const missing = lines.filter((l) => l.physical_qty == null);
    if (missing.length) throw err('INVALID_INPUT', `${missing.length} product(s) not counted yet`, { productIds: missing.map((l) => l.product_id) });
    const noReason = lines.filter((l) => l.physical_qty !== l.expected_qty && !l.reason);
    if (noReason.length) throw err('INVALID_INPUT', 'Every difference needs a reason', { productIds: noReason.map((l) => l.product_id) });

    // Lock balances in deterministic order and compare versions.
    const changed: { productId: string; expectedQty: number; currentQty: number }[] = [];
    for (const l of lines) {
      const b = await tx.query(`SELECT quantity, version FROM stock_balances WHERE location_id = $1 AND product_id = $2 FOR UPDATE`, [c.store_location_id, l.product_id]);
      const ver = b.rows[0]?.version ?? 0, q = b.rows[0]?.quantity ?? 0;
      if (Number(ver) !== Number(l.expected_version)) changed.push({ productId: l.product_id, expectedQty: l.expected_qty, currentQty: q });
    }
    if (changed.length) throw err('STALE_COUNT_SNAPSHOT', `${changed.length} item(s) changed since this count started. Refresh before finishing.`, { changed });

    const movements = lines
      .filter((l) => l.physical_qty !== l.expected_qty)
      .map((l) => {
        const d = l.physical_qty - l.expected_qty;
        return d > 0
          ? { productId: l.product_id, quantity: d, fromLocationId: null, toLocationId: c.store_location_id, note: l.reason }
          : { productId: l.product_id, quantity: -d, fromLocationId: c.store_location_id, toLocationId: null, note: l.reason };
      });
    let eventId: string | null = null;
    if (movements.length) {
      const out = await postEvent(tx, actor, {
        action: 'STOCK_ADJUSTMENT', hotelContextId: c.hotel_id, idempotencyKey: idemKey, requestHash: hash, movements,
        relatedStockCountId: id, reason: 'WEEKLY_COUNT', note: note ?? null,
      });
      eventId = out.eventId;
    }
    await tx.query(`UPDATE stock_counts SET status='SUBMITTED', submitted_by=$2, submitted_at=now(), note=$3 WHERE id=$1`, [id, actor.userId, note ?? null]);
    await tx.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, details) VALUES ($1,$2,'COUNT_SIGNED_OFF','stock_count',$3,$4)`,
      [actor.orgId, actor.userId, id, JSON.stringify({ adjustments: movements.length, eventId })]);
    return {
      status: 201,
      body: {
        countId: id, status: 'SUBMITTED', adjustmentEventId: eventId,
        deltas: lines.map((l) => ({ productId: l.product_id, expectedQty: l.expected_qty, physicalQty: l.physical_qty, delta: l.physical_qty - l.expected_qty, reason: l.reason })),
      },
    };
  });
}

export async function listCounts(db: Db, actor: Actor, hotelIds: string[], from?: string, to?: string) {
  const r = await db.query(
    `SELECT c.id, c.hotel_id, h.name AS hotel_name, c.status, c.started_at, c.submitted_at, su.display_name AS submitted_by_name,
            count(l.*) FILTER (WHERE l.physical_qty IS NOT NULL AND l.physical_qty <> l.expected_qty) AS items_with_variance,
            COALESCE(sum(abs(l.physical_qty - l.expected_qty)) FILTER (WHERE l.physical_qty IS NOT NULL), 0) AS abs_variance_units,
            COALESCE(sum(l.physical_qty - l.expected_qty) FILTER (WHERE l.physical_qty IS NOT NULL), 0) AS net_variance_units,
            COALESCE(sum(l.expected_qty), 0) AS expected_units
       FROM stock_counts c JOIN hotels h ON h.id = c.hotel_id
       LEFT JOIN users su ON su.id = c.submitted_by
       LEFT JOIN stock_count_lines l ON l.count_id = c.id
      WHERE c.organization_id = $1 AND c.hotel_id = ANY($2::uuid[])
        AND ($3::timestamptz IS NULL OR c.started_at >= $3) AND ($4::timestamptz IS NULL OR c.started_at < $4)
      GROUP BY c.id, h.name, su.display_name ORDER BY c.started_at DESC LIMIT 200`,
    [actor.orgId, hotelIds, from ?? null, to ?? null],
  );
  return r.rows.map((x) => ({
    id: x.id, hotelId: x.hotel_id, hotelName: x.hotel_name, status: x.status, startedAt: x.started_at, submittedAt: x.submitted_at,
    submittedByName: x.submitted_by_name, itemsWithVariance: x.items_with_variance, absVarianceUnits: x.abs_variance_units,
    netVarianceUnits: x.net_variance_units, expectedUnits: x.expected_units,
  }));
}
