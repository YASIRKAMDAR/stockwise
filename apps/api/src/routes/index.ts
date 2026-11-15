import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreateProductBody, CreateRoomsBody, CreateTransferBody, CreateTxBody, CreateUserBody, EnrollDeviceBody, PasswordLoginBody, PatchCountLinesBody,
  PatchProductBody, ReceiveTransferBody, ResolveTransferBody, ReversalBody, StaffLoginBody, StartCountBody, ThresholdBody, uuid,
} from '@stockwise/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/pool.ts';
import { withTx } from '../db/pool.ts';
import { err } from '../errors.ts';
import { parse, requireActor, send } from '../app.ts';
import { enrollDevice, hashSecret, logout, passwordLogin, revokeDevice, revokeUserSessions, SESSION_COOKIE, staffLogin } from '../auth/auth.ts';
import { requireHotel, requireOwner, rolesAt, scopeHotels, visibleHotelIds, type Actor } from '../services/actor.ts';
import { cancelCount, getCount, listCounts, patchCountLines, refreshCount, startCount, submitCount } from '../services/counts.ts';
import { requireKey } from '../services/idempotency.ts';
import * as reports from '../services/reports.ts';
import { createTransaction, reverseTransaction } from '../services/transactions.ts';
import { dispatchTransfer, listTransfers, receiveTransfer, resolveTransfer } from '../services/transfers.ts';
import { interpret, myVoiceAttempts, voiceHealth, voiceUsage } from '../voice/service.ts';
import type { VoiceProvider } from '../voice/provider.ts';

interface Deps { db: Db; cfg: Config; provider: VoiceProvider | null }

const idem = (req: FastifyRequest) => requireKey(req.headers['idempotency-key'] as string | undefined);
const Q = (req: FastifyRequest) => req.query as Record<string, string | undefined>;
const optUuid = (v: string | undefined) => (v && v !== 'all' ? parse(uuid, v) : v);
const periodDays = (v?: string) => { const n = Number(v ?? 30); if (![7, 30, 90].includes(n)) throw err('INVALID_INPUT', 'periodDays must be 7, 30 or 90'); return n; };
const iso = (v?: string) => (v ? parse(z.string().datetime({ offset: true }), v) : undefined);

