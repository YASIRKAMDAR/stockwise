import type { Db } from '../db/pool.ts';
import { err } from '../errors.ts';
import { rolesAt, visibleHotelIds, type Actor } from './actor.ts';
import { warehouseOf } from './requests.ts';

/**
 * Threads a person can read and write: every site they manage (the owner: all of them),
 * and for warehouse managers every hotel's thread too, because hotels ask the warehouse there.
 */
async function threads(db: Db, actor: Actor) {
  if (actor.authMethod !== 'PASSWORD') return { ids: [] as string[], atWarehouse: false };
  const mine = (await visibleHotelIds(db, actor)).filter((h) => { const r = rolesAt(actor, h); return r.has('MANAGER') || r.has('OWNER'); });
  const wh = await warehouseOf(db, actor.orgId);
  const atWarehouse = !!wh && mine.includes(wh.id);
  if (!atWarehouse) return { ids: mine, atWarehouse };
  const all = await db.query('SELECT id FROM hotels WHERE organization_id = $1 AND active', [actor.orgId]);
  return { ids: [...new Set([...mine, ...all.rows.map((x) => x.id as string)])], atWarehouse };
}

/** The inbox: one row per thread with how many messages are new for this person, newest thread first. */
export async function inbox(db: Db, actor: Actor) {
  const { ids } = await threads(db, actor);
  if (!ids.length) return { unread: 0, threads: [] };
  const r = await db.query(
    `SELECT h.id AS "siteId", h.name AS "siteName", h.kind,
            (SELECT count(*)::int FROM messages m WHERE m.site_id = h.id AND m.author_id IS DISTINCT FROM $2
                AND m.created_at > COALESCE((SELECT read_at FROM message_reads mr WHERE mr.user_id = $2 AND mr.site_id = h.id), 'epoch')) AS unread,
            (SELECT json_build_object('body', m.body, 'kind', m.kind, 'flagged', m.flagged, 'createdAt', m.created_at, 'author', u.display_name)
               FROM messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.site_id = h.id ORDER BY m.created_at DESC LIMIT 1) AS last
       FROM hotels h WHERE h.id = ANY($1::uuid[])
      ORDER BY (SELECT max(m.created_at) FROM messages m WHERE m.site_id = h.id) DESC NULLS LAST, h.name`, [ids, actor.userId]);
  return { unread: r.rows.reduce((t, x) => t + x.unread, 0), threads: r.rows };
}

/** One thread, oldest first. Opening it marks it read. A request card says whether it is still open, so the buttons only show while there is something to do. */
export async function listMessages(db: Db, actor: Actor, siteId: string, limit = 60) {
  const { ids, atWarehouse } = await threads(db, actor);
  if (!ids.includes(siteId)) throw err('HOTEL_NOT_ALLOWED', 'You do not have access to this chat');
  const r = await db.query(
    `SELECT m.id, m.kind, m.body, m.flagged, m.created_at AS "createdAt", m.ref_id AS "refId", m.author_id = $2 AS mine, u.display_name AS author,
            CASE WHEN m.kind = 'REQUEST' THEN (SELECT status FROM stock_requests sr WHERE sr.id = m.ref_id) END AS "refStatus"
       FROM messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.site_id = $1 ORDER BY m.created_at DESC LIMIT $3`, [siteId, actor.userId, Math.min(Math.max(limit, 1), 200)]);
  await db.query(`INSERT INTO message_reads (user_id, site_id) VALUES ($1,$2) ON CONFLICT (user_id, site_id) DO UPDATE SET read_at = now()`, [actor.userId, siteId]);
  const site = await db.query('SELECT name, kind FROM hotels WHERE id = $1', [siteId]);
  return { siteId, siteName: site.rows[0].name, canSend: atWarehouse, messages: r.rows.reverse().map((m) => ({ ...m, mine: m.mine === true })) };
}

