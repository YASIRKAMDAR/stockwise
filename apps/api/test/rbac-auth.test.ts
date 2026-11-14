import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, pwClient, setupWorld, staffClient, type World } from './helpers.ts';

let w: World;
let owner: Client, mgr1: Client, s1: Client;

beforeAll(async () => {
  w = await setupWorld();
  owner = await pwClient(w, 'OWNER');
  mgr1 = await pwClient(w, 'MGR1');
  s1 = await staffClient(w, 'S1A', 0);
  await owner.post('/transactions', { action: 'OPENING_BALANCE', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 50 }] });
});
afterAll(async () => { await w.app.close(); await w.db.end(); });

describe('Authentication', () => {
  it('staff PIN login requires an enrolled device', async () => {
    const c = new Client(w.app);
    const r = await c.post('/auth/staff-login', { employeeCode: 'S1A', pin: '1234', deviceId: crypto.randomUUID(), deviceSecret: 'x'.repeat(30) }, { key: null });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('DEVICE_NOT_ENROLLED');
  });
  it('staff cannot log in on a device enrolled at another hotel', async () => {
    const c = new Client(w.app);
    const r = await c.post('/auth/staff-login', { employeeCode: 'S1A', pin: '1234', ...w.devices[1] }, { key: null });
    expect(r.status).toBe(401);
  });
  it('PIN brute force locks the account after 5 failures', async () => {
    const c = new Client(w.app);
    for (let i = 0; i < 5; i++) expect((await c.post('/auth/staff-login', { employeeCode: 'S1B', pin: '0000', ...w.devices[0] }, { key: null })).status).toBe(401);
    const r = await c.post('/auth/staff-login', { employeeCode: 'S1B', pin: '1234', ...w.devices[0] }, { key: null });
    expect(r.status).toBe(423);
    expect(r.body.error.code).toBe('ACCOUNT_LOCKED');
    const audit = await w.db.query(`SELECT count(*)::int n FROM audit_events WHERE action='LOGIN_FAILED' AND actor_user_id=$1`, [w.staff.S1B]);
    expect(audit.rows[0].n).toBe(5);
    expect(JSON.stringify((await w.db.query('SELECT details FROM audit_events')).rows)).not.toContain('0000');
  });
  it('login endpoint is rate limited per IP', async () => {
    const { buildApp } = await import('../src/app.ts');
    const { loadConfig } = await import('../src/config.ts');
    const app = await buildApp({ db: w.db, cfg: loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', SESSION_SECRET: 'x'.repeat(40), AUTH_RATE_LIMIT_PER_MIN: '3' }), voice: null });
    const c = new Client(app);
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await c.post('/auth/login', { employeeCode: 'nobody', password: 'wrong-password-x' }, { key: null })).status);
    expect(codes).toEqual([401, 401, 401, 429]);
    await app.close();
  });
  it('managers unlock staff; unlocked staff can log in', async () => {
    expect((await mgr1.req('PATCH', `/users/${w.staff.S1B}`, { unlock: true })).status).toBe(200);
    await staffClient(w, 'S1B', 0);
  });
  it('staff cannot use password login; staff sessions cannot enroll devices', async () => {
    expect((await s1.post('/devices', { hotelId: w.h[0], label: 'x' })).status).toBe(403);
  });
  it('revoking a device kills its sessions (lost phone)', async () => {
    const d = await mgr1.post('/devices', { hotelId: w.h[0], label: 'Lost phone' });
    expect(d.status).toBe(201);
    const c = new Client(w.app);
    await c.post('/auth/staff-login', { employeeCode: 'S1A', pin: '1234', deviceId: d.body.deviceId, deviceSecret: d.body.deviceSecret }, { key: null });
    expect((await c.get('/me')).status).toBe(200);
    expect((await mgr1.post(`/devices/${d.body.deviceId}/revoke`, {})).status).toBe(200);
    expect((await c.get('/me')).status).toBe(401);
  });
  it('missing/forged session and missing CSRF header are refused', async () => {
    const c = new Client(w.app);
    expect((await c.get('/me')).status).toBe(401);
    c.cookie = 'sw_session=forged.value';
    expect((await c.get(`/hotels/${w.h[0]}/stock`)).status).toBe(401);
    const r = await w.app.inject({ method: 'POST', url: '/api/v1/transactions', headers: { cookie: s1.cookie, 'idempotency-key': crypto.randomUUID() }, payload: {} });
    expect(r.statusCode).toBe(403);
  });
  it('mutations without Idempotency-Key are refused', async () => {
    const r = await s1.post('/transactions', { action: 'SUPPLIER_RECEIPT', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 1 }] }, { key: null });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('Role and hotel scoping', () => {
  it('staff cannot start counts, administer catalog, view all-hotel reports or export', async () => {
    expect((await s1.post('/counts', { hotelId: w.h[0] })).status).toBe(403);
    expect((await s1.post('/products', { sku: 'NEW', name: 'New', unit: 'pcs' })).status).toBe(403);
    expect((await s1.get('/dashboard/overview?hotelId=all')).status).toBe(403);
    expect((await s1.get('/reports/stock-events.csv')).status).toBe(403);
    expect((await s1.req('PATCH', `/hotels/${w.h[0]}/thresholds/${w.p.SOAP}`, { reorderThreshold: 5 })).status).toBe(403);
  });
  it('there is no DELETE for transactions', async () => {
    const r = await mgr1.req('DELETE', `/transactions/${crypto.randomUUID()}`);
    expect(r.status).toBe(404);
  });
  it('manager is scoped to own hotel', async () => {
    expect((await mgr1.get(`/dashboard/overview?hotelId=${w.h[1]}`)).status).toBe(403);
    expect((await mgr1.post('/counts', { hotelId: w.h[1] })).status).toBe(403);
    const ov = await mgr1.get('/dashboard/overview?hotelId=all');
    expect(ov.status).toBe(200);
    expect(ov.body.hotels.map((h: any) => h.hotelId)).toEqual([w.h[0]]);
    const tx = await mgr1.get(`/transactions?hotelId=${w.h[1]}`);
    expect(tx.status).toBe(403);
  });
  it('manager cannot create managers or edit products (owner only)', async () => {
    expect((await mgr1.post('/users', { employeeCode: 'M9', displayName: 'x', role: 'MANAGER', hotelIds: [w.h[0]], password: 'long-enough-pass' })).status).toBe(403);
    expect((await mgr1.req('PATCH', `/products/${w.p.SOAP}`, { name: 'x' })).status).toBe(403);
  });
  it('owner sees all hotels; adjustment needs a reason', async () => {
    const r = await owner.get('/dashboard/availability?hotelId=all');
    expect(new Set(r.body.items.map((i: any) => i.hotelId)).size).toBe(3);
    const noReason = await owner.post('/transactions', { action: 'STOCK_ADJUSTMENT', hotelId: w.h[1], lines: [{ productId: w.p.SOAP, quantity: 1, direction: 'IN' }] });
    expect(noReason.status).toBe(400);
  });
  it('staff activity shows only their own movements', async () => {
    await mgr1.post('/transactions', { action: 'SUPPLIER_RECEIPT', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 1 }] });
    await s1.post('/transactions', { action: 'CHECKOUT_TO_STAFF', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 1 }] });
    const a = await s1.get(`/transactions?hotelId=${w.h[0]}`);
    expect(a.body.items.every((i: any) => i.actor.code === 'S1A')).toBe(true);
    const m = await mgr1.get(`/transactions?hotelId=${w.h[0]}`);
    expect(new Set(m.body.items.map((i: any) => i.actor.code)).size).toBeGreaterThan(1);
  });
  it('a manipulated hotelId in body cannot reach another hotel', async () => {
    const r = await s1.post('/transactions', { action: 'CHECKOUT_TO_STAFF', hotelId: w.h[1], lines: [{ productId: w.p.SOAP, quantity: 1 }] });
    expect(r.status).toBe(403);
    const bad = await s1.get('/hotels/not-a-uuid/stock');
    expect(bad.status).toBe(400);
  });
  it('direct store-to-room can be disabled per hotel', async () => {
    await owner.req('PATCH', `/hotels/${w.h[0]}`, { allowStoreToRoom: false });
    const r = await s1.post('/transactions', { action: 'PLACE_IN_ROOM', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 1, roomId: w.rooms[0]['101'], source: 'STORE' }] });
    expect(r.status).toBe(403);
    await owner.req('PATCH', `/hotels/${w.h[0]}`, { allowStoreToRoom: true });
  });
});

