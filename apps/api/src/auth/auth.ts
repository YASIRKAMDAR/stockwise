import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { Config } from '../config.ts';
import type { Db } from '../db/pool.ts';
import { withTx } from '../db/pool.ts';
import { err } from '../errors.ts';
import type { Actor } from '../services/actor.ts';

const ARGON = { algorithm: 2 as const, // Argon2id
  memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashSecret = (s: string) => argonHash(s, ARGON);
export const verifySecret = (h: string, s: string) => argonVerify(h, s).catch(() => false);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
// Constant-ish work for unknown users to reduce user-enumeration timing signal.
let DUMMY: string | null = null;
const dummyHash = async () => (DUMMY ??= await hashSecret('dummy-' + randomBytes(8).toString('hex')));

export const SESSION_COOKIE = 'sw_session';

async function audit(db: Db, orgId: string | null, userId: string | null, action: string, details: object) {
  if (!orgId) return;
  await db.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,'user',$2,$4)`, [orgId, userId, action, JSON.stringify(details)]);
}

async function createSession(db: Db, cfg: Config, userId: string, method: 'PIN' | 'PASSWORD', deviceId: string | null, hotelId: string | null) {
  const token = randomBytes(32).toString('base64url');
  const ttlH = method === 'PIN' ? cfg.SESSION_TTL_HOURS_PIN : cfg.SESSION_TTL_HOURS_PASSWORD;
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, device_id, active_hotel_id, auth_method, expires_at) VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' hours')::interval)`,
    [sha256(cfg.SESSION_SECRET + token), userId, deviceId, hotelId, method, String(ttlH)],
  );
  return { token, maxAgeSeconds: ttlH * 3600 };
}

async function checkLock(db: Db, cfg: Config, user: any, ok: boolean) {
  if (user.locked_until && new Date(user.locked_until) > new Date()) throw err('ACCOUNT_LOCKED', 'Too many attempts. Try again later or ask a manager.');
  if (ok) {
    await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);
    return;
  }
  const r = await db.query(
    `UPDATE users SET failed_login_count = failed_login_count + 1,
       locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE NULL END
     WHERE id = $1 RETURNING failed_login_count`,
    [user.id, cfg.LOGIN_MAX_FAILURES, String(cfg.LOGIN_LOCK_MINUTES)],
  );
  await audit(db, user.organization_id, user.id, 'LOGIN_FAILED', { failures: r.rows[0].failed_login_count });
}

/** Staff PIN login: only from an enrolled, non-revoked device; session pinned to the device's hotel. */
export async function staffLogin(db: Db, cfg: Config, b: { employeeCode: string; pin: string; deviceId?: string; deviceSecret?: string; hotelId?: string }) {
  if (!b.deviceId || !b.deviceSecret) return staffLoginNoDevice(db, cfg, b);
  const d = await db.query('SELECT id, organization_id, hotel_id, secret_hash, revoked_at FROM devices WHERE id = $1', [b.deviceId]);
  const dev = d.rows[0];
  if (!dev || dev.revoked_at || !timingSafeEqual(Buffer.from(dev.secret_hash), Buffer.from(sha256(b.deviceSecret)))) {
    throw err('DEVICE_NOT_ENROLLED', 'This device is not enrolled. Ask your manager to set it up.');
  }
  const u = await db.query(
    `SELECT u.* FROM users u JOIN hotel_memberships m ON m.user_id = u.id AND m.hotel_id = $3 AND m.role = 'STAFF'
      WHERE u.organization_id = $1 AND u.employee_code = $2 AND u.active`,
    [dev.organization_id, b.employeeCode, dev.hotel_id],
  );
  const user = u.rows[0];
  if (!user || !user.pin_hash) {
    await verifySecret(await dummyHash(), b.pin);
    throw err('UNAUTHENTICATED', 'Employee code or PIN is incorrect');
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) throw err('ACCOUNT_LOCKED', 'Too many attempts. Try again later or ask a manager.');
  const ok = await verifySecret(user.pin_hash, b.pin);
  await checkLock(db, cfg, user, ok);
  if (!ok) throw err('UNAUTHENTICATED', 'Employee code or PIN is incorrect');
  await db.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [dev.id]);
  await audit(db, user.organization_id, user.id, 'LOGIN_PIN', { deviceId: dev.id });
  return createSession(db, cfg, user.id, 'PIN', dev.id, dev.hotel_id);
}

