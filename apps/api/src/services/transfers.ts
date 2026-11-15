import type { z } from 'zod';
import type { CreateTransferBody, ReceiveTransferBody, ResolveTransferBody } from '@stockwise/shared';
import type { Db, Tx } from '../db/pool.ts';
import { err } from '../errors.ts';
import { requireHotel, rolesAt, type Actor } from './actor.ts';
import { hashRequest, idempotent } from './idempotency.ts';
import { postEvent } from './ledger.ts';
import { storeLocation, transitLocation } from './locations.ts';
import { markProposalConsumed } from './transactions.ts';
import { closeRequestForTransfer } from './requests.ts';

type CreateBody = z.infer<typeof CreateTransferBody> & { proposalId?: string };
type ReceiveBody = z.infer<typeof ReceiveTransferBody> & { final?: boolean };
type ResolveBody = z.infer<typeof ResolveTransferBody>;

function merge(lines: { productId: string; quantity: number }[]) {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity);
  return [...m.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

export async function dispatchTransfer(db: Db, actor: Actor, body: CreateBody, idemKey: string) {
  const hash = hashRequest('transfer', body);
  return idempotent(db, actor, idemKey, hash, async (tx) => {
    if (body.fromHotelId === body.toHotelId) throw err('INVALID_INPUT', 'Sending and receiving hotel must be different');
    await requireHotel(tx, actor, body.fromHotelId);
    const to = await tx.query('SELECT id FROM hotels WHERE id = $1 AND organization_id = $2 AND active', [body.toHotelId, actor.orgId]);
    if (!to.rowCount) throw err('INVALID_INPUT', 'Destination hotel not found');
    const lines = merge(body.lines);
    const prod = await tx.query('SELECT id FROM products WHERE organization_id = $1 AND active AND id = ANY($2::uuid[])', [actor.orgId, lines.map((l) => l.productId)]);
    if (prod.rowCount !== lines.length) throw err('INVALID_ROOM_OR_PRODUCT', 'Unknown or inactive product');

    let proposalId: string | null = null;
    if (body.proposalId) {
      const p = await tx.query('SELECT user_id, hotel_id, expires_at, consumed_event_id FROM voice_proposals WHERE id=$1 FOR UPDATE', [body.proposalId]);
      const row = p.rows[0];
      if (!row || row.user_id !== actor.userId || row.hotel_id !== body.fromHotelId || row.consumed_event_id || new Date(row.expires_at) < new Date())
        throw err('PROPOSAL_EXPIRED', 'Voice proposal is expired or already used');
      proposalId = body.proposalId;
    }

    const seq = await tx.query(`SELECT nextval('transfer_ref_seq') AS n`);
    const ref = `T${seq.rows[0].n}`;
    const t = await tx.query(
      `INSERT INTO transfers (organization_id, ref_code, from_hotel_id, to_hotel_id, dispatched_by, status, note) VALUES ($1,$2,$3,$4,$5,'IN_TRANSIT',$6) RETURNING id, dispatched_at`,
      [actor.orgId, ref, body.fromHotelId, body.toHotelId, actor.userId, body.note ?? null],
    );
    const transferId = t.rows[0].id;
    for (const l of lines) await tx.query('INSERT INTO transfer_lines (transfer_id, product_id, sent_qty) VALUES ($1,$2,$3)', [transferId, l.productId, l.quantity]);
    const store = await storeLocation(tx, actor.orgId, body.fromHotelId);
    const transit = await transitLocation(tx, actor.orgId, transferId, body.fromHotelId);
    const out = await postEvent(tx, actor, {
      action: 'TRANSFER_DISPATCH', hotelContextId: body.fromHotelId, idempotencyKey: idemKey, requestHash: hash,
      movements: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, fromLocationId: store, toLocationId: transit })),
      relatedTransferId: transferId, voiceProposalId: proposalId, note: body.note ?? null,
    });
    await markProposalConsumed(tx, proposalId, out.eventId);
    return { status: 201, body: { ...out, state: 'COMMITTED' as const, transferId, refCode: ref, status: 'IN_TRANSIT' } };
  });
}

