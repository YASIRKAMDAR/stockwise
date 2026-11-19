/** DEMO DATA ONLY. Posts opening stock, placements and transfers through the real services. */
import { randomUUID } from 'node:crypto';
import type { Db } from './pool.ts';
import { createHotel, createOrg, createProduct, createRooms, createUser, DEMO_PRODUCTS, systemActor } from './fixtures.ts';
import { createTransaction } from '../services/transactions.ts';
import { dispatchTransfer } from '../services/transfers.ts';
import { createRequest, dispatchRequest } from '../services/requests.ts';
import { importItems } from '../services/catalog.ts';
import { createSupplier } from '../services/suppliers.ts';
import { createOrder, receiveDelivery, sendOrder } from '../services/orders.ts';

export const DEMO_PIN = '1234', DEMO_PW = 'demo-password-123';

export async function seedDemo(db: Db) {
  const orgId = await createOrg(db, 'Demo Hotel Group (sample data)');
  const hotels: string[] = [];
  const rooms: Record<string, string>[] = [];
  for (let i = 1; i <= 3; i++) {
    const h = await createHotel(db, orgId, `H${i}`, `Demo Hotel ${i}`);
    hotels.push(h);
    rooms.push(await createRooms(db, h, [...Array(10)].map((_, k) => String(101 + k)).concat([...Array(10)].map((_, k) => String(201 + k)))));
  }
  // The central warehouse holds the primary inventory; hotels keep a buffer and ask it for top-ups.
  const warehouse = await createHotel(db, orgId, 'WH', 'Central Warehouse', 'Asia/Kolkata', 'WAREHOUSE');
  const products: Record<string, string> = {};
  for (const [sku, name, unit, aliases] of DEMO_PRODUCTS) products[sku] = await createProduct(db, orgId, sku, name, unit, aliases);
  const ownerId = await createUser(db, orgId, { code: 'OWNER', name: 'Demo Owner', password: DEMO_PW, owner: true });
  const whManagerId = await createUser(db, orgId, { code: 'WHMGR', name: 'Warehouse Manager', password: DEMO_PW, memberships: [{ hotelId: warehouse, role: 'MANAGER' }] });
  const staff: string[][] = [];
  for (let i = 0; i < 3; i++) {
    await createUser(db, orgId, { code: `MGR${i + 1}`, name: `Demo Manager ${i + 1}`, password: DEMO_PW, memberships: [{ hotelId: hotels[i], role: 'MANAGER' }] });
    staff.push([
      await createUser(db, orgId, { code: `S${i + 1}01`, name: `Staff ${i + 1}01`, pin: DEMO_PIN, memberships: [{ hotelId: hotels[i], role: 'STAFF' }], lang: ['gu', 'hi', 'en'][i] }),
      await createUser(db, orgId, { code: `S${i + 1}02`, name: `Staff ${i + 1}02`, pin: DEMO_PIN, memberships: [{ hotelId: hotels[i], role: 'STAFF' }] }),
    ]);
  }
  const owner = systemActor(orgId, ownerId);
  const thresholds: Record<string, number> = { SOAP: 60, SHAMPOO: 50, COMB: 30, DENTAL_KIT: 40, TOOTHBRUSH: 30, TOOTHPASTE: 30 };
  for (const [i, h] of hotels.entries()) {
    for (const [sku, t] of Object.entries(thresholds)) await db.query('INSERT INTO hotel_product_settings VALUES ($1,$2,$3,$4)', [h, products[sku], t, t * 3]);
    await createTransaction(db, owner, { action: 'OPENING_BALANCE', hotelId: h, note: 'Demo opening balance',
      lines: Object.keys(products).map((sku, k) => ({ productId: products[sku], quantity: [200, 120, 80, 90, 70, i === 2 ? 20 : 60][k] })) }, randomUUID());
  }
  // Warehouse opening stock: the bulk of everything.
  await createTransaction(db, owner, { action: 'OPENING_BALANCE', hotelId: warehouse, note: 'Demo warehouse opening balance',
    lines: Object.keys(products).map((sku) => ({ productId: products[sku], quantity: { SOAP: 2000, SHAMPOO: 1500, COMB: 600, DENTAL_KIT: 800, TOOTHBRUSH: 700, TOOTHPASTE: 900 }[sku] ?? 500 })) }, randomUUID());
  // Some staff activity at each hotel, through the same service the API uses.
  for (const [i, h] of hotels.entries()) {
    const s = systemActor(orgId, staff[i][0], { isOwner: false, authMethod: 'PIN', activeHotelId: h, memberships: [{ hotelId: h, role: 'STAFF' }] });
    await createTransaction(db, s, { action: 'CHECKOUT_TO_STAFF', hotelId: h, lines: [{ productId: products.SOAP, quantity: 20 }, { productId: products.SHAMPOO, quantity: 10 }] }, randomUUID());
    for (const room of ['101', '102', '103', '201', '204']) {
      await createTransaction(db, s, { action: 'PLACE_IN_ROOM', hotelId: h, lines: [
        { productId: products.SOAP, quantity: 2, roomId: rooms[i][room], source: 'MY_STOCK' }, { productId: products.SHAMPOO, quantity: 1, roomId: rooms[i][room], source: 'MY_STOCK' }] }, randomUUID());
    }
  }
  // Two pending transfers.
  await dispatchTransfer(db, owner, { fromHotelId: hotels[0], toHotelId: hotels[1], lines: [{ productId: products.DENTAL_KIT, quantity: 20 }], note: 'Demo transfer' }, randomUUID());
  await dispatchTransfer(db, owner, { fromHotelId: hotels[1], toHotelId: hotels[2], lines: [{ productId: products.TOOTHPASTE, quantity: 15 }, { productId: products.SOAP, quantity: 10 }] }, randomUUID());

  // Hotel 3 is low on toothpaste and asks the warehouse; Hotel 2's request has already been sent and is on the way.
  const mgr3 = systemActor(orgId, (await db.query(`SELECT id FROM users WHERE organization_id=$1 AND employee_code='MGR3'`, [orgId])).rows[0].id, { isOwner: false, authMethod: 'PASSWORD', memberships: [{ hotelId: hotels[2], role: 'MANAGER' }] });
  await createRequest(db, mgr3, { hotelId: hotels[2], lines: [{ productId: products.TOOTHPASTE, quantity: 60 }, { productId: products.SOAP, quantity: 100 }], note: 'Running low before the weekend' });
  const mgr2 = systemActor(orgId, (await db.query(`SELECT id FROM users WHERE organization_id=$1 AND employee_code='MGR2'`, [orgId])).rows[0].id, { isOwner: false, authMethod: 'PASSWORD', memberships: [{ hotelId: hotels[1], role: 'MANAGER' }] });
  const r2 = await createRequest(db, mgr2, { hotelId: hotels[1], lines: [{ productId: products.SHAMPOO, quantity: 80 }] });
  const whm = systemActor(orgId, whManagerId, { isOwner: false, authMethod: 'PASSWORD', memberships: [{ hotelId: warehouse, role: 'MANAGER' }] });
  await dispatchRequest(db, whm, r2.body.requestId, {}, randomUUID());
  // Every hotel auto-asks for a top-up to par on Monday mornings.
  for (const h of hotels) await db.query('INSERT INTO request_schedules (organization_id, hotel_id, weekday, hour, created_by) VALUES ($1,$2,1,7,$3)', [orgId, h, ownerId]);

  // A slice of a real-looking item list, three suppliers, one delivery already checked in and one order on its way.
  await importItems(db, orgId, DEMO_ITEMS_CSV);
  const it = Object.fromEntries((await db.query(`SELECT sku, id FROM products WHERE organization_id = $1 AND sku LIKE 'ITM-%'`, [orgId])).rows.map((r) => [r.sku, r.id as string]));
  const cat = Object.fromEntries((await db.query('SELECT short_name, id FROM categories WHERE organization_id = $1', [orgId])).rows.map((r) => [r.short_name, r.id as string]));
  const dairy = (await createSupplier(db, whm, { name: 'Demo Dairy', phone: '+91 90000 00001', deliveryDays: 1, categoryIds: [cat.Food] })).id;
  const prov = (await createSupplier(db, whm, { name: 'Demo Provisions', phone: '+91 90000 00002', deliveryDays: 2, categoryIds: [cat.Food] })).id;
  await createSupplier(db, whm, { name: 'Demo Cleaning Supplies', phone: '+91 90000 00003', deliveryDays: 2, categoryIds: [cat.Cleaning, cat.Housekeeping].filter(Boolean) });
  for (const [sku, min, par] of [['ITM-0019', 15, 40], ['ITM-0021', 8, 24], ['ITM-0001', 80, 200], ['ITM-0293', 20, 60], ['ITM-0025', 20, 120], ['ITM-0178', 5, 25], ['ITM-0731', 20, 60]] as const)
    await db.query('INSERT INTO hotel_product_settings (hotel_id, product_id, reorder_threshold, par_level) VALUES ($1,$2,$3,$4) ON CONFLICT (hotel_id, product_id) DO UPDATE SET reorder_threshold = EXCLUDED.reorder_threshold, par_level = EXCLUDED.par_level', [warehouse, it[sku], min, par]);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const o1 = await createOrder(db, whm, { siteId: warehouse, supplierId: dairy, lines: [{ productId: it['ITM-0025'], quantity: 30 }, { productId: it['ITM-0178'], quantity: 6 }, { productId: it['ITM-0019'], quantity: 12 }] });
  await sendOrder(db, whm, o1.id);
  await receiveDelivery(db, whm, { orderId: o1.id, lines: [
    { productId: it['ITM-0025'], received: 30, unitPrice: 77, expiryDate: day(2) }, { productId: it['ITM-0178'], received: 6, unitPrice: 360, expiryDate: day(2) },
    { productId: it['ITM-0019'], received: 12, unitPrice: 590.48, expiryDate: day(150) }] }, randomUUID());
  const o2 = await createOrder(db, whm, { siteId: warehouse, supplierId: dairy, lines: [{ productId: it['ITM-0025'], quantity: 120 }, { productId: it['ITM-0178'], quantity: 25 }, { productId: it['ITM-0019'], quantity: 20 }], expectedDate: day(0) });
  await sendOrder(db, whm, o2.id);
  await receiveDelivery(db, whm, { siteId: warehouse, supplierId: prov, lines: [{ productId: it['ITM-0001'], received: 60, unitPrice: 114 }, { productId: it['ITM-0293'], received: 18, unitPrice: 210, expiryDate: day(160) }] }, randomUUID());

  return { orgId, ownerId, hotels, warehouse };
}

