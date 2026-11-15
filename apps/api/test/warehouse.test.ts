import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bal, Client, ledgerMatchesBalances, multipart, pwClient, setupWorld, PW, type World } from './helpers.ts';
import { createHotel, createUser, systemActor } from '../src/db/fixtures.ts';
import { createTransaction } from '../src/services/transactions.ts';
import { runDueSchedules } from '../src/services/requests.ts';

let w: World, wh: string, whm: Client, mgr3: Client, owner: Client;
let whBal: (sku: string) => Promise<number>;

beforeAll(async () => {
  w = await setupWorld();
  wh = await createHotel(w.db, w.orgId, 'WH', 'Warehouse', 'Asia/Kolkata', 'WAREHOUSE');
  await createUser(w.db, w.orgId, { code: 'WHM', name: 'Warehouse Mgr', password: PW, memberships: [{ hotelId: wh, role: 'MANAGER' }] });
  const sys = systemActor(w.orgId, w.ownerId);
  await createTransaction(w.db, sys, { action: 'OPENING_BALANCE', hotelId: wh, lines: [{ productId: w.p.SOAP, quantity: 1000 }, { productId: w.p.SHAMPOO, quantity: 500 }] }, randomUUID());
  await createTransaction(w.db, sys, { action: 'OPENING_BALANCE', hotelId: w.h[2], lines: [{ productId: w.p.SOAP, quantity: 10 }] }, randomUUID());
  await w.db.query('INSERT INTO hotel_product_settings (hotel_id, product_id, reorder_threshold, par_level) VALUES ($1,$2,60,200)', [w.h[2], w.p.SOAP]);
  whm = await pwClient(w, 'WHM');
  mgr3 = await pwClient(w, 'MGR3');
  owner = await pwClient(w, 'OWNER');
  whBal = async (sku) => (await w.db.query(`SELECT COALESCE(sum(b.quantity),0)::int AS q FROM stock_balances b JOIN stock_locations sl ON sl.id=b.location_id WHERE sl.hotel_id=$1 AND b.product_id=$2 AND sl.type='HOTEL_STORE'`, [wh, w.p[sku]])).rows[0].q;
});
afterAll(async () => {
  expect(await ledgerMatchesBalances(w)).toBe(0);
  await w.app.close();
  await w.db.end();
});