async function lockTransfer(tx: Tx, actor: Actor, id: string) {
  const t = await tx.query('SELECT * FROM transfers WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, actor.orgId]);
  if (!t.rowCount) throw err('NOT_FOUND', 'Transfer not found');
  const lines = await tx.query('SELECT product_id, sent_qty, received_qty, resolved_short_qty FROM transfer_lines WHERE transfer_id = $1 ORDER BY product_id', [id]);
  const loc = await tx.query(`SELECT id FROM stock_locations WHERE transfer_id = $1`, [id]);
  return { t: t.rows[0], lines: lines.rows as { product_id: string; sent_qty: number; received_qty: number; resolved_short_qty: number }[], transit: loc.rows[0].id as string };
}

function nextStatus(lines: { sent_qty: number; received_qty: number; resolved_short_qty: number }[], final: boolean, prev: string) {
  const outstanding = lines.reduce((s, l) => s + l.sent_qty - l.received_qty - l.resolved_short_qty, 0);
  const received = lines.reduce((s, l) => s + l.received_qty, 0);
  if (outstanding === 0) return lines.some((l) => l.resolved_short_qty > 0) ? 'RESOLVED' : 'RECEIVED';
  if (final) return 'DISCREPANCY';
  if (prev === 'DISCREPANCY') return 'DISCREPANCY';
  return received > 0 ? 'PARTIALLY_RECEIVED' : 'IN_TRANSIT';
}

export async function receiveTransfer(db: Db, actor: Actor, transferId: string, body: ReceiveBody, idemKey: string) {
  const hash = hashRequest('receipt:' + transferId, body);
  return idempotent(db, actor, idemKey, hash, async (tx) => {
    const { t, lines, transit } = await lockTransfer(tx, actor, transferId);
    await requireHotel(tx, actor, t.to_hotel_id);
    if (t.dispatched_by === actor.userId && !rolesAt(actor, t.to_hotel_id).has('OWNER'))
      throw err('FORBIDDEN', 'The person who sent a transfer cannot also receive it');
    if (t.status === 'RECEIVED' || t.status === 'RESOLVED') throw err('TRANSFER_CONFLICT', 'This transfer is already closed');
    const byProduct = new Map(lines.map((l) => [l.product_id, l]));
    const movements = [];
    for (const l of body.lines) {
      const line = byProduct.get(l.productId);
      if (!line) throw err('INVALID_INPUT', 'Product is not part of this transfer');
      const remaining = line.sent_qty - line.received_qty - line.resolved_short_qty;
      if (l.receivedQuantity > remaining)
        throw err('TRANSFER_CONFLICT', `Cannot receive ${l.receivedQuantity}; only ${remaining} still in transit`, { productId: l.productId, remaining });
      if (l.receivedQuantity > 0) {
        movements.push({ productId: l.productId, quantity: l.receivedQuantity, fromLocationId: transit, toLocationId: null as string | null });
        line.received_qty += l.receivedQuantity;
      }
    }
    if (!movements.length) throw err('INVALID_INPUT', 'Enter at least one received quantity');
    const store = await storeLocation(tx, actor.orgId, t.to_hotel_id);
    for (const m of movements) m.toLocationId = store;
    const out = await postEvent(tx, actor, {
      action: 'TRANSFER_RECEIPT', hotelContextId: t.to_hotel_id, idempotencyKey: idemKey, requestHash: hash, movements, relatedTransferId: transferId, note: body.note ?? null,
    });
    for (const l of lines) await tx.query('UPDATE transfer_lines SET received_qty = $3 WHERE transfer_id = $1 AND product_id = $2', [transferId, l.product_id, l.received_qty]);
    const status = nextStatus(lines, !!body.final, t.status);
    await tx.query('UPDATE transfers SET status = $2 WHERE id = $1', [transferId, status]);
    if (status === 'RECEIVED' || status === 'RESOLVED') await closeRequestForTransfer(tx, transferId);
    const outstanding = lines.reduce((s, l) => s + l.sent_qty - l.received_qty - l.resolved_short_qty, 0);
    return { status: 201, body: { ...out, state: 'COMMITTED' as const, transferId, status, outstandingUnits: outstanding } };
  });
}

/** Manager/owner closes remaining in-transit qty as lost/damaged with an explicit reconciliation event. */
export async function resolveTransfer(db: Db, actor: Actor, transferId: string, body: ResolveBody, idemKey: string) {
  const hash = hashRequest('resolve:' + transferId, body);
  return idempotent(db, actor, idemKey, hash, async (tx) => {
    const { t, lines, transit } = await lockTransfer(tx, actor, transferId);
    const fromRoles = rolesAt(actor, t.from_hotel_id), toRoles = rolesAt(actor, t.to_hotel_id);
    const ok = fromRoles.has('OWNER') || fromRoles.has('MANAGER') || toRoles.has('MANAGER');
    if (!ok) throw err('FORBIDDEN', 'Only a manager or owner can resolve transfer discrepancies');
    const movements = lines
      .map((l) => ({ productId: l.product_id, quantity: l.sent_qty - l.received_qty - l.resolved_short_qty, fromLocationId: transit, toLocationId: null }))
      .filter((m) => m.quantity > 0);
    if (!movements.length) throw err('TRANSFER_CONFLICT', 'Nothing left to resolve on this transfer');
    const out = await postEvent(tx, actor, {
      action: 'TRANSFER_RESOLUTION', hotelContextId: t.to_hotel_id, idempotencyKey: idemKey, requestHash: hash, movements,
      relatedTransferId: transferId, reason: body.reason, note: body.note ?? null,
    });
    for (const m of movements) await tx.query('UPDATE transfer_lines SET resolved_short_qty = resolved_short_qty + $3 WHERE transfer_id = $1 AND product_id = $2', [transferId, m.productId, m.quantity]);
    await tx.query(`UPDATE transfers SET status = 'RESOLVED' WHERE id = $1`, [transferId]);
    await closeRequestForTransfer(tx, transferId);
    return { status: 201, body: { ...out, state: 'COMMITTED' as const, transferId, status: 'RESOLVED', resolvedUnits: movements.reduce((s, m) => s + m.quantity, 0) } };
  });
}

export async function listTransfers(db: Db, actor: Actor, hotelIds: string[], status?: string) {
  const r = await db.query(
    `SELECT t.id, t.ref_code, t.status, t.dispatched_at, t.note, t.from_hotel_id, t.to_hotel_id, fh.name AS from_name, th.name AS to_name,
            u.display_name AS dispatched_by_name, u.id AS dispatched_by, th.transfer_aging_hours,
            json_agg(json_build_object('productId', p.id, 'name', p.name, 'unit', p.unit, 'sent', tl.sent_qty, 'received', tl.received_qty, 'resolvedShort', tl.resolved_short_qty) ORDER BY p.name) AS lines
       FROM transfers t
       JOIN hotels fh ON fh.id = t.from_hotel_id JOIN hotels th ON th.id = t.to_hotel_id
       JOIN users u ON u.id = t.dispatched_by
       JOIN transfer_lines tl ON tl.transfer_id = t.id JOIN products p ON p.id = tl.product_id
      WHERE t.organization_id = $1 AND (t.from_hotel_id = ANY($2::uuid[]) OR t.to_hotel_id = ANY($2::uuid[]))
        AND ($3::text IS NULL OR t.status = $3 OR ($3 = 'OPEN' AND t.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED','DISCREPANCY')))
      GROUP BY t.id, fh.name, th.name, u.display_name, u.id, th.transfer_aging_hours
      ORDER BY t.dispatched_at ASC
      LIMIT 200`,
    [actor.orgId, hotelIds, status ?? null],
  );
  const now = Date.now();
  return r.rows.map((t) => {
    const ageHours = (now - new Date(t.dispatched_at).getTime()) / 3_600_000;
    const outstanding = t.lines.reduce((s: number, l: any) => s + l.sent - l.received - l.resolvedShort, 0);
    return {
      id: t.id, refCode: t.ref_code, status: t.status, dispatchedAt: t.dispatched_at, note: t.note,
      fromHotel: { id: t.from_hotel_id, name: t.from_name }, toHotel: { id: t.to_hotel_id, name: t.to_name },
      dispatchedBy: { id: t.dispatched_by, name: t.dispatched_by_name },
      lines: t.lines, outstandingUnits: outstanding, ageHours: Math.round(ageHours * 10) / 10,
      aged: outstanding > 0 && ageHours > t.transfer_aging_hours,
    };
  });
}
