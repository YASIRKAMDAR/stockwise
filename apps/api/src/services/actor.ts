import type { Db, Tx } from '../db/pool.ts';
import { err } from '../errors.ts';

export type HotelRole = 'STAFF' | 'MANAGER' | 'OWNER';

export interface Actor {
  userId: string;
  orgId: string;
  displayName: string;
  employeeCode: string;
  isOwner: boolean;
  memberships: { hotelId: string; role: 'STAFF' | 'MANAGER' }[];
  sessionId: string | null;
  deviceId: string | null;
  authMethod: 'PIN' | 'PASSWORD';
  activeHotelId: string | null;
  preferredLanguage: string;
}

/**
 * Roles the actor holds at a hotel. PIN (shared-device) sessions are pinned to the
 * session's active hotel only, so a staff member can't act on other hotels from a device
 * enrolled elsewhere, even if they hold memberships there.
 */
export function rolesAt(actor: Actor, hotelId: string): Set<HotelRole> {
  const out = new Set<HotelRole>();
  if (actor.authMethod === 'PIN' && actor.activeHotelId !== hotelId) return out;
  if (actor.isOwner) out.add('OWNER');
  for (const m of actor.memberships) if (m.hotelId === hotelId) out.add(m.role);
  return out;
}

/** Ensures hotel belongs to actor's org and actor has one of the roles there. Never trusts client hotelId alone. */
export async function requireHotel(db: Db | Tx, actor: Actor, hotelId: string, roles: HotelRole[] = ['STAFF', 'MANAGER', 'OWNER']) {
  const h = await db.query('SELECT id, name, code, timezone, active, allow_store_to_room, transfer_aging_hours FROM hotels WHERE id = $1 AND organization_id = $2', [hotelId, actor.orgId]);
  if (!h.rowCount) throw err('HOTEL_NOT_ALLOWED', 'You do not have access to this hotel');
  const held = rolesAt(actor, hotelId);
  if (!roles.some((r) => held.has(r))) throw err('HOTEL_NOT_ALLOWED', 'You do not have access to this hotel for this action');
  return h.rows[0] as { id: string; name: string; code: string; timezone: string; active: boolean; allow_store_to_room: boolean; transfer_aging_hours: number };
}

export function requireOwner(actor: Actor) {
  if (!actor.isOwner || actor.authMethod !== 'PASSWORD') throw err('FORBIDDEN', 'Owner access required');
}

/** Hotels visible to the actor for read views. */
export async function visibleHotelIds(db: Db | Tx, actor: Actor): Promise<string[]> {
  if (actor.isOwner && actor.authMethod === 'PASSWORD') {
    const r = await db.query('SELECT id FROM hotels WHERE organization_id = $1 AND active ORDER BY code', [actor.orgId]);
    return r.rows.map((x) => x.id);
  }
  if (actor.authMethod === 'PIN') return actor.activeHotelId ? [actor.activeHotelId] : [];
  return [...new Set(actor.memberships.map((m) => m.hotelId))];
}

/** Resolves `hotelId=all|<uuid>` query param into a scoped list. */
export async function scopeHotels(db: Db | Tx, actor: Actor, hotelId: string | undefined, roles: HotelRole[] = ['MANAGER', 'OWNER']) {
  const visible = await visibleHotelIds(db, actor);
  if (!hotelId || hotelId === 'all') {
    const allowed = visible.filter((h) => roles.some((r) => rolesAt(actor, h).has(r)));
    if (!allowed.length) throw err('FORBIDDEN', 'No hotels available for this report');
    return allowed;
  }
  await requireHotel(db, actor, hotelId, roles);
  return [hotelId];
}
