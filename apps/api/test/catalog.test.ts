import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bal, Client, ledgerMatchesBalances, multipart, pwClient, setupWorld, staffClient, PW, type World } from './helpers.ts';
import { createHotel, createUser } from '../src/db/fixtures.ts';
import { splitSpokenOrder } from '../src/services/orders.ts';

const CSV = `Code,Name,Alias/Nick Name,Description,Inventory Type,Use As,Category,Base UOM,Purchase UOM,Issue UOM,Purchase Price,GST Rate (%),HSN Code,Consumption Account,Auto Consumption,Valuation Method,Has Expiry,Shelf Life (days),Status
ITM-0019,AMUL BUTTER,AMUL BUTTER,,Stock,Consumable,Food & Beverage,KG,KG,KG,590.48,5,,CONS01,No,WAC,Yes,180,Active
ITM-0021,AMUL CHEESE,CHEESE,,Stock,Consumable,Food & Beverage,KGS,KG,KG,538.1,5,,CONS01,No,WAC,Yes,180,Active
ITM-0025,AMUL TAAZA MILK,MILK,,Stock,Consumable,Food & Beverage,LTR,LTR,LTR,77,0,,CONS01,No,FIFO,Yes,7,Active
ITM-0001,Basmati Rice,"RICE, BASMATI",,Stock,Consumable,Food Items,KG,,KG,114,5,,CONS01,No,WAC,No,,Active
ITM-0293,MUSTARD OIL 1 LTR,MUSTARD OIL 1 LTR,,Stock,Consumable,Food & Beverage,LTR,LTR,LTR,210,5,,CONS01,No,WAC,Yes,180,Active
ITM-0387,SESAME OIL,SESAME OIL,,Stock,Consumable,Food & Beverage,LTR,LTR,LTR,,5,,CONS01,No,WAC,Yes,180,Active
ITM-0731,HARPIC RED,HARPIC RED,,Stock,Consumable,Chemicals & Cleaning,LTR,LTR,LTR,110,18,,CONS05,No,WAC,No,,Active
ITM-0007,Refrigerator ,FRIDGE,,Stock,Fixed Asset (Equipment),Engineering & Maintenance,PCS,PCS,PCS,12000,18,,CONS03,No,WAC,No,,Active
ITM-9999,OLD BUTTER,OLD,Duplicate - merged into ITM-0019,Stock,Consumable,Food & Beverage,KG,KG,KG,1,5,,CONS01,No,WAC,No,,Inactive
`;

let w: World, wh: string, whm: Client, owner: Client, mgr3: Client;
const item: Record<string, string> = {}; const cat: Record<string, string> = {};
let dairy: string, prov: string, orderId: string;
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  w = await setupWorld();
  wh = await createHotel(w.db, w.orgId, 'WH', 'Central Warehouse', 'Asia/Kolkata', 'WAREHOUSE');
  await createUser(w.db, w.orgId, { code: 'WHM', name: 'Warehouse Mgr', password: PW, memberships: [{ hotelId: wh, role: 'MANAGER' }] });
  whm = await pwClient(w, 'WHM'); owner = await pwClient(w, 'OWNER'); mgr3 = await pwClient(w, 'MGR3');
});
afterAll(async () => { expect(await ledgerMatchesBalances(w)).toBe(0); await w.app.close(); await w.db.end(); });