const DEMO_ITEMS_CSV = `Code,Name,Alias/Nick Name,Category,Base UOM,Purchase Price,Has Expiry,Shelf Life (days),Use As,Status
ITM-0001,BASMATI RICE,RICE,Food & Beverage,KG,114,No,,Consumable,Active
ITM-0011,TEA POWDER TATA AGNI,TEA,Food & Beverage,KG,235,No,,Consumable,Active
ITM-0012,MAIDA 1 KG,MAIDA,Food & Beverage,KG,37.5,No,,Consumable,Active
ITM-0019,AMUL BUTTER,BUTTER,Food & Beverage,KG,590.48,Yes,180,Consumable,Active
ITM-0021,AMUL CHEESE,CHEESE,Food & Beverage,KG,538.1,Yes,180,Consumable,Active
ITM-0022,AMUL CHEESE SLICE 750 GM,CHEESE SLICE,Food & Beverage,PAC,419.05,Yes,180,Consumable,Active
ITM-0025,AMUL TAAZA MILK,MILK,Food & Beverage,LTR,77,Yes,7,Consumable,Active
ITM-0178,FRESH PANEER,PANEER,Food & Beverage,KG,360,Yes,7,Consumable,Active
ITM-0293,MUSTARD OIL 1 LTR,MUSTARD OIL,Food & Beverage,LTR,210,Yes,180,Consumable,Active
ITM-0387,SESAME OIL,TIL OIL,Food & Beverage,LTR,,Yes,180,Consumable,Active
ITM-0562,ONION,KANDA,Fruit & Vegetable,KG,40,Yes,5,Consumable,Active
ITM-0567,POTATO,BATATA,Fruit & Vegetable,KG,30,Yes,5,Consumable,Active
ITM-0673,SHAMPOO 20 ML,SHAMPOO SMALL,Housekeeping,BTL,5.5,No,,Consumable,Active
ITM-0677,SOAP 20 GM,SOAP SMALL,Housekeeping,PCS,5.5,No,,Consumable,Active
ITM-0725,DISH WASH LIQUID SOAP,DISH WASH,Chemicals & Cleaning,LTR,26.5,No,,Consumable,Active
ITM-0731,HARPIC RED,HARPIC,Chemicals & Cleaning,LTR,110,No,,Consumable,Active
ITM-0898,LED BULB 0-5 WATT,LED BULB,Engineering & Maintenance,PCS,,No,,Consumable,Active
ITM-1202,BATH TOWEL MAXUS,BATH TOWEL,Uniforms & Linen,PCS,397,No,,Consumable,Active
`;
