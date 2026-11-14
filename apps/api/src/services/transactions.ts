import type { CreateTxBody } from '@stockwise/shared';
import type { Db, Tx } from '../db/pool.ts';
import { err } from '../errors.ts';
import { requireHotel, rolesAt, type Actor } from './actor.ts';
import { hashRequest, idempotent } from './idempotency.ts';
import { postEvent, type Movement } from './ledger.ts';
import { bagLocation, storeLocation } from './locations.ts';

const MANAGER_ONLY = new Set(['WASTE', 'STOCK_ADJUSTMENT']);

async function assertProducts(tx: Tx, orgId: string, ids: string[]) {
  const uniq = [...new Set(ids)];
  const r = await tx.query('SELECT id FROM products WHERE organization_id = $1 AND active AND id = ANY($2::uuid[])', [orgId, uniq]);
  if (r.rowCount !== uniq.length) throw err('INVALID_ROOM_OR_PRODUCT', 'Unknown or inactive product');
}

async function assertRooms(tx: Tx, hotelId: string, ids: string[]) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return;
  const r = await tx.query('SELECT id FROM rooms WHERE hotel_id = $1 AND active AND id = ANY($2::uuid[])', [hotelId, uniq]);
  if (r.rowCount !== uniq.length) throw err('INVALID_ROOM_OR_PRODUCT', 'Room does not exist in this hotel');
}

async function consumeProposal(tx: Tx, actor: Actor, proposalId: string | undefined, hotelId: string) {
  if (!proposalId) return null;
  const r = await tx.query('SELECT user_id, hotel_id, expires_at, consumed_event_id FROM voice_proposals WHERE id = $1 FOR UPDATE', [proposalId]);
  const p = r.rows[0];
  if (!p || p.user_id !== actor.userId || p.hotel_id !== hotelId) throw err('PROPOSAL_EXPIRED', 'Voice proposal not found for this user/hotel');
  if (p.consumed_event_id) throw err('PROPOSAL_EXPIRED', 'This voice proposal was already confirmed');
  if (new Date(p.expires_at).getTime() < Date.now()) throw err('PROPOSAL_EXPIRED', 'Voice proposal expired — please record again');
  return proposalId;
}

export async function markProposalConsumed(tx: Tx, proposalId: string | null, eventId: string) {
  if (proposalId) await tx.query('UPDATE voice_proposals SET consumed_event_id = $2 WHERE id = $1', [proposalId, eventId]);
}

/** Builds and posts the ledger movements for one confirmed staff/manager action. */
export async function createTransaction(db: Db, actor: Actor, body: CreateTxBody, idemKey: string) {
  const hash = hashRequest('tx', body);
  const res = await idempotent(db, actor, idemKey, hash, async (tx) => {
    const roleSet = MANAGER_ONLY.has(body.action) ? (['MANAGER', 'OWNER'] as const) : body.action === 'OPENING_BALANCE' ? (['OWNER'] as const) : (['STAFF', 'MANAGER', 'OWNER'] as const);
    const hotel = await requireHotel(tx, actor, body.hotelId, [...roleSet]);
    if (!hotel.active) throw err('HOTEL_NOT_ALLOWED', 'Hotel is inactive');
    await assertProducts(tx, actor.orgId, body.lines.map((l) => l.productId));
    const proposalId = await consumeProposal(tx, actor, body.proposalId, body.hotelId);
    const store = await storeLocation(tx, actor.orgId, body.hotelId);
    const bag = () => bagLocation(tx, actor.orgId, body.hotelId, actor.userId);
    const movements: Movement[] = [];

    for (const l of body.lines) {
      switch (body.action) {
        case 'SUPPLIER_RECEIPT':
        case 'OPENING_BALANCE':
          movements.push({ productId: l.productId, quantity: l.quantity, fromLocationId: null, toLocationId: store });
          break;
        case 'CHECKOUT_TO_STAFF':
          movements.push({ productId: l.productId, quantity: l.quantity, fromLocationId: store, toLocationId: await bag() });
          break;
        case 'RETURN_TO_STORE':
          movements.push({ productId: l.productId, quantity: l.quantity, fromLocationId: await bag(), toLocationId: store });
          break;
        case 'PLACE_IN_ROOM': {
          if (!l.roomId) throw err('INVALID_INPUT', 'Each room placement line needs a room');
          if (!l.source) throw err('INVALID_INPUT', 'Choose where the items came from: My carried stock or Hotel store');
          if (l.source === 'STORE' && !hotel.allow_store_to_room) throw err('FORBIDDEN', 'Direct store-to-room placement is disabled for this hotel');
          const from = l.source === 'STORE' ? store : await bag();
          movements.push({ productId: l.productId, quantity: l.quantity, fromLocationId: from, toLocationId: null, roomId: l.roomId });
          break;
        }
        case 'WASTE':
          movements.push({ productId: l.productId, quantity: l.quantity, fromLocationId: store, toLocationId: null });
          break;
        case 'STOCK_ADJUSTMENT':
          if (!l.direction) throw err('INVALID_INPUT', 'Adjustment lines need direction IN or OUT');
          movements.push(l.direction === 'IN'
            ? { productId: l.productId, quantity: l.quantity, fromLocationId: null, toLocationId: store }
            : { productId: l.productId, quantity: l.quantity, fromLocationId: store, toLocationId: null });
          break;
      }
    }
    if ((body.action === 'WASTE' || body.action === 'STOCK_ADJUSTMENT') && !body.reason?.trim()) throw err('INVALID_INPUT', 'A reason is required');
    await assertRooms(tx, body.hotelId, body.lines.flatMap((l) => (l.roomId ? [l.roomId] : [])));

    const out = await postEvent(tx, actor, {
      action: body.action,
      hotelContextId: body.hotelId,
      idempotencyKey: idemKey,
      requestHash: hash,
      movements,
      voiceProposalId: proposalId,
      reason: body.reason ?? null,
      note: body.note ?? null,
    });
    await markProposalConsumed(tx, proposalId, out.eventId);
    return { status: 201, body: { ...out, state: 'COMMITTED' as const } };
  });
  return res;
}