describe('Warehouse', () => {
  it('/me shows the warehouse first with its kind, and the warehouseId', async () => {
    const me = (await owner.get('/me')).body;
    expect(me.warehouseId).toBe(wh);
    expect(me.hotels[0]).toMatchObject({ id: wh, kind: 'WAREHOUSE' });
    expect(me.hotels[1].kind).toBe('HOTEL');
  });

  it('only one active warehouse per organisation', async () => {
    await expect(createHotel(w.db, w.orgId, 'WH2', 'Second', 'Asia/Kolkata', 'WAREHOUSE')).rejects.toThrow();
  });

  it('low-stock alert at a hotel says what the warehouse has', async () => {
    const a = (await mgr3.get(`/dashboard/alerts?hotelId=${w.h[2]}`)).body;
    const low = a.items.find((x: any) => x.id === `low:${w.h[2]}:${w.p.SOAP}`);
    expect(low.category).toBe('LOW_STOCK_ASK_WAREHOUSE');
    expect(low.detail).toContain('warehouse has 1000');
  });

  it('top-up preview: par − store − on the way − requested', async () => {
    const r = (await mgr3.get(`/requests/top-up?hotelId=${w.h[2]}`)).body;
    expect(r.warehouse.id).toBe(wh);
    expect(r.lines.find((l: any) => l.productId === w.p.SOAP)).toMatchObject({ par: 200, store: 10, quantity: 190, warehouse: 1000 });
  });

  let requestId: string, transferId: string;
  it('hotel manager asks; warehouse sees it; a hotel manager elsewhere does not', async () => {
    const r = await mgr3.post('/requests', { hotelId: w.h[2], lines: [{ productId: w.p.SOAP, quantity: 100 }, { productId: w.p.SHAMPOO, quantity: 40 }], note: 'low' });
    expect(r.status).toBe(201);
    requestId = r.body.requestId;
    const mine = (await mgr3.get(`/requests?hotelId=${w.h[2]}`)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0].lines.find((l: any) => l.productId === w.p.SOAP)).toMatchObject({ quantity: 100, warehouseStock: 1000 });
    const seen = (await whm.get('/requests')).body;
    expect(seen.map((x: any) => x.id)).toContain(requestId);
    const mgr1 = await pwClient(w, 'MGR1');
    expect((await mgr1.get('/requests')).body).toHaveLength(0);
    // The warehouse's own alerts list the request.
    const a = (await whm.get(`/dashboard/alerts?hotelId=${wh}`)).body;
    expect(a.items.some((x: any) => x.id === `req:${requestId}`)).toBe(true);
    // The hotel's low-stock alert now shows the request was sent.
    const b = (await mgr3.get(`/dashboard/alerts?hotelId=${w.h[2]}`)).body;
    expect(b.items.find((x: any) => x.id === `low:${w.h[2]}:${w.p.SOAP}`).category).toBe('LOW_STOCK_REQUESTED');
  });

  it('a hotel manager cannot dispatch; the warehouse manager can, with changed quantities', async () => {
    expect((await mgr3.post(`/requests/${requestId}/dispatch`, {})).status).toBe(403);
    const r = await whm.post(`/requests/${requestId}/dispatch`, { lines: [{ productId: w.p.SOAP, quantity: 100 }, { productId: w.p.SHAMPOO, quantity: 30 }] });
    expect(r.status).toBe(201);
    transferId = r.body.transferId;
    expect(await whBal('SOAP')).toBe(900);
    expect(await whBal('SHAMPOO')).toBe(470);
    const req = (await whm.get('/requests')).body.find((x: any) => x.id === requestId);
    expect(req).toMatchObject({ status: 'SENT', transferId });
    expect((await whm.post(`/requests/${requestId}/dispatch`, {})).status).toBe(400);
  });

  it('receiving the transfer at the hotel closes the request', async () => {
    const r = await mgr3.post(`/transfers/${transferId}/receipts`, { lines: [{ productId: w.p.SOAP, receivedQuantity: 100 }, { productId: w.p.SHAMPOO, receivedQuantity: 30 }] });
    expect(r.status).toBe(201);
    expect(await bal(w, 2, 'SOAP')).toBe(110);
    const req = (await mgr3.get(`/requests?hotelId=${w.h[2]}`)).body.find((x: any) => x.id === requestId);
    expect(req.status).toBe('RECEIVED');
  });

  it('decline by the warehouse, cancel by the hotel', async () => {
    const a = (await mgr3.post('/requests', { hotelId: w.h[2], lines: [{ productId: w.p.SOAP, quantity: 5 }] })).body.requestId;
    expect((await whm.post(`/requests/${a}/decline`, { note: 'none left' })).body.status).toBe('DECLINED');
    const b = (await mgr3.post('/requests', { hotelId: w.h[2], lines: [{ productId: w.p.SOAP, quantity: 5 }] })).body.requestId;
    expect((await mgr3.post(`/requests/${b}/decline`, {})).body.status).toBe('CANCELLED');
  });

  it('hotels may still buy direct from suppliers', async () => {
    const r = await mgr3.post('/transactions', { action: 'SUPPLIER_RECEIPT', hotelId: w.h[2], lines: [{ productId: w.p.SOAP, quantity: 12 }] });
    expect(r.status).toBe(201);
    expect(await bal(w, 2, 'SOAP')).toBe(122);
  });

  it('voice: "warehouse se 50 soap mangwao" proposes a request to the warehouse', async () => {
    const f = multipart({ hotelId: w.h[2], preferredLanguage: 'hi' }, 'warehouse se 50 sabun mangwao');
    const res = await w.app.inject({ method: 'POST', url: '/api/v1/voice/interpret', payload: f.body, headers: { ...f.headers, cookie: mgr3.cookie, 'x-requested-with': 'stockwise' } });
    const r = { status: res.statusCode, body: res.json() };
    expect(r.status).toBe(200);
    expect(r.body.action).toBe('REQUEST_FROM_WAREHOUSE');
    expect(r.body.lines[0]).toMatchObject({ productId: w.p.SOAP, quantity: 50 });
    expect(r.body.status).toBe('READY_TO_CONFIRM');
  });

  it('schedule: runs once per weekly slot and asks for the top-up to par', async () => {
    expect((await mgr3.post('/request-schedules', { hotelId: w.h[2], weekday: 1, hour: 7 })).status).toBe(201);
    expect((await mgr3.get(`/request-schedules?hotelId=${w.h[2]}`)).body).toHaveLength(1);
    // Monday 2026-11-16 09:00 IST = 03:30Z
    const monday = new Date('2026-11-16T03:30:00Z');
    expect((await runDueSchedules(w.db, monday)).ran).toBe(1);
    expect((await runDueSchedules(w.db, new Date('2026-11-16T05:30:00Z'))).ran).toBe(0);
    const open = (await mgr3.get(`/requests?hotelId=${w.h[2]}&status=OPEN`)).body;
    const auto = open.find((x: any) => x.note === 'Scheduled top-up to par');
    expect(auto.lines.find((l: any) => l.productId === w.p.SOAP).quantity).toBe(200 - 122);
    // Sunday is not due.
    expect((await runDueSchedules(w.db, new Date('2026-11-22T03:30:00Z'))).ran).toBe(0);
    // Next Monday is.
    expect((await runDueSchedules(w.db, new Date('2026-11-23T03:30:00Z'))).ran).toBe(1);
  });

  it('cron endpoint needs the secret', async () => {
    const c = new Client(w.app);
    expect((await c.req('POST', '/internal/run-schedules', {}, { key: null })).status).toBe(401);
  });
});