export async function postMessage(db: Db, actor: Actor, siteId: string, body: string) {
  const { ids } = await threads(db, actor);
  if (!ids.includes(siteId)) throw err('HOTEL_NOT_ALLOWED', 'You do not have access to this chat');
  const text = body.trim().slice(0, 1000);
  if (!text) throw err('INVALID_INPUT', 'Write a message first');
  const r = await db.query(`INSERT INTO messages (organization_id, site_id, author_id, body) VALUES ($1,$2,$3,$4) RETURNING id, created_at AS "createdAt"`, [actor.orgId, siteId, actor.userId, text]);
  return { id: r.rows[0].id as string, createdAt: r.rows[0].createdAt };
}

type Kind = 'REQUEST' | 'REQUEST_SENT' | 'REQUEST_DECLINED' | 'ORDER_SENT' | 'DELIVERY';
async function card(db: Db, orgId: string, siteId: string, authorId: string | null, kind: Kind, body: string, refId: string, flagged = false) {
  await db.query(`INSERT INTO messages (organization_id, site_id, author_id, kind, body, ref_id, flagged) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [orgId, siteId, authorId, kind, body.slice(0, 1000), refId, flagged]);
}

// What the app writes into the chat by itself. Failing to write a card must never fail the action it describes.
const quietly = (p: Promise<unknown>) => p.catch((e) => console.warn(JSON.stringify({ msg: 'chat card failed', error: String(e) })));

export function noteRequest(db: Db, actor: Actor, requestId: string, kind: 'REQUEST' | 'REQUEST_SENT' | 'REQUEST_DECLINED') {
  return quietly((async () => {
    const r = await db.query(
      `SELECT sr.hotel_id, h.name AS hotel, sr.note, t.ref_code,
              (SELECT string_agg(l.quantity || ' ' || p.name, ', ' ORDER BY p.name) FROM stock_request_lines l JOIN products p ON p.id = l.product_id WHERE l.request_id = sr.id) AS items
         FROM stock_requests sr JOIN hotels h ON h.id = sr.hotel_id LEFT JOIN transfers t ON t.id = sr.transfer_id WHERE sr.id = $1 AND sr.organization_id = $2`, [requestId, actor.orgId]);
    const x = r.rows[0]; if (!x) return;
    const body = kind === 'REQUEST' ? `${x.hotel} asks the warehouse for: ${x.items}${x.note ? `\n“${x.note}”` : ''}`
      : kind === 'REQUEST_SENT' ? `The warehouse sent it${x.ref_code ? ` (${x.ref_code})` : ''}. Record it under Deliveries when it arrives.`
      : `The request was not sent: ${x.items}`;
    await card(db, actor.orgId, x.hotel_id, actor.userId, kind, body, requestId, kind === 'REQUEST_DECLINED');
  })());
}

export function noteOrderSent(db: Db, actor: Actor, orderId: string) {
  return quietly((async () => {
    const r = await db.query(
      `SELECT o.site_id, o.number, s.name AS supplier,
              (SELECT string_agg(ol.quantity || ' ' || p.name, ', ' ORDER BY p.name) FROM purchase_order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = o.id) AS items
         FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = $1 AND o.organization_id = $2 AND o.status = 'SENT'`, [orderId, actor.orgId]);
    const x = r.rows[0]; if (!x) return;
    await card(db, actor.orgId, x.site_id, actor.userId, 'ORDER_SENT', `Order ${x.number} sent to ${x.supplier}: ${x.items}`, orderId);
  })());
}

export function noteDelivery(db: Db, actor: Actor, out: { deliveryId?: string; flags?: { detail: string }[]; creditDue?: number }) {
  if (!out?.deliveryId) return Promise.resolve();
  return quietly((async () => {
    const r = await db.query(`SELECT d.site_id, s.name AS supplier FROM deliveries d JOIN suppliers s ON s.id = d.supplier_id WHERE d.id = $1 AND d.organization_id = $2`, [out.deliveryId, actor.orgId]);
    const x = r.rows[0]; if (!x) return;
    const flags = out.flags ?? [];
    const body = `Delivery from ${x.supplier} added to stock.` + (flags.length ? '\n' + flags.map((f) => '• ' + f.detail).join('\n') : '') + ((out.creditDue ?? 0) > 0 ? `\nAsk for ₹${out.creditDue} back.` : '');
    await card(db, actor.orgId, x.site_id, actor.userId, 'DELIVERY', body, out.deliveryId!, flags.length > 0);
  })());
}
