import type { Tx } from '../db/pool.ts';
import { err } from '../errors.ts';
import type { EventAction } from '@stockwise/shared';
import type { Actor } from './actor.ts';

export interface Movement {
  productId: string;
  quantity: number; // > 0
  fromLocationId: string | null; // null = external source (supplier, positive adjustment)
  toLocationId: string | null; // null = external sink (room placement, waste, negative adjustment)
  roomId?: string | null;
  note?: string | null;
}

export interface PostEventInput {
  action: EventAction;
  hotelContextId: string | null;
  idempotencyKey: string;
  requestHash: string;
  movements: Movement[];
  reversalOfEventId?: string | null;
  relatedTransferId?: string | null;
  relatedStockCountId?: string | null;
  voiceProposalId?: string | null;
  reason?: string | null;
  note?: string | null;
}

export interface BalanceRow { locationId: string; productId: string; quantity: number }

/**
 * The single write path for stock. In the caller's transaction:
 *  1. lock every touched (location, product) balance in deterministic order,
 *  2. reject the WHOLE event if any source would go negative,
 *  3. append immutable event + lines,
 *  4. update the balance projection (bumping version for count-conflict detection).
 */
export async function postEvent(tx: Tx, actor: Actor, input: PostEventInput) {
  if (!input.movements.length) throw err('INVALID_INPUT', 'No movement lines');
  const delta = new Map<string, number>();
  const key = (l: string, p: string) => `${l}|${p}`;
  for (const m of input.movements) {
    if (!Number.isInteger(m.quantity) || m.quantity <= 0) throw err('INVALID_INPUT', 'Quantities must be positive whole numbers');
    if (m.fromLocationId && m.fromLocationId === m.toLocationId) throw err('INVALID_INPUT', 'Source and destination are the same');
    if (m.fromLocationId) delta.set(key(m.fromLocationId, m.productId), (delta.get(key(m.fromLocationId, m.productId)) ?? 0) - m.quantity);
    if (m.toLocationId) delta.set(key(m.toLocationId, m.productId), (delta.get(key(m.toLocationId, m.productId)) ?? 0) + m.quantity);
  }
  const keys = [...delta.keys()].sort();

  // Ensure rows exist, then lock in sorted order (deadlock avoidance).
  for (const k of keys) {
    const [loc, prod] = k.split('|');
    await tx.query(`INSERT INTO stock_balances (location_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [loc, prod]);
  }
  const current = new Map<string, number>();
  for (const k of keys) {
    const [loc, prod] = k.split('|');
    const r = await tx.query(`SELECT quantity FROM stock_balances WHERE location_id = $1 AND product_id = $2 FOR UPDATE`, [loc, prod]);
    current.set(k, r.rows[0].quantity);
  }
  const shortages = keys
    .filter((k) => current.get(k)! + delta.get(k)! < 0)
    .map((k) => {
      const [locationId, productId] = k.split('|');
      return { locationId, productId, available: current.get(k)!, requested: -delta.get(k)! };
    });
  if (shortages.length) throw err('INSUFFICIENT_STOCK', 'Not enough stock for this action', { shortages });

  const ev = await tx.query(
    `INSERT INTO inventory_events (organization_id, actor_user_id, session_id, device_id, hotel_context_id, action,
       idempotency_key, request_hash, reversal_of_event_id, related_transfer_id, related_stock_count_id, voice_proposal_id, reason, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, created_at`,
    [actor.orgId, actor.userId, actor.sessionId, actor.deviceId, input.hotelContextId, input.action, input.idempotencyKey, input.requestHash,
     input.reversalOfEventId ?? null, input.relatedTransferId ?? null, input.relatedStockCountId ?? null, input.voiceProposalId ?? null,
     input.reason ?? null, input.note ?? null],
  );
  const eventId: string = ev.rows[0].id;
  for (const m of input.movements) {
    await tx.query(
      `INSERT INTO inventory_event_lines (event_id, product_id, quantity, from_location_id, to_location_id, room_id, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [eventId, m.productId, m.quantity, m.fromLocationId, m.toLocationId, m.roomId ?? null, m.note ?? null],
    );
  }
  const updated: BalanceRow[] = [];
  for (const k of keys) {
    const [loc, prod] = k.split('|');
    const r = await tx.query(
      `UPDATE stock_balances SET quantity = quantity + $3, version = version + 1, updated_at = now()
       WHERE location_id = $1 AND product_id = $2 RETURNING quantity`,
      [loc, prod, delta.get(k)],
    );
    updated.push({ locationId: loc, productId: prod, quantity: r.rows[0].quantity });
  }
  await tx.query(
    `INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,'inventory_event',$4,$5)`,
    [actor.orgId, actor.userId, `STOCK_${input.action}`, eventId, JSON.stringify({ lines: input.movements.length, sessionId: actor.sessionId, deviceId: actor.deviceId })],
  );
  return { eventId, committedAt: (ev.rows[0].created_at as Date).toISOString(), updatedBalances: updated };
}