export async function registerRoutes(app: FastifyInstance, { db, cfg, provider }: Deps) {
  const cookieOpts = (maxAge: number) => ({ path: '/', httpOnly: true, sameSite: 'strict' as const, secure: cfg.NODE_ENV === 'production', signed: true, maxAge });
  const authLimit = { config: { rateLimit: { max: cfg.AUTH_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } } };

  // ---------------- Auth ----------------
  app.post('/auth/staff-login', authLimit, async (req, reply) => {
    const b = parse(StaffLoginBody, req.body);
    const s = await staffLogin(db, cfg, b);
    reply.setCookie(SESSION_COOKIE, s.token, cookieOpts(s.maxAgeSeconds));
    return { ok: true };
  });
  app.post('/auth/login', authLimit, async (req, reply) => {
    const b = parse(PasswordLoginBody, req.body);
    const s = await passwordLogin(db, cfg, b);
    reply.setCookie(SESSION_COOKIE, s.token, cookieOpts(s.maxAgeSeconds));
    return { ok: true };
  });
  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    const u = raw ? req.unsignCookie(raw) : null;
    if (u?.valid && u.value) await logout(db, cfg, u.value);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
  app.get('/me', async (req) => {
    const a = requireActor(req);
    const ids = await visibleHotelIds(db, a);
    const hotels = (await db.query('SELECT id, name, code, timezone, allow_store_to_room FROM hotels WHERE id = ANY($1::uuid[]) ORDER BY code', [ids])).rows;
    const role = a.authMethod === 'PIN' ? 'STAFF' : a.isOwner ? 'OWNER' : a.memberships.some((m) => m.role === 'MANAGER') ? 'MANAGER' : 'STAFF';
    return {
      id: a.userId, displayName: a.displayName, employeeCode: a.employeeCode, role, authMethod: a.authMethod, language: a.preferredLanguage,
      hotels: hotels.map((h) => ({ id: h.id, name: h.name, code: h.code, timezone: h.timezone, allowStoreToRoom: h.allow_store_to_room, roles: [...rolesAt(a, h.id)] })),
      activeHotel: a.activeHotelId, deviceId: a.deviceId,
      config: { voiceProvider: provider?.name ?? 'disabled', voiceMaxSeconds: cfg.VOICE_MAX_SECONDS, ownerPollSeconds: cfg.OWNER_POLL_INTERVAL_SECONDS },
    };
  });
  app.get('/me/voice-attempts', async (req) => {
    const a = requireActor(req);
    return { attempts: await myVoiceAttempts(db, a.userId, Math.min(20, Number(Q(req).limit ?? 5) || 5)) };
  });
  app.patch('/me', async (req) => {
    const a = requireActor(req);
    const b = parse(z.object({ language: z.enum(['en', 'hi', 'gu']) }), req.body);
    await db.query('UPDATE users SET preferred_language = $2 WHERE id = $1', [a.userId, b.language]);
    return { ok: true };
  });

  // ---------------- Devices (shared-phone enrollment) ----------------
  app.post('/devices', async (req, reply) => {
    const a = requireActor(req);
    if (a.authMethod !== 'PASSWORD') throw err('FORBIDDEN', 'Managers or owners enroll devices');
    const b = parse(EnrollDeviceBody, req.body);
    await requireHotel(db, a, b.hotelId, ['MANAGER', 'OWNER']);
    return reply.code(201).send(await enrollDevice(db, a, b.hotelId, b.label));
  });
  app.get('/devices', async (req) => {
    const a = requireActor(req);
    const hotels = await scopeHotels(db, a, optUuid(Q(req).hotelId));
    const r = await db.query(`SELECT d.id, d.label, d.hotel_id, h.name AS hotel_name, d.enrolled_at, d.last_seen_at, d.revoked_at FROM devices d JOIN hotels h ON h.id = d.hotel_id
                               WHERE d.hotel_id = ANY($1::uuid[]) ORDER BY d.revoked_at NULLS FIRST, d.enrolled_at DESC`, [hotels]);
    return r.rows;
  });
  app.post('/devices/:id/revoke', async (req) => {
    const a = requireActor(req);
    const id = parse(uuid, (req.params as any).id);
    const d = await db.query('SELECT hotel_id FROM devices WHERE id = $1 AND organization_id = $2', [id, a.orgId]);
    if (!d.rowCount) throw err('NOT_FOUND', 'Device not found');
    await requireHotel(db, a, d.rows[0].hotel_id, ['MANAGER', 'OWNER']);
    await revokeDevice(db, a, id);
    return { ok: true };
  });

  // ---------------- Catalog ----------------
  app.get('/hotels', async (req) => {
    const a = requireActor(req);
    const ids = await visibleHotelIds(db, a);
    return (await db.query(`SELECT id, name, code, timezone, active, allow_store_to_room AS "allowStoreToRoom", count_week_start AS "countWeekStart", transfer_aging_hours AS "transferAgingHours"
                             FROM hotels WHERE id = ANY($1::uuid[]) ORDER BY code`, [ids])).rows;
  });
  /** All org hotels (id/name only) — needed as transfer destinations. */
  app.get('/hotels/destinations', async (req) => {
    const a = requireActor(req);
    return (await db.query('SELECT id, name, code FROM hotels WHERE organization_id = $1 AND active ORDER BY code', [a.orgId])).rows;
  });
  app.get('/hotels/:hotelId/rooms', async (req) => {
    const a = requireActor(req);
    const hotelId = parse(uuid, (req.params as any).hotelId);
    await requireHotel(db, a, hotelId);
    return (await db.query('SELECT id, room_number AS "roomNumber", floor_name AS "floorName", active FROM rooms WHERE hotel_id = $1 ORDER BY room_number', [hotelId])).rows;
  });
  app.get('/products', async (req) => {
    const a = requireActor(req);
    const r = await db.query(
      `SELECT p.id, p.sku, p.name, p.unit, p.icon, p.active,
              COALESCE(json_agg(json_build_object('locale', al.locale, 'alias', al.alias)) FILTER (WHERE al.id IS NOT NULL), '[]') AS aliases
         FROM products p LEFT JOIN product_aliases al ON al.product_id = p.id WHERE p.organization_id = $1 GROUP BY p.id ORDER BY p.name`, [a.orgId]);
    return r.rows;
  });
  app.get('/hotels/:hotelId/stock', async (req) => {
    const a = requireActor(req);
    const hotelId = parse(uuid, (req.params as any).hotelId);
    await requireHotel(db, a, hotelId);
    return { asOf: new Date().toISOString(), items: await reports.stockMatrix(db, a.orgId, [hotelId]) };
  });
  app.get('/me/stock', async (req) => {
    const a = requireActor(req);
    const hotelId = parse(uuid, Q(req).hotelId);
    await requireHotel(db, a, hotelId);
    const r = await db.query(
      `SELECT p.id AS "productId", p.name, p.unit, p.icon, b.quantity FROM stock_balances b JOIN stock_locations sl ON sl.id = b.location_id JOIN products p ON p.id = b.product_id
        WHERE sl.type='STAFF_BAG' AND sl.hotel_id = $1 AND sl.owner_user_id = $2 AND b.quantity > 0 ORDER BY p.name`, [hotelId, a.userId]);
    return { asOf: new Date().toISOString(), items: r.rows };
  });

  // Admin: owner manages catalog; managers may manage rooms/thresholds of their hotel.
  app.post('/products', async (req, reply) => {
    const a = requireActor(req); requireOwner(a);
    const b = parse(CreateProductBody, req.body);
    const out = await withTx(db, async (tx) => {
      const p = await tx.query('INSERT INTO products (organization_id, sku, name, unit) VALUES ($1,$2,$3,$4) RETURNING id', [a.orgId, b.sku, b.name, b.unit]).catch((e) => {
        if (e.code === '23505') throw err('INVALID_INPUT', 'SKU already exists'); throw e; });
      for (const al of b.aliases) await tx.query('INSERT INTO product_aliases (product_id, locale, alias) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [p.rows[0].id, al.locale, al.alias]);
      await tx.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, details) VALUES ($1,$2,'PRODUCT_CREATED','product',$3,$4)`, [a.orgId, a.userId, p.rows[0].id, JSON.stringify(b)]);
      return { id: p.rows[0].id };
    });
    return reply.code(201).send(out);
  });
  app.patch('/products/:id', async (req) => {
    const a = requireActor(req); requireOwner(a);
    const id = parse(uuid, (req.params as any).id);
    const b = parse(PatchProductBody, req.body);
    await withTx(db, async (tx) => {
      const r = await tx.query(`UPDATE products SET name = COALESCE($3, name), unit = COALESCE($4, unit), active = COALESCE($5, active) WHERE id = $1 AND organization_id = $2`, [id, a.orgId, b.name ?? null, b.unit ?? null, b.active ?? null]);
      if (!r.rowCount) throw err('NOT_FOUND', 'Product not found');
      if (b.aliases) {
        await tx.query('DELETE FROM product_aliases WHERE product_id = $1', [id]);
        for (const al of b.aliases) await tx.query('INSERT INTO product_aliases (product_id, locale, alias) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, al.locale, al.alias]);
      }
      await tx.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, details) VALUES ($1,$2,'PRODUCT_UPDATED','product',$3,$4)`, [a.orgId, a.userId, id, JSON.stringify(b)]);
    });
    return { ok: true };
  });
  app.post('/rooms', async (req, reply) => {
    const a = requireActor(req);
    const b = parse(CreateRoomsBody, req.body);
    await requireHotel(db, a, b.hotelId, ['MANAGER', 'OWNER']);
    if (a.authMethod !== 'PASSWORD') throw err('FORBIDDEN', 'Not allowed');
    let added = 0;
    for (const n of b.roomNumbers) added += (await db.query('INSERT INTO rooms (hotel_id, room_number) VALUES ($1,$2) ON CONFLICT (hotel_id, room_number) DO UPDATE SET active = true RETURNING id', [b.hotelId, n])).rowCount ?? 0;
    return reply.code(201).send({ added });
  });
  app.patch('/rooms/:id', async (req) => {
    const a = requireActor(req);
    const id = parse(uuid, (req.params as any).id);
    const b = parse(z.object({ active: z.boolean() }), req.body);
    const r = await db.query('SELECT hotel_id FROM rooms WHERE id = $1', [id]);
    if (!r.rowCount) throw err('NOT_FOUND', 'Room not found');
    await requireHotel(db, a, r.rows[0].hotel_id, ['MANAGER', 'OWNER']);
    await db.query('UPDATE rooms SET active = $2 WHERE id = $1', [id, b.active]);
    return { ok: true };
  });
  app.patch('/hotels/:hotelId/thresholds/:productId', async (req) => {
    const a = requireActor(req);
    const hotelId = parse(uuid, (req.params as any).hotelId), productId = parse(uuid, (req.params as any).productId);
    await requireHotel(db, a, hotelId, ['MANAGER', 'OWNER']);
    if (a.authMethod !== 'PASSWORD') throw err('FORBIDDEN', 'Not allowed');
    const b = parse(ThresholdBody, req.body);
    await db.query(`INSERT INTO hotel_product_settings (hotel_id, product_id, reorder_threshold, suggested_reorder_qty) VALUES ($1,$2,$3,$4)
                    ON CONFLICT (hotel_id, product_id) DO UPDATE SET reorder_threshold = EXCLUDED.reorder_threshold, suggested_reorder_qty = EXCLUDED.suggested_reorder_qty`,
      [hotelId, productId, b.reorderThreshold, b.suggestedReorderQty ?? 0]);
    return { ok: true };
  });
  app.post('/hotels', async (req, reply) => {
    const a = requireActor(req); requireOwner(a);
    const b = parse(z.object({ name: z.string().min(1).max(80), code: z.string().regex(/^[A-Za-z0-9_-]{1,12}$/), timezone: z.string().default('Asia/Kolkata') }), req.body);
    const r = await db.query('INSERT INTO hotels (organization_id, name, code, timezone) VALUES ($1,$2,$3,$4) RETURNING id', [a.orgId, b.name, b.code, b.timezone]).catch((e) => {
      if (e.code === '23505') throw err('INVALID_INPUT', 'Hotel code already exists'); throw e; });
    return reply.code(201).send({ id: r.rows[0].id });
  });
  app.patch('/hotels/:hotelId', async (req) => {
    const a = requireActor(req); requireOwner(a);
    const hotelId = parse(uuid, (req.params as any).hotelId);
    await requireHotel(db, a, hotelId, ['OWNER']);
    const b = parse(z.object({ name: z.string().min(1).max(80).optional(), allowStoreToRoom: z.boolean().optional(), countWeekStart: z.number().int().min(0).max(6).optional(),
      transferAgingHours: z.number().int().positive().optional(), timezone: z.string().optional() }), req.body);
    await db.query(`UPDATE hotels SET name = COALESCE($2,name), allow_store_to_room = COALESCE($3, allow_store_to_room), count_week_start = COALESCE($4, count_week_start),
                    transfer_aging_hours = COALESCE($5, transfer_aging_hours), timezone = COALESCE($6, timezone) WHERE id = $1`,
      [hotelId, b.name ?? null, b.allowStoreToRoom ?? null, b.countWeekStart ?? null, b.transferAgingHours ?? null, b.timezone ?? null]);
    return { ok: true };
  });

  // Users: owner manages all; managers manage STAFF at their hotel.
  app.get('/users', async (req) => {
    const a = requireActor(req);
    const hotels = await scopeHotels(db, a, optUuid(Q(req).hotelId));
    const r = await db.query(`SELECT u.id, u.employee_code AS "employeeCode", u.display_name AS "displayName", u.active, u.preferred_language AS language,
                                     u.locked_until AS "lockedUntil", json_agg(json_build_object('hotelId', m.hotel_id, 'role', m.role)) AS memberships
                                FROM users u JOIN hotel_memberships m ON m.user_id = u.id WHERE m.hotel_id = ANY($1::uuid[]) GROUP BY u.id ORDER BY u.employee_code`, [hotels]);
    return r.rows;
  });
  app.post('/users', async (req, reply) => {
    const a = requireActor(req);
    const b = parse(CreateUserBody, req.body);
    if (b.role === 'MANAGER') requireOwner(a);
    for (const h of b.hotelIds) await requireHotel(db, a, h, ['MANAGER', 'OWNER']);
    if (a.authMethod !== 'PASSWORD') throw err('FORBIDDEN', 'Not allowed');
    if (b.role === 'STAFF' && !b.pin) throw err('INVALID_INPUT', 'Staff need a PIN');
    if (b.role === 'MANAGER' && !b.password) throw err('INVALID_INPUT', 'Managers need a password (10+ characters)');
    const out = await withTx(db, async (tx) => {
      const u = await tx.query(`INSERT INTO users (organization_id, employee_code, display_name, pin_hash, password_hash, preferred_language) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [a.orgId, b.employeeCode, b.displayName, b.pin ? await hashSecret(b.pin) : null, b.password ? await hashSecret(b.password) : null, b.preferredLanguage]).catch((e) => {
          if (e.code === '23505') throw err('INVALID_INPUT', 'Employee code already exists'); throw e; });
      for (const h of b.hotelIds) await tx.query('INSERT INTO hotel_memberships (user_id, hotel_id, role) VALUES ($1,$2,$3)', [u.rows[0].id, h, b.role]);
      await tx.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, details) VALUES ($1,$2,'USER_CREATED','user',$3,$4)`,
        [a.orgId, a.userId, u.rows[0].id, JSON.stringify({ role: b.role, hotelIds: b.hotelIds })]);
      return { id: u.rows[0].id };
    });
    return reply.code(201).send(out);
  });
  app.patch('/users/:id', async (req) => {
    const a = requireActor(req);
    const id = parse(uuid, (req.params as any).id);
    const b = parse(z.object({ active: z.boolean().optional(), pin: z.string().regex(/^\d{4,8}$/).optional(), password: z.string().min(10).max(200).optional(), unlock: z.boolean().optional(), displayName: z.string().min(1).max(80).optional() }), req.body);
    const m = await db.query('SELECT hotel_id, role FROM hotel_memberships WHERE user_id = $1', [id]);
    if (!m.rowCount) throw err('NOT_FOUND', 'User not found');
    if (m.rows.some((r) => r.role === 'MANAGER')) requireOwner(a);
    else for (const r of m.rows) await requireHotel(db, a, r.hotel_id, ['MANAGER', 'OWNER']);
    if (a.authMethod !== 'PASSWORD') throw err('FORBIDDEN', 'Not allowed');
    await db.query(`UPDATE users SET active = COALESCE($2, active), pin_hash = COALESCE($3, pin_hash), password_hash = COALESCE($4, password_hash),
                    failed_login_count = CASE WHEN $5 THEN 0 ELSE failed_login_count END, locked_until = CASE WHEN $5 THEN NULL ELSE locked_until END,
                    display_name = COALESCE($6, display_name) WHERE id = $1 AND organization_id = $7`,
      [id, b.active ?? null, b.pin ? await hashSecret(b.pin) : null, b.password ? await hashSecret(b.password) : null, !!b.unlock, b.displayName ?? null, a.orgId]);
    if (b.active === false || b.pin || b.password) await revokeUserSessions(db, id);
    await db.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, details) VALUES ($1,$2,'USER_UPDATED','user',$3,$4)`,
      [a.orgId, a.userId, id, JSON.stringify({ active: b.active, pinReset: !!b.pin, passwordReset: !!b.password, unlock: !!b.unlock })]);
    return { ok: true };
  });

  // ---------------- Transactions ----------------
  app.post('/transactions', async (req, reply) => {
    const a = requireActor(req);
    const key = idem(req);
    return send(reply, await createTransaction(db, a, parse(CreateTxBody, req.body), key));
  });
  app.get('/transactions', async (req) => {
    const a = requireActor(req);
    const q = Q(req);
    const hotelIds = q.hotelId && q.hotelId !== 'all' ? [parse(uuid, q.hotelId)] : await visibleHotelIds(db, a);
    for (const h of hotelIds) await requireHotel(db, a, h);
    // Staff only see their own movements; managers/owners see the whole hotel.
    const own = hotelIds.some((h) => !(rolesAt(a, h).has('MANAGER') || rolesAt(a, h).has('OWNER')));
    return reports.activity(db, a.orgId, {
      hotelIds, actorUserId: own ? a.userId : optUuid(q.actorUserId), action: q.action, roomId: optUuid(q.roomId), productId: optUuid(q.productId),
      from: iso(q.from), to: iso(q.to), cursor: q.cursor, limit: Math.min(100, Math.max(1, Number(q.limit ?? 30))),
    });
  });
  app.post('/transactions/:eventId/reversal', async (req, reply) => {
    const a = requireActor(req);
    const key = idem(req);
    const b = parse(ReversalBody, req.body);
    return send(reply, await reverseTransaction(db, a, parse(uuid, (req.params as any).eventId), b.reason, key));
  });
  app.post('/transactions/:eventId/correction-requests', async (req, reply) => {
    const a = requireActor(req);
    const eventId = parse(uuid, (req.params as any).eventId);
    const b = parse(z.object({ note: z.string().min(3).max(500) }), req.body);
    const e = await db.query('SELECT hotel_context_id, actor_user_id FROM inventory_events WHERE id = $1 AND organization_id = $2', [eventId, a.orgId]);
    if (!e.rowCount) throw err('NOT_FOUND', 'Transaction not found');
    await requireHotel(db, a, e.rows[0].hotel_context_id);
    const r = await db.query(`INSERT INTO correction_requests (organization_id, event_id, hotel_id, requested_by, note) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [a.orgId, eventId, e.rows[0].hotel_context_id, a.userId, b.note]);
    return reply.code(201).send({ id: r.rows[0].id, status: 'OPEN' });
  });
  app.get('/correction-requests', async (req) => {
    const a = requireActor(req);
    const hotels = await scopeHotels(db, a, optUuid(Q(req).hotelId));
    return (await db.query(`SELECT cr.id, cr.event_id AS "eventId", cr.note, cr.status, cr.created_at AS "createdAt", u.display_name AS "requestedBy", h.name AS "hotelName"
                              FROM correction_requests cr JOIN users u ON u.id = cr.requested_by JOIN hotels h ON h.id = cr.hotel_id
                             WHERE cr.hotel_id = ANY($1::uuid[]) ORDER BY cr.status, cr.created_at`, [hotels])).rows;
  });
  app.post('/correction-requests/:id/dismiss', async (req) => {
    const a = requireActor(req);
    const id = parse(uuid, (req.params as any).id);
    const r = await db.query('SELECT hotel_id FROM correction_requests WHERE id = $1 AND organization_id = $2', [id, a.orgId]);
    if (!r.rowCount) throw err('NOT_FOUND', 'Not found');
    await requireHotel(db, a, r.rows[0].hotel_id, ['MANAGER', 'OWNER']);
    await db.query(`UPDATE correction_requests SET status='DISMISSED', resolved_by=$2, resolved_at=now() WHERE id=$1 AND status='OPEN'`, [id, a.userId]);
    return { ok: true };
  });

  // ---------------- Transfers ----------------
  app.post('/transfers', async (req, reply) => {
    const a = requireActor(req);
    const key = idem(req);
    return send(reply, await dispatchTransfer(db, a, parse(CreateTransferBody, req.body), key));
  });
  app.get('/transfers', async (req) => {
    const a = requireActor(req);
    const q = Q(req);
    const ids = q.hotelId && q.hotelId !== 'all' ? [parse(uuid, q.hotelId)] : await visibleHotelIds(db, a);
    for (const h of ids) await requireHotel(db, a, h);
    return listTransfers(db, a, ids, q.status);
  });
  app.post('/transfers/:id/receipts', async (req, reply) => {
    const a = requireActor(req);
    const key = idem(req);
    return send(reply, await receiveTransfer(db, a, parse(uuid, (req.params as any).id), parse(ReceiveTransferBody, req.body), key));
  });
  app.post('/transfers/:id/resolve', async (req, reply) => {
    const a = requireActor(req);
    const key = idem(req);
    return send(reply, await resolveTransfer(db, a, parse(uuid, (req.params as any).id), parse(ResolveTransferBody, req.body), key));
  });

  // ---------------- Weekly counts ----------------
  app.post('/counts', async (req, reply) => {
    const a = requireActor(req);
    return reply.code(201).send(await startCount(db, a, parse(StartCountBody, req.body).hotelId));
  });
  app.get('/counts', async (req) => {
    const a = requireActor(req);
    const q = Q(req);
    return listCounts(db, a, await scopeHotels(db, a, optUuid(q.hotelId)), iso(q.from), iso(q.to));
  });
  app.get('/counts/status', async (req) => {
    const a = requireActor(req);
    return reports.countStatus(db, a.orgId, await scopeHotels(db, a, optUuid(Q(req).hotelId)));
  });
  app.get('/counts/:id', async (req) => getCount(db, requireActor(req), parse(uuid, (req.params as any).id)));
  app.patch('/counts/:id/lines', async (req) => patchCountLines(db, requireActor(req), parse(uuid, (req.params as any).id), parse(PatchCountLinesBody, req.body).lines));
  app.post('/counts/:id/refresh', async (req) => refreshCount(db, requireActor(req), parse(uuid, (req.params as any).id)));
  app.post('/counts/:id/cancel', async (req) => cancelCount(db, requireActor(req), parse(uuid, (req.params as any).id)));
  app.post('/counts/:id/submit', async (req, reply) => {
    const a = requireActor(req);
    const key = idem(req);
    const b = parse(z.object({ note: z.string().max(500).optional() }), req.body ?? {});
    return send(reply, await submitCount(db, a, parse(uuid, (req.params as any).id), key, b.note));
  });

  // ---------------- Dashboards (manager/owner) ----------------
  app.get('/dashboard/overview', async (req) => {
    const a = requireActor(req);
    const q = Q(req);
    const ids = await scopeHotels(db, a, optUuid(q.hotelId));
    return reports.overview(db, a.orgId, ids, periodDays(q.periodDays), !q.hotelId || q.hotelId === 'all');
  });
  app.get('/dashboard/availability', async (req) => {
    const a = requireActor(req);
    return { asOf: new Date().toISOString(), items: await reports.stockMatrix(db, a.orgId, await scopeHotels(db, a, optUuid(Q(req).hotelId))) };
  });
  app.get('/dashboard/room-placements', async (req) => {
    const a = requireActor(req);
    const q = Q(req);
    const to = q.to ? new Date(iso(q.to)!) : new Date();
    const from = q.from ? new Date(iso(q.from)!) : new Date(to.getTime() - periodDays(q.periodDays) * 86_400_000);
    return { asOf: new Date().toISOString(), ...(await reports.roomPlacements(db, a.orgId, await scopeHotels(db, a, optUuid(q.hotelId)), from, to, optUuid(q.roomId), optUuid(q.productId))) };
  });
  app.get('/dashboard/transfers', async (req) => {
    const a = requireActor(req);
    return { asOf: new Date().toISOString(), items: await listTransfers(db, a, await scopeHotels(db, a, optUuid(Q(req).hotelId)), Q(req).status) };
  });
  app.get('/dashboard/verifications', async (req) => {
    const a = requireActor(req);
    const ids = await scopeHotels(db, a, optUuid(Q(req).hotelId));
    return { asOf: new Date().toISOString(), status: await reports.countStatus(db, a.orgId, ids), recent: (await listCounts(db, a, ids)).slice(0, 30) };
  });
  app.get('/dashboard/alerts', async (req) => {
    const a = requireActor(req);
    return { asOf: new Date().toISOString(), items: await reports.alerts(db, a, await scopeHotels(db, a, optUuid(Q(req).hotelId))) };
  });
  app.get('/dashboard/voice-usage', async (req) => {
    const a = requireActor(req); requireOwner(a);
    return { model: cfg.GEMINI_MODEL, provider: provider?.name ?? 'disabled', dailyLimitUsd: cfg.VOICE_DAILY_LIMIT_USD, days: await voiceUsage(db, a.orgId, 30) };
  });
  app.get('/dashboard/voice-health', async (req) => {
    const a = requireActor(req); requireOwner(a);
    const days = Math.min(90, Math.max(1, Number(Q(req).days ?? 7) || 7));
    return { provider: provider?.name ?? 'disabled', model: cfg.GEMINI_MODEL, days, ...(await voiceHealth(db, a.orgId, days)) };
  });
  app.get('/reports/stock-events.csv', async (req, reply) => {
    const a = requireActor(req);
    const q = Q(req);
    const csv = await reports.stockEventsCsv(db, a.orgId, await scopeHotels(db, a, optUuid(q.hotelId)), iso(q.from), iso(q.to));
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="stockwise-events.csv"').send(csv);
  });
  app.get('/reports/counts.csv', async (req, reply) => {
    const a = requireActor(req);
    const csv = await reports.countsCsv(db, a.orgId, await scopeHotels(db, a, optUuid(Q(req).hotelId)));
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="stockwise-counts.csv"').send(csv);
  });

  // ---------------- Voice ----------------
  app.post('/voice/interpret', { config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => (req as any).actor?.userId ?? req.ip } } }, async (req) => {
    const a = requireActor(req);
    if (!req.isMultipart()) throw err('INVALID_INPUT', 'multipart/form-data expected');
    const fields: Record<string, string> = {};
    let audio: Buffer | null = null, mime = '';
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'audio') { await part.toBuffer(); continue; }
        audio = await part.toBuffer(); // in-memory only; never persisted
        mime = part.mimetype;
      } else fields[part.fieldname] = String(part.value);
    }
    if (!audio) throw err('UNSUPPORTED_AUDIO', 'No recording received');
    return interpret(db, cfg, provider, a, {
      audio, mimeType: mime, hotelId: parse(uuid, fields.hotelId),
      preferredLanguage: fields.preferredLanguage, durationMs: fields.durationMs ? Number(fields.durationMs) : undefined, scopeAll: fields.scope === 'all',
      client: fields.client, heardText: fields.heard?.slice(0, 500),
    });
  });
}
