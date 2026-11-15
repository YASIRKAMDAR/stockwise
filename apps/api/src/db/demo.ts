/** DEMO DATA ONLY. Posts opening stock, placements and transfers through the real services. */
import { randomUUID } from 'node:crypto';
import type { Db } from './pool.ts';
import { createHotel, createOrg, createProduct, createRooms, createUser, DEMO_PRODUCTS, systemActor } from './fixtures.ts';
import { createTransaction } from '../services/transactions.ts';
import { dispatchTransfer } from '../services/transfers.ts';
import { createRequest, dispatchRequest } from '../services/requests.ts';

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

  return { orgId, ownerId, hotels, warehouse };
}
