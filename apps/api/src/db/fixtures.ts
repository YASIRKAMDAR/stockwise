/** Building blocks for bootstrap, demo seed and tests. Opening stock goes through the ledger, never direct balance inserts. */
import { hashSecret } from '../auth/auth.ts';
import type { Db } from './pool.ts';
import type { Actor } from '../services/actor.ts';

export async function createOrg(db: Db, name: string) {
  return (await db.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id as string;
}
export async function createHotel(db: Db, orgId: string, code: string, name: string, tz = 'Asia/Kolkata') {
  return (await db.query('INSERT INTO hotels (organization_id, code, name, timezone) VALUES ($1,$2,$3,$4) RETURNING id', [orgId, code, name, tz])).rows[0].id as string;
}
export async function createRooms(db: Db, hotelId: string, numbers: string[]) {
  const out: Record<string, string> = {};
  for (const n of numbers) out[n] = (await db.query('INSERT INTO rooms (hotel_id, room_number) VALUES ($1,$2) RETURNING id', [hotelId, n])).rows[0].id;
  return out;
}
export async function createProduct(db: Db, orgId: string, sku: string, name: string, unit: string, aliases: [string, string][] = []) {
  const id = (await db.query('INSERT INTO products (organization_id, sku, name, unit) VALUES ($1,$2,$3,$4) RETURNING id', [orgId, sku, name, unit])).rows[0].id as string;
  for (const [locale, alias] of aliases) await db.query('INSERT INTO product_aliases (product_id, locale, alias) VALUES ($1,$2,$3)', [id, locale, alias]);
  return id;
}
export async function createUser(db: Db, orgId: string, o: { code: string; name: string; pin?: string; password?: string; owner?: boolean; memberships?: { hotelId: string; role: 'STAFF' | 'MANAGER' }[]; lang?: string }) {
  const id = (await db.query(
    'INSERT INTO users (organization_id, employee_code, display_name, pin_hash, password_hash, org_role, preferred_language) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [orgId, o.code, o.name, o.pin ? await hashSecret(o.pin) : null, o.password ? await hashSecret(o.password) : null, o.owner ? 'OWNER' : null, o.lang ?? 'en'],
  )).rows[0].id as string;
  for (const m of o.memberships ?? []) await db.query('INSERT INTO hotel_memberships (user_id, hotel_id, role) VALUES ($1,$2,$3)', [id, m.hotelId, m.role]);
  return id;
}
export function systemActor(orgId: string, userId: string, opts: Partial<Actor> = {}): Actor {
  return { userId, orgId, displayName: 'system', employeeCode: 'system', isOwner: true, memberships: [], sessionId: null, deviceId: null,
    authMethod: 'PASSWORD', activeHotelId: null, preferredLanguage: 'en', ...opts };
}

export const DEMO_PRODUCTS: [string, string, string, [string, string][]][] = [
  ['SOAP', 'Soap', 'pcs', [['en', 'soap'], ['hi', 'sabun'], ['hi', 'साबुन'], ['gu', 'સાબુ']]],
  ['SHAMPOO', 'Shampoo', 'bottles', [['en', 'shampoo'], ['hi', 'shampu'], ['hi', 'शैम्पू'], ['hi', 'शैंपू'], ['gu', 'શેમ્પૂ']]],
  ['COMB', 'Comb', 'pcs', [['en', 'comb'], ['hi', 'kanghi'], ['hi', 'कंघी'], ['gu', 'કાંસકો']]],
  ['DENTAL_KIT', 'Dental kit', 'kits', [['en', 'dental kit'], ['hi', 'डेंटल किट'], ['hi', 'ब्रश किट'], ['gu', 'ડેન્ટલ કિટ'], ['en', 'paste']]],
  ['TOOTHBRUSH', 'Toothbrush', 'pcs', [['en', 'toothbrush'], ['hi', 'brush'], ['hi', 'ब्रश'], ['gu', 'બ્રશ']]],
  ['TOOTHPASTE', 'Toothpaste', 'tubes', [['en', 'toothpaste'], ['en', 'paste'], ['hi', 'पेस्ट'], ['gu', 'પેસ્ટ']]],
];