describe('Catalog import', () => {
  it('only the owner can import; inactive rows are skipped; categories get everyday names', async () => {
    expect((await whm.post('/catalog/import', { csv: CSV })).status).toBe(403);
    const r = await owner.post('/catalog/import', { csv: CSV });
    expect(r.body).toMatchObject({ created: 8, updated: 0, skipped: 1 });
    const again = await owner.post('/catalog/import', { csv: CSV });
    expect(again.body).toMatchObject({ created: 0, updated: 8 });
    const cats = (await whm.get('/catalog/categories')).body;
    for (const c of cats) cat[c.shortName] = c.id;
    expect(Object.keys(cat).sort()).toEqual(['Cleaning', 'Food', 'Repairs & spares']);
    expect(cats.find((c: any) => c.shortName === 'Food').items).toBe(6);   // "Food Items" merged into Food & Beverage
  });

  it('search covers the whole catalog by name, nickname and code; units are cleaned', async () => {
    const all = (await whm.get(`/catalog/items?siteId=${wh}&q=a&limit=100`)).body;
    for (const i of all.items) item[i.code] = i.id;
    expect((await whm.get(`/catalog/items?siteId=${wh}&q=fridge`)).body.items[0].name).toBe('Refrigerator');
    expect((await whm.get(`/catalog/items?siteId=${wh}&q=itm-0021`)).body.items[0]).toMatchObject({ name: 'AMUL CHEESE', unit: 'KG', category: 'Food', store: 0, status: 'NONE', lastPrice: 538.1 });
    // With no search, a site lists only what it stocks — nothing yet at the warehouse.
    expect((await whm.get(`/catalog/items?siteId=${wh}`)).body.items).toHaveLength(0);
  });

  it('the staff app and hotel counts are unchanged by 8 new catalog items', async () => {
    const s = await staffClient(w, 'S1A', 0);
    expect((await s.get('/products')).body).toHaveLength(6);
    expect((await whm.get('/products?all=1')).body).toHaveLength(14);
    const mgr1 = await pwClient(w, 'MGR1');
    const c = await mgr1.post('/counts', { hotelId: w.h[0] });
    expect(c.status).toBe(201);
    expect((await mgr1.get(`/counts/${c.body.countId ?? c.body.id}`)).body.lines).toHaveLength(6);
  });

  it('a manager adds an item by hand; the same name is not added twice', async () => {
    const a = await whm.post('/catalog/items', { name: 'Amul Cheese Slices 200 g', unit: 'pac', categoryId: cat.Food, price: 140 });
    expect(a.status).toBe(201);
    const b = await whm.post('/catalog/items', { name: 'amul cheese slices 200 g', unit: 'PAC' });
    expect(b.status).toBe(200); expect(b.body).toMatchObject({ id: a.body.id, existed: true });
  });
});

describe('Suppliers', () => {
  it('add with categories; the same phone number is refused with the existing name', async () => {
    const a = await whm.post('/suppliers', { name: 'Shree Dairy', phone: '+91 98250 11111', deliveryDays: 1, categoryIds: [cat.Food] });
    expect(a.status).toBe(201); dairy = a.body.id;
    const b = await whm.post('/suppliers', { name: 'Gujarat Provisions', phone: '9825022222', categoryIds: [cat.Food, cat.Cleaning] });
    prov = b.body.id;
    const dup = await whm.post('/suppliers', { name: 'Someone else', phone: '98250-11111'.replace('98250', '+9198250') });
    expect(dup.status).toBe(400); expect(dup.body.error.message).toContain('Shree Dairy');
    const staff = await staffClient(w, 'S1A', 0);
    expect((await staff.get('/suppliers')).status).toBe(403);
  });

  it('search by name, phone and category; nothing bought yet', async () => {
    const names = async (q: string) => (await whm.get('/suppliers?q=' + encodeURIComponent(q))).body.map((s: any) => s.name);
    expect(await names('shree')).toEqual(['Shree Dairy']);
    expect(await names('22222')).toEqual(['Gujarat Provisions']);
    expect(await names('cleaning')).toEqual(['Gujarat Provisions']);
    expect(await names('food')).toEqual(['Gujarat Provisions', 'Shree Dairy']);
    const all = (await whm.get('/suppliers')).body;
    expect(all[0]).toMatchObject({ name: 'Gujarat Provisions', boughtBefore: false });
    expect(all[0].categories.map((c: any) => [c.name, c.boughtBefore, c.allItems])).toEqual([['Cleaning', false, true], ['Food', false, true]]);
    expect((await whm.get(`/suppliers?categoryId=${cat.Cleaning}`)).body).toHaveLength(1);
  });

  it('inside a category a supplier can be narrowed to picked items', async () => {
    const r = await whm.req('PUT', `/suppliers/${dairy}/categories/${cat.Food}`, { allItems: false, productIds: [item['ITM-0025'], item['ITM-0019']] });
    expect(r.body).toMatchObject({ allItems: false, picked: 2 });
    const items = (await whm.get(`/suppliers/${dairy}/categories/${cat.Food}/items`)).body;
    expect(items.filter((i: any) => i.picked).map((i: any) => i.name).sort()).toEqual(['AMUL BUTTER', 'AMUL TAAZA MILK']);
    expect((await whm.get('/suppliers?q=taaza')).body.map((s: any) => s.name)).toEqual(['Shree Dairy']);   // found by a linked item
    expect((await whm.req('PUT', `/suppliers/${dairy}/categories/${cat.Food}`, { allItems: false, productIds: [item['ITM-0731']] })).status).toBe(404);   // Harpic is not Food
    expect((await whm.req('PATCH', `/suppliers/${dairy}`, { favourite: true })).status).toBe(200);
  });
});