const NOT_REVERSIBLE = new Set(['REVERSAL', 'TRANSFER_DISPATCH', 'TRANSFER_RECEIPT', 'TRANSFER_RESOLUTION']);

/** Posts a compensating event that mirrors the original. History is never edited. */
export async function reverseTransaction(db: Db, actor: Actor, eventId: string, reason: string, idemKey: string) {
  const hash = hashRequest('reversal:' + eventId, { reason });
  return idempotent(db, actor, idemKey, hash, async (tx) => {
    const e = await tx.query('SELECT id, action, hotel_context_id FROM inventory_events WHERE id = $1 AND organization_id = $2', [eventId, actor.orgId]);
    const ev = e.rows[0];
    if (!ev) throw err('NOT_FOUND', 'Transaction not found');
    await requireHotel(tx, actor, ev.hotel_context_id, ['MANAGER', 'OWNER']);
    if (NOT_REVERSIBLE.has(ev.action)) throw err('INVALID_INPUT', `${ev.action} cannot be reversed here; use transfer resolution instead`);
    const already = await tx.query('SELECT id FROM inventory_events WHERE reversal_of_event_id = $1', [eventId]);
    if (already.rowCount) throw err('TRANSFER_CONFLICT', 'This transaction was already reversed', { reversalEventId: already.rows[0].id });
    const lines = await tx.query('SELECT product_id, quantity, from_location_id, to_location_id, room_id FROM inventory_event_lines WHERE event_id = $1', [eventId]);
    const movements: Movement[] = lines.rows.map((l) => ({
      productId: l.product_id,
      quantity: l.quantity,
      fromLocationId: l.to_location_id,
      toLocationId: l.from_location_id,
      roomId: null, // room placement reversal returns goods to their source; it is not itself a placement
      note: l.room_id ? 'Reverses room placement' : null,
    }));
    const out = await postEvent(tx, actor, {
      action: 'REVERSAL', hotelContextId: ev.hotel_context_id, idempotencyKey: idemKey, requestHash: hash, movements, reversalOfEventId: eventId, reason,
    });
    await tx.query(`UPDATE correction_requests SET status='RESOLVED', resolved_by=$2, resolution_event_id=$3, resolved_at=now() WHERE event_id=$1 AND status='OPEN'`, [eventId, actor.userId, out.eventId]);
    return { status: 201, body: { ...out, state: 'COMMITTED' as const, reversalOf: eventId } };
  });
}

export function canSeeAllHotelActivity(actor: Actor, hotelId: string) {
  const r = rolesAt(actor, hotelId);
  return r.has('MANAGER') || r.has('OWNER');
}