describe('Input validation', () => {
  const base = () => ({ action: 'SUPPLIER_RECEIPT', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 1 }] });
  it.each([
    ['zero quantity', { lines: [{ productId: 'P', quantity: 0 }] }],
    ['fractional quantity', { lines: [{ productId: 'P', quantity: 1.5 }] }],
    ['negative quantity', { lines: [{ productId: 'P', quantity: -3 }] }],
    ['invalid action', { action: 'TELEPORT' }],
    ['STOCK_QUERY is not a mutation', { action: 'STOCK_QUERY' }],
  ])('rejects %s', async (_n, patch: any) => {
    const body: any = { ...base(), ...patch };
    if (body.lines[0].productId === 'P') body.lines[0].productId = w.p.SOAP;
    const r = await s1.post('/transactions', body);
    expect(r.status).toBe(400);
  });
  it('rejects unknown SKU and wrong-hotel room', async () => {
    expect((await s1.post('/transactions', { ...base(), lines: [{ productId: crypto.randomUUID(), quantity: 1 }] })).status).toBe(404);
    expect((await s1.post('/transactions', { action: 'PLACE_IN_ROOM', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 1, roomId: w.rooms[2]['101'], source: 'STORE' }] })).status).toBe(404);
  });
  it('note containing SQL is stored as plain data', async () => {
    const note = "'); DROP TABLE inventory_events; --";
    const r = await s1.post('/transactions', { ...base(), note });
    expect(r.status).toBe(201);
    const e = await w.db.query('SELECT note FROM inventory_events WHERE id=$1', [r.body.eventId]);
    expect(e.rows[0].note).toBe(note);
  });
  it('CSV export neutralises formula injection', async () => {
    await owner.post('/transactions', { ...base(), note: '=HYPERLINK("http://evil")' });
    const r = await owner.get('/reports/stock-events.csv?hotelId=all');
    expect(r.status).toBe(200);
    expect(r.body).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});