describe('Orders and deliveries', () => {
  it('suggests what is at or below its minimum, filled to par, for what the supplier sells', async () => {
    for (const [code, min, par] of [['ITM-0019', 15, 40], ['ITM-0025', 20, 120], ['ITM-0731', 20, 60]] as const)
      await w.db.query('INSERT INTO hotel_product_settings (hotel_id, product_id, reorder_threshold, par_level) VALUES ($1,$2,$3,$4)', [wh, item[code], min, par]);
    const s = (await whm.get(`/orders/suggest?siteId=${wh}&supplierId=${dairy}`)).body;
    expect(s.map((l: any) => [l.name, l.quantity])).toEqual([['AMUL BUTTER', 40], ['AMUL TAAZA MILK', 120]]);
    expect((await whm.get(`/orders/suggest?siteId=${wh}`)).body).toHaveLength(3);
  });

  it('draft → edit → send; the WhatsApp message lists items without prices', async () => {
    const c = await whm.post('/orders', { siteId: wh, supplierId: dairy, lines: [{ productId: item['ITM-0025'], quantity: 100 }, { productId: item['ITM-0019'], quantity: 20 }] });
    expect(c.status).toBe(201); orderId = c.body.id; expect(c.body.number).toBe(1);
    expect((await whm.post(`/orders/${orderId}/deliveries`, { lines: [{ productId: item['ITM-0025'], received: 1, expiryDate: day(5) }] })).status).toBe(400);   // not sent yet
    expect((await whm.req('PATCH', `/orders/${orderId}`, { lines: [{ productId: item['ITM-0025'], quantity: 120 }, { productId: item['ITM-0019'], quantity: 20 }] })).status).toBe(200);
    expect((await mgr3.get(`/orders/${orderId}`)).status).toBe(403);
    const o = (await whm.post(`/orders/${orderId}/send`)).body;
    expect(o.status).toBe('SENT');
    expect(o.total).toBe(120 * 77 + 20 * 590.48);
    expect(o.message).toContain('Hello, order from Central Warehouse:');
    expect(o.message).toContain('1. AMUL BUTTER — 20 KG');
    expect(o.message).toContain('2. AMUL TAAZA MILK — 120 LTR');
    expect(o.message).toContain('Order 1. Thank you.');
    expect(o.message).not.toContain('590');
    expect((await whm.req('PATCH', `/orders/${orderId}`, { note: 'x' })).status).toBe(400);
    const home = (await whm.get(`/sites/${wh}/home`)).body;
    expect(home.isWarehouse).toBe(true);
    expect(home.deliveriesDue.map((d: any) => d.number)).toEqual([1]);
    expect((await whm.get(`/orders/suggest?siteId=${wh}`)).body.map((l: any) => l.name)).toEqual(['AMUL BUTTER', 'HARPIC RED']);   // milk is fully on order
  });

  it('checking a delivery needs a use-by date and a reason for anything sent back', async () => {
    const noDate = await whm.post(`/orders/${orderId}/deliveries`, { lines: [{ productId: item['ITM-0025'], received: 120 }] });
    expect(noDate.status).toBe(400); expect(noDate.body.error.message).toContain('use-by date');
    const noWhy = await whm.post(`/orders/${orderId}/deliveries`, { lines: [{ productId: item['ITM-0025'], received: 117, rejected: 3, expiryDate: day(2) }] });
    expect(noWhy.status).toBe(400);
  });

  it('a checked delivery adds stock, makes lots, flags price and sent-back goods, and closes the order', async () => {
    const key = randomUUID();
    const body = { billTotal: 21209, lines: [
      { productId: item['ITM-0025'], received: 117, rejected: 3, rejectReason: 'Goes bad too soon', unitPrice: 77, expiryDate: day(2) },
      { productId: item['ITM-0019'], received: 20, unitPrice: 610, expiryDate: day(170) }] };
    const r = await whm.post(`/orders/${orderId}/deliveries`, body, { key });
    expect(r.status).toBe(201);
    expect(r.body.orderStatus).toBe('RECEIVED');
    expect(r.body.creditDue).toBe(231);
    expect(r.body.flags.map((f: any) => f.kind).sort()).toEqual(['PRICE_UP', 'SENT_BACK']);
    const replay = await whm.post(`/orders/${orderId}/deliveries`, body, { key });
    expect(replay.body.deliveryId).toBe(r.body.deliveryId);
    const stock = (await whm.get(`/catalog/items?siteId=${wh}`)).body.items;
    expect(stock.map((i: any) => [i.name, i.store, i.status])).toEqual([['AMUL BUTTER', 20, 'OK'], ['AMUL TAAZA MILK', 117, 'USE_FIRST']]);
    expect(stock[1].useFirst.quantity).toBe(117);
    expect(stock[0]).toMatchObject({ lastPrice: 610, supplier: { name: 'Shree Dairy', more: 0 } });
    const sup = (await whm.get(`/suppliers/${dairy}`)).body;
    expect(sup.categories[0]).toMatchObject({ name: 'Food', boughtBefore: true, orders: 1 });
    expect(sup.boughtMost.map((b: any) => b.name).sort()).toEqual(['AMUL BUTTER', 'AMUL TAAZA MILK']);
    expect(sup.recentOrders[0]).toMatchObject({ number: 1, status: 'RECEIVED' });
    expect((await whm.get('/suppliers?q=butter')).body.map((s: any) => s.name)).toEqual(['Shree Dairy']);   // found by what was bought
    const home = (await whm.get(`/sites/${wh}/home`)).body;
    expect(home.deliveriesDue).toHaveLength(0);
    expect(home.useFirst.map((u: any) => [u.name, u.quantity])).toEqual([['AMUL TAAZA MILK', 117]]);
    // Photos of the bill and the goods stay with the delivery.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const bnd = 'x' + randomUUID();
    const payload = Buffer.concat([Buffer.from(`--${bnd}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nBILL\r\n--${bnd}\r\nContent-Disposition: form-data; name="photo"; filename="b.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${bnd}--\r\n`)]);
    const up = await w.app.inject({ method: 'POST', url: `/api/v1/deliveries/${r.body.deliveryId}/photos`, payload, headers: { 'content-type': `multipart/form-data; boundary=${bnd}`, cookie: whm.cookie, 'x-requested-with': 'stockwise', 'idempotency-key': randomUUID() } });
    expect(up.statusCode).toBe(201);
    const got = await w.app.inject({ method: 'GET', url: `/api/v1/delivery-photos/${up.json().id}`, headers: { cookie: whm.cookie } });
    expect(got.statusCode).toBe(200); expect(got.headers['content-type']).toBe('image/png'); expect(got.rawPayload.equals(png)).toBe(true);
  });

  it('sending stock to a hotel takes it out of the lot that expires first', async () => {
    const later = await whm.post('/deliveries', { siteId: wh, supplierId: dairy, lines: [{ productId: item['ITM-0025'], received: 50, unitPrice: 77, expiryDate: day(6) }] });
    expect(later.status).toBe(201);
    const t = await whm.post('/transfers', { fromHotelId: wh, toHotelId: w.h[2], lines: [{ productId: item['ITM-0025'], quantity: 130 }] });
    expect(t.status).toBe(201);
    const lots = (await w.db.query('SELECT quantity_received, quantity_left FROM batches WHERE site_id = $1 AND product_id = $2 ORDER BY expiry_date', [wh, item['ITM-0025']])).rows;
    expect(lots.map((l) => [l.quantity_received, l.quantity_left])).toEqual([[117, 0], [50, 37]]);
    const milk = (await whm.get(`/catalog/items?siteId=${wh}&q=taaza`)).body.items[0];
    expect(milk.store).toBe(37);
    // The hotel's own lists now include the item it was sent.
    await mgr3.post(`/transfers/${t.body.transferId}/receipts`, { lines: [{ productId: item['ITM-0025'], receivedQuantity: 130 }] });
    expect((await mgr3.get(`/hotels/${w.h[2]}/stock`)).body.items.some((i: any) => i.productId === item['ITM-0025'] && i.store === 130)).toBe(true);
  });

  it('a hotel can still buy direct, recorded as a delivery with no order', async () => {
    const r = await mgr3.post('/deliveries', { siteId: w.h[2], supplierId: prov, lines: [{ productId: w.p.SOAP, received: 24, unitPrice: 5.5 }] });
    expect(r.status).toBe(201); expect(r.body.orderStatus).toBeNull();
    expect(await bal(w, 2, 'SOAP')).toBe(24);
  });
});