/** Staff sign-in with employee code + passcode on any phone (no manager setup). Protected by the same lockout as passwords. */
async function staffLoginNoDevice(db: Db, cfg: Config, b: { employeeCode: string; pin: string; hotelId?: string }) {
  const u = await db.query(
    `SELECT u.* FROM users u WHERE u.employee_code = $1 AND u.active AND u.pin_hash IS NOT NULL
        AND EXISTS (SELECT 1 FROM hotel_memberships m WHERE m.user_id = u.id AND m.role = 'STAFF')`, [b.employeeCode]);
  if (u.rowCount !== 1) {
    await verifySecret(await dummyHash(), b.pin);
    throw err('UNAUTHENTICATED', 'Employee code or passcode is incorrect');
  }
  const user = u.rows[0];
  if (user.locked_until && new Date(user.locked_until) > new Date()) throw err('ACCOUNT_LOCKED', 'Too many attempts. Try again in 15 minutes or ask a manager.');
  const ok = await verifySecret(user.pin_hash, b.pin);
  await checkLock(db, cfg, user, ok);
  if (!ok) throw err('UNAUTHENTICATED', 'Employee code or passcode is incorrect');
  const m = await db.query(
    `SELECT m.hotel_id FROM hotel_memberships m JOIN hotels h ON h.id = m.hotel_id WHERE m.user_id = $1 AND m.role = 'STAFF' AND h.active ORDER BY h.code`, [user.id]);
  const hotels = m.rows.map((r) => r.hotel_id as string);
  const hotelId = b.hotelId && hotels.includes(b.hotelId) ? b.hotelId : hotels[0];
  if (!hotelId) throw err('FORBIDDEN', 'You are not assigned to a hotel yet. Ask your manager.');
  await audit(db, user.organization_id, user.id, 'LOGIN_PIN', { device: null });
  return createSession(db, cfg, user.id, 'PIN', null, hotelId);
}

/** Manager/owner password login (min 10 chars, argon2id, lockout). TOTP is listed in remaining work. */
export async function passwordLogin(db: Db, cfg: Config, b: { employeeCode: string; password: string }) {
  const u = await db.query(`SELECT * FROM users WHERE employee_code = $1 AND active AND password_hash IS NOT NULL`, [b.employeeCode]);
  if (u.rowCount !== 1) {
    await verifySecret(await dummyHash(), b.password);
    throw err('UNAUTHENTICATED', 'Login details are incorrect');
  }
  const user = u.rows[0];
  if (user.locked_until && new Date(user.locked_until) > new Date()) throw err('ACCOUNT_LOCKED', 'Too many attempts. Try again later.');
  const ok = await verifySecret(user.password_hash, b.password);
  await checkLock(db, cfg, user, ok);
  if (!ok) throw err('UNAUTHENTICATED', 'Login details are incorrect');
  const isPrivileged = user.org_role === 'OWNER' || (await db.query(`SELECT 1 FROM hotel_memberships WHERE user_id=$1 AND role='MANAGER'`, [user.id])).rowCount;
  if (!isPrivileged) throw err('FORBIDDEN', 'Staff sign in with their PIN on an enrolled device');
  const m = await db.query(`SELECT hotel_id FROM hotel_memberships WHERE user_id=$1 ORDER BY hotel_id LIMIT 1`, [user.id]);
  await audit(db, user.organization_id, user.id, 'LOGIN_PASSWORD', {});
  return createSession(db, cfg, user.id, 'PASSWORD', null, m.rows[0]?.hotel_id ?? null);
}

export async function loadActor(db: Db, cfg: Config, token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const s = await db.query(
    `SELECT s.id, s.user_id, s.device_id, s.active_hotel_id, s.auth_method, u.organization_id, u.display_name, u.employee_code, u.org_role, u.preferred_language
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN devices d ON d.id = s.device_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active
        AND (s.device_id IS NULL OR d.revoked_at IS NULL)`,
    [sha256(cfg.SESSION_SECRET + token)],
  );
  const row = s.rows[0];
  if (!row) return null;
  const m = await db.query('SELECT hotel_id, role FROM hotel_memberships WHERE user_id = $1', [row.user_id]);
  db.query('UPDATE sessions SET last_used_at = now() WHERE id = $1', [row.id]).catch(() => {});
  return {
    userId: row.user_id, orgId: row.organization_id, displayName: row.display_name, employeeCode: row.employee_code,
    isOwner: row.org_role === 'OWNER', memberships: m.rows.map((x) => ({ hotelId: x.hotel_id, role: x.role })),
    sessionId: row.id, deviceId: row.device_id, authMethod: row.auth_method, activeHotelId: row.active_hotel_id, preferredLanguage: row.preferred_language,
  };
}

export async function logout(db: Db, cfg: Config, token: string) {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(cfg.SESSION_SECRET + token)]);
}

export async function enrollDevice(db: Db, actor: Actor, hotelId: string, label: string) {
  const secret = randomBytes(32).toString('base64url');
  const r = await db.query(
    `INSERT INTO devices (organization_id, hotel_id, label, secret_hash, enrolled_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, enrolled_at`,
    [actor.orgId, hotelId, label, sha256(secret), actor.userId],
  );
  await db.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, details) VALUES ($1,$2,'DEVICE_ENROLLED','device',$3,$4)`,
    [actor.orgId, actor.userId, r.rows[0].id, JSON.stringify({ hotelId, label })]);
  return { deviceId: r.rows[0].id as string, deviceSecret: secret, hotelId, label };
}

export async function revokeDevice(db: Db, actor: Actor, deviceId: string) {
  return withTx(db, async (tx) => {
    const r = await tx.query('UPDATE devices SET revoked_at = now() WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL RETURNING hotel_id', [deviceId, actor.orgId]);
    if (!r.rowCount) throw err('NOT_FOUND', 'Device not found or already revoked');
    await tx.query('UPDATE sessions SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL', [deviceId]);
    await tx.query(`INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id) VALUES ($1,$2,'DEVICE_REVOKED','device',$3)`, [actor.orgId, actor.userId, deviceId]);
    return r.rows[0].hotel_id as string;
  });
}

export async function revokeUserSessions(db: Db, userId: string) {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}
