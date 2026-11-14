import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { multipart, bal, Client, eventCount, ledgerMatchesBalances, placed, pwClient, setupWorld, staffClient, transit, type World } from './helpers.ts';

let w: World;
let owner: Client, s1: Client, s1b: Client, s2: Client, mgr1: Client;
const tx = (c: Client, body: any, key?: string) => c.post('/transactions', body, { key });

beforeAll(async () => {
  w = await setupWorld();
  owner = await pwClient(w, 'OWNER');
  mgr1 = await pwClient(w, 'MGR1');
  s1 = await staffClient(w, 'S1A', 0);
  s1b = await staffClient(w, 'S1B', 0);
  s2 = await staffClient(w, 'S2A', 1);
});
afterAll(async () => {
  expect(await ledgerMatchesBalances(w)).toBe(0);
  await w.app.close();
  await w.db.end();
});

describe('Business invariants (docs/06 INV-01..INV-20)', () => {
  it('INV-01 supplier receipt: H1 store +100, immutable event', async () => {
    const r = await tx(s1, { action: 'SUPPLIER_RECEIPT', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 100 }], note: 'Supplier delivery' });
    expect(r.status).toBe(201);
    expect(r.body.state).toBe('COMMITTED');
    expect(await bal(w, 0, 'SOAP')).toBe(100);
    await expect(w.db.query(`UPDATE inventory_events SET note='x' WHERE id=$1`, [r.body.eventId])).rejects.toThrow(/append-only/);
    await expect(w.db.query(`DELETE FROM inventory_event_lines WHERE event_id=$1`, [r.body.eventId])).rejects.toThrow(/append-only/);
  });

  it('INV-02 checkout: store -10, own bag +10, chain total unchanged', async () => {
    const before = (await bal(w, 0, 'SOAP')) + (await bal(w, 0, 'SOAP', w.staff.S1A));
    const r = await tx(s1, { action: 'CHECKOUT_TO_STAFF', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 10 }] });
    expect(r.status).toBe(201);
    expect(await bal(w, 0, 'SOAP')).toBe(90);
    expect(await bal(w, 0, 'SOAP', w.staff.S1A)).toBe(10);
    expect((await bal(w, 0, 'SOAP')) + (await bal(w, 0, 'SOAP', w.staff.S1A))).toBe(before);
  });

  it('INV-03 bag -> room: bag -2, store unchanged, placement +2', async () => {
    const r = await tx(s1, { action: 'PLACE_IN_ROOM', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 2, roomId: w.rooms[0]['101'], source: 'MY_STOCK' }] });
    expect(r.status).toBe(201);
    expect(await bal(w, 0, 'SOAP', w.staff.S1A)).toBe(8);
    expect(await bal(w, 0, 'SOAP')).toBe(90);
    expect(await placed(w, 0, 'SOAP')).toBe(2);
  });

  it('INV-04 direct store -> room: store -3, placement +3, bag unchanged', async () => {
    await tx(s1, { action: 'SUPPLIER_RECEIPT', hotelId: w.h[0], lines: [{ productId: w.p.SHAMPOO, quantity: 50 }] });
    const r = await tx(s1, { action: 'PLACE_IN_ROOM', hotelId: w.h[0], lines: [{ productId: w.p.SHAMPOO, quantity: 3, roomId: w.rooms[0]['102'], source: 'STORE' }] });
    expect(r.status).toBe(201);
    expect(await bal(w, 0, 'SHAMPOO')).toBe(47);
    expect(await placed(w, 0, 'SHAMPOO')).toBe(3);
    expect(await bal(w, 0, 'SHAMPOO', w.staff.S1A)).toBe(0);
  });

  it('room placement without explicit source is rejected (no silent default)', async () => {
    const r = await tx(s1, { action: 'PLACE_IN_ROOM', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 1, roomId: w.rooms[0]['101'] }] });
    expect(r.status).toBe(400);
  });

  it('INV-05 over-request rejects entire multi-line action with 409, no partial writes', async () => {
    const before = await eventCount(w);
    const r = await tx(s1, { action: 'PLACE_IN_ROOM', hotelId: w.h[0], lines: [
      { productId: w.p.SOAP, quantity: 1, roomId: w.rooms[0]['101'], source: 'MY_STOCK' },
      { productId: w.p.SOAP, quantity: 50, roomId: w.rooms[0]['102'], source: 'MY_STOCK' }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(r.body.error.details.shortages[0].available).toBe(8);
    expect(await eventCount(w)).toBe(before);
    expect(await bal(w, 0, 'SOAP', w.staff.S1A)).toBe(8);
  });

  it('multi-room: invalid room means no partial save', async () => {
    const before = await eventCount(w);
    const r = await tx(s1, { action: 'PLACE_IN_ROOM', hotelId: w.h[0], lines: [
      { productId: w.p.SOAP, quantity: 1, roomId: w.rooms[0]['101'], source: 'MY_STOCK' },
      { productId: w.p.SOAP, quantity: 1, roomId: w.rooms[1]['101'], source: 'MY_STOCK' }] }); // Hotel 2's room
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('INVALID_ROOM_OR_PRODUCT');
    expect(await eventCount(w)).toBe(before);
  });

  let transferId = '';
  it('INV-06 dispatch H1 -> H2: H1 store -20, transit +20, H2 unchanged', async () => {
    await tx(s1, { action: 'SUPPLIER_RECEIPT', hotelId: w.h[0], lines: [{ productId: w.p.DENTAL_KIT, quantity: 40 }] });
    const r = await s1.post('/transfers', { fromHotelId: w.h[0], toHotelId: w.h[1], lines: [{ productId: w.p.DENTAL_KIT, quantity: 20 }] });
    expect(r.status).toBe(201);
    transferId = r.body.transferId;
    expect(r.body.refCode).toMatch(/^T\d+/);
    expect(await bal(w, 0, 'DENTAL_KIT')).toBe(20);
    expect(await transit(w, transferId, 'DENTAL_KIT')).toBe(20);
    expect(await bal(w, 1, 'DENTAL_KIT')).toBe(0);
  });

  it('sender cannot receive own transfer; other-hotel staff cannot receive', async () => {
    expect((await s1.post(`/transfers/${transferId}/receipts`, { lines: [{ productId: w.p.DENTAL_KIT, receivedQuantity: 1 }] })).status).toBe(403);
  });

  let receiptKey = '';
  it('INV-07 H2 receives 18 of 20: transit 2, H2 +18, partial', async () => {
    receiptKey = randomUUID();
    const r = await s2.post(`/transfers/${transferId}/receipts`, { lines: [{ productId: w.p.DENTAL_KIT, receivedQuantity: 18 }] }, { key: receiptKey });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('PARTIALLY_RECEIVED');
    expect(r.body.outstandingUnits).toBe(2);
    expect(await transit(w, transferId, 'DENTAL_KIT')).toBe(2);
    expect(await bal(w, 1, 'DENTAL_KIT')).toBe(18);
  });

  it('INV-08 duplicate receipt with same idempotency key: no extra +18, original returned', async () => {
    const first = await w.db.query('SELECT id FROM inventory_events WHERE action=$1', ['TRANSFER_RECEIPT']);
    const r = await s2.post(`/transfers/${transferId}/receipts`, { lines: [{ productId: w.p.DENTAL_KIT, receivedQuantity: 18 }] }, { key: receiptKey });
    expect(r.status).toBe(201);
    expect(r.headers['idempotent-replayed']).toBe('true');
    expect(r.body.eventId).toBe(first.rows[0].id);
    expect(await bal(w, 1, 'DENTAL_KIT')).toBe(18);
  });

  it('INV-09 receiving 3 more than remaining 2 is rejected', async () => {
    const r = await s2.post(`/transfers/${transferId}/receipts`, { lines: [{ productId: w.p.DENTAL_KIT, receivedQuantity: 3 }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('TRANSFER_CONFLICT');
    expect(r.body.error.details.remaining).toBe(2);
    expect(await bal(w, 1, 'DENTAL_KIT')).toBe(18);
  });

  it('final partial receipt marks DISCREPANCY; manager resolves remainder with explicit event', async () => {
    const r = await s2.post(`/transfers/${transferId}/receipts`, { lines: [{ productId: w.p.DENTAL_KIT, receivedQuantity: 0 }], final: true });
    expect(r.status).toBe(400); // no units — nothing to post
    await w.db.query(`UPDATE transfers SET status='DISCREPANCY' WHERE id=$1`, [transferId]); // simulate receiver flagged shortage
    expect((await s2.post(`/transfers/${transferId}/resolve`, { reason: 'LOST' })).status).toBe(403); // staff can't
    const mgr2 = await pwClient(w, 'MGR2');
    const res = await mgr2.post(`/transfers/${transferId}/resolve`, { reason: 'LOST', note: 'Box short' });
    expect(res.status).toBe(201);
    expect(res.body.resolvedUnits).toBe(2);
    expect(await transit(w, transferId, 'DENTAL_KIT')).toBe(0);
    const tl = await w.db.query('SELECT sent_qty, received_qty, resolved_short_qty FROM transfer_lines WHERE transfer_id=$1', [transferId]);
    expect(tl.rows[0]).toEqual({ sent_qty: 20, received_qty: 18, resolved_short_qty: 2 });
  });

  it('INV-10 same hotel as sender and receiver rejected before commit', async () => {
    const before = await eventCount(w);
    const r = await s1.post('/transfers', { fromHotelId: w.h[0], toHotelId: w.h[0], lines: [{ productId: w.p.DENTAL_KIT, quantity: 1 }] });
    expect(r.status).toBe(400);
    expect(await eventCount(w)).toBe(before);
  });

  let countId = '';
  it('INV-11 count expected 100 physical 97 -> signoff + immutable adjustment -3 with reason', async () => {
    await tx(owner, { action: 'SUPPLIER_RECEIPT', hotelId: w.h[2], lines: [{ productId: w.p.COMB, quantity: 100 }] });
    const mgr3 = await pwClient(w, 'MGR3');
    const c = await mgr3.post('/counts', { hotelId: w.h[2] });
    expect(c.status).toBe(201);
    countId = c.body.id;
    const lines = c.body.lines.map((l: any) => ({ productId: l.productId, physicalQty: l.expectedQty }));
    lines.find((l: any) => l.productId === w.p.COMB).physicalQty = 97;
    await mgr3.req('PATCH', `/counts/${countId}/lines`, { lines });
    const noReason = await mgr3.post(`/counts/${countId}/submit`, {});
    expect(noReason.status).toBe(400);
    await mgr3.req('PATCH', `/counts/${countId}/lines`, { lines: [{ productId: w.p.COMB, physicalQty: 97, reason: 'DAMAGED' }] });
    const s = await mgr3.post(`/counts/${countId}/submit`, {});
    expect(s.status).toBe(201);
    expect(s.body.deltas.find((d: any) => d.productId === w.p.COMB).delta).toBe(-3);
    expect(await bal(w, 2, 'COMB')).toBe(97);
    const ev = await w.db.query('SELECT action, related_stock_count_id FROM inventory_events WHERE id=$1', [s.body.adjustmentEventId]);
    expect(ev.rows[0]).toEqual({ action: 'STOCK_ADJUSTMENT', related_stock_count_id: countId });
  });

  it('INV-12 movement during count -> STALE_COUNT_SNAPSHOT, no stale overwrite; refresh resolves', async () => {
    const c = await mgr1.post('/counts', { hotelId: w.h[0] });
    const id = c.body.id;
    await mgr1.req('PATCH', `/counts/${id}/lines`, { lines: c.body.lines.map((l: any) => ({ productId: l.productId, physicalQty: l.expectedQty })) });
    // concurrent staff checkout while manager is counting
    await tx(s1b, { action: 'CHECKOUT_TO_STAFF', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 5 }] });
    const storeBefore = await bal(w, 0, 'SOAP');
    const r = await mgr1.post(`/counts/${id}/submit`, {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('STALE_COUNT_SNAPSHOT');
    expect(r.body.error.details.changed).toHaveLength(1);
    expect(await bal(w, 0, 'SOAP')).toBe(storeBefore);
    const ref = await mgr1.post(`/counts/${id}/refresh`, {});
    expect(ref.body.refreshedProducts).toEqual([w.p.SOAP]);
    const soap = ref.body.lines.find((l: any) => l.productId === w.p.SOAP);
    expect(soap.physicalQty).toBeNull(); // must be recounted
    await mgr1.req('PATCH', `/counts/${id}/lines`, { lines: [{ productId: w.p.SOAP, physicalQty: soap.expectedQty }] });
    const ok = await mgr1.post(`/counts/${id}/submit`, {});
    expect(ok.status).toBe(201);
    expect(ok.body.adjustmentEventId).toBeNull(); // no variance -> no adjustment event
  });

  it('INV-13 two staff race for last 8 soap asking 6 each: exactly one succeeds', async () => {
    await tx(owner, { action: 'SUPPLIER_RECEIPT', hotelId: w.h[1], lines: [{ productId: w.p.TOOTHBRUSH, quantity: 8 }] });
    const s2b = await staffClient(w, 'S2A', 1);
    const mgr2 = await pwClient(w, 'MGR2');
    const results = await Promise.all([
      tx(s2b, { action: 'CHECKOUT_TO_STAFF', hotelId: w.h[1], lines: [{ productId: w.p.TOOTHBRUSH, quantity: 6 }] }),
      tx(mgr2, { action: 'CHECKOUT_TO_STAFF', hotelId: w.h[1], lines: [{ productId: w.p.TOOTHBRUSH, quantity: 6 }] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await bal(w, 1, 'TOOTHBRUSH')).toBe(2);
  });

  it('INV-13b 10 concurrent checkouts never drive stock negative', async () => {
    await tx(owner, { action: 'SUPPLIER_RECEIPT', hotelId: w.h[0], lines: [{ productId: w.p.TOOTHPASTE, quantity: 25 }] });
    const rs = await Promise.all([...Array(10)].map((_, i) => tx(i % 2 ? s1 : s1b, { action: 'CHECKOUT_TO_STAFF', hotelId: w.h[0], lines: [{ productId: w.p.TOOTHPASTE, quantity: 3 }] })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(8);
    expect(await bal(w, 0, 'TOOTHPASTE')).toBe(1);
  });

  it('INV-14 duplicated request after connection loss -> one ledger event; different payload same key -> 409', async () => {
    const key = randomUUID();
    const body = { action: 'RETURN_TO_STORE', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 1 }] };
    const before = await eventCount(w);
    const [a, b] = await Promise.all([tx(s1, body, key), tx(s1, body, key)]);
    expect(a.body.eventId).toBe(b.body.eventId);
    expect(await eventCount(w)).toBe(before + 1);
    const c = await tx(s1, { ...body, lines: [{ productId: w.p.SOAP, quantity: 2 }] }, key);
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('INV-15 H1 staff posting an adjustment/receipt for H3 -> 403, no write', async () => {
    const before = await eventCount(w);
    const a = await tx(s1, { action: 'STOCK_ADJUSTMENT', hotelId: w.h[2], reason: 'x', lines: [{ productId: w.p.SOAP, quantity: 5, direction: 'IN' }] });
    const b = await tx(s1, { action: 'SUPPLIER_RECEIPT', hotelId: w.h[2], lines: [{ productId: w.p.SOAP, quantity: 5 }] });
    const c = await tx(s1, { action: 'STOCK_ADJUSTMENT', hotelId: w.h[0], reason: 'x', lines: [{ productId: w.p.SOAP, quantity: 5, direction: 'IN' }] });
    expect([a.status, b.status, c.status]).toEqual([403, 403, 403]);
    expect(a.body.error.code).toBe('HOTEL_NOT_ALLOWED');
    expect(await eventCount(w)).toBe(before);
  });

  it('INV-16 reversal posts linked compensating event; history intact; cannot reverse twice', async () => {
    const orig = await tx(s1, { action: 'PLACE_IN_ROOM', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 1, roomId: w.rooms[0]['103'], source: 'MY_STOCK' }] });
    const bagAfter = await bal(w, 0, 'SOAP', w.staff.S1A);
    const placedAfter = await placed(w, 0, 'SOAP');
    expect((await s1.post(`/transactions/${orig.body.eventId}/reversal`, { reason: 'Wrong room' })).status).toBe(403);
    const r = await mgr1.post(`/transactions/${orig.body.eventId}/reversal`, { reason: 'Wrong room' });
    expect(r.status).toBe(201);
    expect(r.body.reversalOf).toBe(orig.body.eventId);
    expect(await bal(w, 0, 'SOAP', w.staff.S1A)).toBe(bagAfter + 1);
    expect(await placed(w, 0, 'SOAP')).toBe(placedAfter - 1);
    const still = await w.db.query('SELECT count(*)::int n FROM inventory_event_lines WHERE event_id=$1', [orig.body.eventId]);
    expect(still.rows[0].n).toBe(1);
    expect((await mgr1.post(`/transactions/${orig.body.eventId}/reversal`, { reason: 'again' })).status).toBe(409);
  });

  it('INV-17 owner dashboard after placement: balances correct; placement flow separate from stock', async () => {
    const before = await owner.get(`/dashboard/overview?hotelId=${w.h[0]}&periodDays=7`);
    await tx(s1, { action: 'PLACE_IN_ROOM', hotelId: w.h[0], lines: [{ productId: w.p.SOAP, quantity: 2, roomId: w.rooms[0]['201'], source: 'MY_STOCK' }] });
    const after = await owner.get(`/dashboard/overview?hotelId=${w.h[0]}&periodDays=7`);
    expect(after.body.placedInRoomsUnits).toBe(before.body.placedInRoomsUnits + 2);
    expect(after.body.staffHeldUnits).toBe(before.body.staffHeldUnits - 2);
    expect(after.body.storeAvailableUnits).toBe(before.body.storeAvailableUnits);
    const all = await owner.get('/dashboard/overview?hotelId=all&periodDays=30');
    expect(all.body.scope).toBe('ALL_HOTELS');
    expect(all.body.hotels).toHaveLength(3);
    expect(all.body.inTransitUnits).toBe(0);
  });

  it('INV-18 7-day window uses UTC instants and reports asOf', async () => {
    const r = await owner.get(`/dashboard/room-placements?hotelId=all&periodDays=7`);
    expect(r.status).toBe(200);
    expect(r.body.metric).toBe('AMENITIES_PLACED_IN_ROOMS');
    expect(new Date(r.body.to).getTime() - new Date(r.body.from).getTime()).toBe(7 * 86_400_000);
    expect(r.body.asOf).toMatch(/Z$/);
    // An event dated 8 days ago (inserted as history) must be excluded from a 7-day window.
    const old = await w.db.query(`SELECT count(*)::int n FROM inventory_events WHERE created_at < now() - interval '7 days'`);
    expect(old.rows[0].n).toBe(0);
    const r2 = await owner.get(`/dashboard/room-placements?hotelId=all&from=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 7200_000).toISOString())}`);
    expect(r2.body.totalUnits).toBe(0);
  });

  it('INV-19 logged-out shared phone has no access to prior session', async () => {
    const c = await staffClient(w, 'S1A', 0);
    const cookie = c.cookie;
    expect((await c.get('/me')).status).toBe(200);
    await c.post('/auth/logout', {}, { key: null });
    const replay = new Client(w.app); replay.cookie = cookie;
    expect((await replay.get('/me')).status).toBe(401);
    expect((await replay.get(`/me/stock?hotelId=${w.h[0]}`)).status).toBe(401);
  });

  it('INV-20 voice says 20, staff edits to 2: only the confirmed 2 is stored', async () => {
    const v = await s1.req('POST', '/voice/interpret', undefined, {}); // missing multipart
    expect(v.status).toBe(400);
    const form = multipart({ hotelId: w.h[0] }, 'Store se 20 comb liye');
    const res = await w.app.inject({ method: 'POST', url: '/api/v1/voice/interpret', payload: form.body, headers: { ...form.headers, cookie: s1.cookie, 'x-requested-with': 'stockwise' } });
    const prop = res.json();
    expect(prop.action).toBe('CHECKOUT_TO_STAFF');
    expect(prop.lines[0].quantity).toBe(20);
    const before = await bal(w, 0, 'COMB', w.staff.S1A);
    await tx(owner, { action: 'SUPPLIER_RECEIPT', hotelId: w.h[0], lines: [{ productId: w.p.COMB, quantity: 30 }] });
    const c = await tx(s1, { action: 'CHECKOUT_TO_STAFF', hotelId: w.h[0], proposalId: prop.proposalId, lines: [{ productId: prop.lines[0].productId, quantity: 2 }] });
    expect(c.status).toBe(201);
    expect(await bal(w, 0, 'COMB', w.staff.S1A)).toBe(before + 2);
    // proposal can't be replayed into a second write
    const again = await tx(s1, { action: 'CHECKOUT_TO_STAFF', hotelId: w.h[0], proposalId: prop.proposalId, lines: [{ productId: prop.lines[0].productId, quantity: 2 }] });
    expect(again.status).toBe(422);
  });
});

