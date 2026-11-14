import type { Tx } from '../db/pool.ts';

export async function storeLocation(tx: Tx, orgId: string, hotelId: string): Promise<string> {
  await tx.query(
    `INSERT INTO stock_locations (organization_id, hotel_id, type) VALUES ($1,$2,'HOTEL_STORE')
     ON CONFLICT (hotel_id) WHERE type = 'HOTEL_STORE' DO NOTHING`,
    [orgId, hotelId],
  );
  const r = await tx.query(`SELECT id FROM stock_locations WHERE hotel_id = $1 AND type = 'HOTEL_STORE'`, [hotelId]);
  return r.rows[0].id;
}

/** Staff bags are scoped per user + hotel; never shared across hotels. */
export async function bagLocation(tx: Tx, orgId: string, hotelId: string, userId: string): Promise<string> {
  await tx.query(
    `INSERT INTO stock_locations (organization_id, hotel_id, type, owner_user_id) VALUES ($1,$2,'STAFF_BAG',$3)
     ON CONFLICT (hotel_id, owner_user_id) WHERE type = 'STAFF_BAG' DO NOTHING`,
    [orgId, hotelId, userId],
  );
  const r = await tx.query(`SELECT id FROM stock_locations WHERE hotel_id = $1 AND owner_user_id = $2 AND type = 'STAFF_BAG'`, [hotelId, userId]);
  return r.rows[0].id;
}

export async function transitLocation(tx: Tx, orgId: string, transferId: string, fromHotelId: string): Promise<string> {
  const r = await tx.query(
    `INSERT INTO stock_locations (organization_id, hotel_id, type, transfer_id) VALUES ($1,$2,'TRANSFER_IN_TRANSIT',$3) RETURNING id`,
    [orgId, fromHotelId, transferId],
  );
  return r.rows[0].id;
}
