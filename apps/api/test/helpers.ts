import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Db } from '../src/db/pool.ts';
import { createHotel, createOrg, createProduct, createRooms, createUser, DEMO_PRODUCTS, systemActor } from '../src/db/fixtures.ts';
import { enrollDevice } from '../src/auth/auth.ts';
import { FakeProvider } from '../src/voice/provider.ts';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/stockwise_test';
export const PW = 'test-password-123';

export interface World {
  app: FastifyInstance; db: Db; orgId: string;
  h: string[]; rooms: Record<string, string>[]; p: Record<string, string>;
  ownerId: string; mgr: string[]; staff: Record<string, string>; devices: { deviceId: string; deviceSecret: string }[];
}

export async function setupWorld(): Promise<World> {
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DB, SESSION_SECRET: 'x'.repeat(40), VOICE_PROVIDER: 'fake', LOGIN_MAX_FAILURES: '5', AUTH_RATE_LIMIT_PER_MIN: '1000' });
  const db = createPool(TEST_DB);
  const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'`)).rows.map((r) => r.tablename);
  await db.query(`TRUNCATE ${tables.join(',')} RESTART IDENTITY CASCADE`);
  const orgId = await createOrg(db, 'Test Org');
  const h = [await createHotel(db, orgId, 'H1', 'Hotel 1'), await createHotel(db, orgId, 'H2', 'Hotel 2'), await createHotel(db, orgId, 'H3', 'Hotel 3')];
  const rooms = [];
  for (const id of h) rooms.push(await createRooms(db, id, ['101', '102', '103', '201', '202', '203']));
  const p: Record<string, string> = {};
  for (const [sku, name, unit, aliases] of DEMO_PRODUCTS) p[sku] = await createProduct(db, orgId, sku, name, unit, aliases);
  const ownerId = await createUser(db, orgId, { code: 'OWNER', name: 'Owner', password: PW, owner: true });
  const mgr = [];
  for (let i = 0; i < 3; i++) mgr.push(await createUser(db, orgId, { code: `MGR${i + 1}`, name: `Mgr ${i + 1}`, password: PW, memberships: [{ hotelId: h[i], role: 'MANAGER' }] }));
  const staff: Record<string, string> = {};
  for (const [code, hi] of [['S1A', 0], ['S1B', 0], ['S2A', 1], ['S3A', 2]] as const)
    staff[code] = await createUser(db, orgId, { code, name: code, pin: '1234', memberships: [{ hotelId: h[hi], role: 'STAFF' }] });
  const owner = systemActor(orgId, ownerId);
  const devices = [];
  for (const id of h) devices.push(await enrollDevice(db, owner, id, 'test'));
  const app = await buildApp({ db, cfg, voice: new FakeProvider() });
  return { app, db, orgId, h, rooms, p, ownerId, mgr, staff, devices };
}

export class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}
  async req(method: string, url: string, body?: unknown, opts: { key?: string | null; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { 'x-requested-with': 'stockwise', ...(opts.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    if (method !== 'GET' && opts.key !== null) headers['idempotency-key'] = opts.key ?? randomUUID();
    const res = await this.app.inject({ method: method as any, url: '/api/v1' + url, payload: body as any, headers });
    const sc = res.headers['set-cookie'];
    if (sc) this.cookie = (Array.isArray(sc) ? sc[0] : sc).split(';')[0];
    let json: any = null;
    try { json = res.json(); } catch { json = res.body; }
    return { status: res.statusCode, body: json, headers: res.headers };
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b?: unknown, o?: { key?: string | null }) => this.req('POST', u, b ?? {}, o);
}

export async function staffClient(w: World, code: string, hotelIdx: number) {
  const c = new Client(w.app);
  const r = await c.post('/auth/staff-login', { employeeCode: code, pin: '1234', ...w.devices[hotelIdx] }, { key: null });
  if (r.status !== 200) throw new Error('staff login failed ' + JSON.stringify(r.body));
  return c;
}
export async function pwClient(w: World, code: string) {
  const c = new Client(w.app);
  const r = await c.post('/auth/login', { employeeCode: code, password: PW }, { key: null });
  if (r.status !== 200) throw new Error('login failed ' + JSON.stringify(r.body));
  return c;
}

/** Store / bag / room-placement totals straight from the DB for assertions. */
export async function bal(w: World, hotelIdx: number, sku: string, userId?: string) {
  const r = await w.db.query(
    `SELECT COALESCE(sum(b.quantity),0)::int AS q FROM stock_balances b JOIN stock_locations sl ON sl.id=b.location_id
      WHERE sl.hotel_id=$1 AND b.product_id=$2 AND sl.type = $3 AND ($4::uuid IS NULL OR sl.owner_user_id=$4)`,
    [w.h[hotelIdx], w.p[sku], userId ? 'STAFF_BAG' : 'HOTEL_STORE', userId ?? null]);
  return r.rows[0].q as number;
}
export async function placed(w: World, hotelIdx: number, sku: string) {
  const r = await w.db.query(`SELECT COALESCE(sum(l.quantity),0)::int q FROM inventory_event_lines l JOIN inventory_events e ON e.id=l.event_id
     WHERE e.action='PLACE_IN_ROOM' AND e.hotel_context_id=$1 AND l.product_id=$2 AND NOT EXISTS (SELECT 1 FROM inventory_events r WHERE r.reversal_of_event_id=e.id)`, [w.h[hotelIdx], w.p[sku]]);
  return r.rows[0].q as number;
}
export async function transit(w: World, transferId: string, sku: string) {
  const r = await w.db.query(`SELECT COALESCE(sum(b.quantity),0)::int q FROM stock_balances b JOIN stock_locations sl ON sl.id=b.location_id WHERE sl.transfer_id=$1 AND b.product_id=$2`, [transferId, w.p[sku]]);
  return r.rows[0].q as number;
}
export async function eventCount(w: World) {
  return (await w.db.query('SELECT count(*)::int n FROM inventory_events')).rows[0].n as number;
}
/** Every balance must equal the sum of its ledger lines (projection integrity). */
export async function ledgerMatchesBalances(w: World) {
  const r = await w.db.query(`
    WITH led AS (
      SELECT loc, product_id, sum(q)::int q FROM (
        SELECT to_location_id loc, product_id, quantity q FROM inventory_event_lines WHERE to_location_id IS NOT NULL
        UNION ALL SELECT from_location_id, product_id, -quantity FROM inventory_event_lines WHERE from_location_id IS NOT NULL) x GROUP BY loc, product_id)
    SELECT count(*)::int AS mismatches FROM stock_balances b FULL JOIN led ON led.loc=b.location_id AND led.product_id=b.product_id
     WHERE COALESCE(b.quantity,0) <> COALESCE(led.q,0)`);
  return r.rows[0].mismatches as number;
}

export function multipart(fields: Record<string, string>, text: string, mime = 'text/plain') {
  const boundary = '----sw' + Math.random().toString(16).slice(2);
  const parts = Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: ${mime}\r\n\r\n${text}\r\n--${boundary}--\r\n`);
  return { body: Buffer.from(parts.join('')), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