describe('Order from a spoken sentence', () => {
  it('splits numbers, units and names in English and Hindi', () => {
    expect(splitSpokenOrder('twenty kilo butter, fifteen kg cheese and hundred kilo rice')).toEqual([{ quantity: 20, phrase: 'butter' }, { quantity: 15, phrase: 'cheese' }, { quantity: 100, phrase: 'rice' }]);
    expect(splitSpokenOrder('30 litre oil 10 kilo tea')).toEqual([{ quantity: 30, phrase: 'oil' }, { quantity: 10, phrase: 'tea' }]);
    expect(splitSpokenOrder('do sau kilo chawal aur pachas litre doodh')).toEqual([{ quantity: 200, phrase: 'chawal' }, { quantity: 50, phrase: 'doodh' }]);
    expect(splitSpokenOrder('one hundred fifty soap')).toEqual([{ quantity: 150, phrase: 'soap' }]);
  });

  it('builds a draft: supplier found by name, items matched, unclear ones offered as choices; nothing is saved', async () => {
    const before = (await w.db.query('SELECT count(*)::int AS n FROM purchase_orders')).rows[0].n;
    const d = (await whm.post('/orders/draft-from-text', { siteId: wh, text: 'Order from Shree Dairy. Twenty kilo butter, fifteen kilo cheese, hundred kilo rice, thirty litre oil' })).body;
    expect(d.supplier).toMatchObject({ name: 'Shree Dairy' });
    expect(d.lines.map((l: any) => [l.heard, l.quantity, l.match?.name])).toEqual([['butter', 20, 'AMUL BUTTER'], ['cheese', 15, 'AMUL CHEESE'], ['rice', 100, 'Basmati Rice'], ['oil', 30, 'SESAME OIL']]);
    const oil = d.lines[3];
    expect(oil.unsure).toBe(true);
    expect(oil.alternatives.map((a: any) => a.name)).toEqual(['MUSTARD OIL 1 LTR']);
    expect(d.lines[0].unsure).toBe(false);
    expect(d.ready).toBe(true);
    expect((await w.db.query('SELECT count(*)::int AS n FROM purchase_orders')).rows[0].n).toBe(before);
    const none = (await whm.post('/orders/draft-from-text', { siteId: wh, text: 'five kilo unobtainium' })).body;
    expect(none.supplier).toBeNull(); expect(none.lines[0].match).toBeNull(); expect(none.ready).toBe(false);
  });
});

describe('Help from the bill and the web', () => {
  it('a bill is read against the open order lines; nothing is saved', async () => {
    const o = await whm.post('/orders', { siteId: wh, supplierId: dairy, lines: [{ productId: item['ITM-0019'], quantity: 10, unitPrice: 590 }, { productId: item['ITM-0021'], quantity: 4 }] });
    expect(o.status).toBe(201);
    await whm.post(`/orders/${o.body.id}/send`, {});
    const count = async () => (await w.db.query('SELECT count(*)::int AS n FROM deliveries')).rows[0].n;
    const before = await count();
    const f = multipart({}, 'amul butter, 8, 610\nPaper bags, 2, 40');
    const r = await whm.req('POST', `/orders/${o.body.id}/read-bill`, f.body, { headers: f.headers });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ read: true, lines: [{ productId: item['ITM-0019'], quantity: 8, unitPrice: 610 }], extras: [{ name: 'Paper bags', quantity: 2 }], missing: [item['ITM-0021']] });
    expect(await count()).toBe(before);
    await whm.post(`/orders/${o.body.id}/cancel`, {});
  });
  it('web lookup gives options to pick from and is for managers', async () => {
    const r = await whm.get('/catalog/lookup?q=amul%20cheese');
    expect(r.status).toBe(200);
    expect(r.body.options.length).toBeGreaterThan(0);
    expect(r.body.options[0]).toHaveProperty('unit');
    expect((await whm.get('/catalog/lookup?q=a')).status).toBe(400);
  });
});
