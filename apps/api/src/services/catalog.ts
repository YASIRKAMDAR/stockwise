import type { Db, Tx } from '../db/pool.ts';
import { withTx } from '../db/pool.ts';
import { err } from '../errors.ts';
import { requireHotel, type Actor } from './actor.ts';

/** Everyday names shown in the apps for the item master's formal category names. */
const SHORT: Record<string, string> = {
  'food & beverage': 'Food', 'food items': 'Food', 'fruit & vegetable': 'Fruit & vegetables', 'housekeeping': 'Housekeeping',
  'chemicals & cleaning': 'Cleaning', 'engineering & maintenance': 'Repairs & spares', 'stationery & printing': 'Stationery',
  'uniforms & linen': 'Linen & uniforms', 'it': 'IT', 'fuel & utilities': 'Fuel', 'furniture & fixtures': 'Furniture',
  'crockery, cutlery & glassware': 'Crockery', 'guest supplies': 'Guest supplies', 'kitchen equipment & utensils': 'Kitchen tools',
  'electrical & appliances': 'Electrical', 'electrical & plumbing spares': 'Electrical & plumbing', 'disposables & packaging': 'Disposables',
  'medical & first aid': 'First aid', 'safety & security': 'Safety',
};
const MERGE: Record<string, string> = { 'food items': 'Food & Beverage' };
const UNIT: Record<string, string> = { KGS: 'KG', OTH: 'PCS', '': 'PCS' };

/** Minimal RFC-4180 reader: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== '')) rows.push(row);
  const head = (rows.shift() ?? []).map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export async function ensureCategory(tx: Tx, orgId: string, name: string) {
  const formal = MERGE[name.toLowerCase()] ?? name;
  const short = SHORT[formal.toLowerCase()] ?? formal;
  const r = await tx.query(
    `INSERT INTO categories (organization_id, name, short_name) VALUES ($1,$2,$3)
     ON CONFLICT (organization_id, name) DO UPDATE SET short_name = EXCLUDED.short_name RETURNING id`, [orgId, formal, short]);
  return r.rows[0].id as string;
}

/**
 * Imports an item master export (columns: Code, Name, Alias/Nick Name, Category, Base UOM, Purchase Price, Has Expiry,
 * Shelf Life (days), Use As, Status). Safe to run again: items are matched on Code and updated; nothing is deleted.
 * Inactive rows (merged duplicates) are skipped.
 */
export async function importItems(db: Db, orgId: string, csv: string) {
  const rows = parseCsv(csv);
  if (!rows.length || !('Name' in rows[0]) || !('Code' in rows[0])) throw err('INVALID_INPUT', 'This file needs at least the columns Code and Name');
  return withTx(db, async (tx) => {
    const cats = new Map<string, string>();
    let created = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      const name = r['Name']?.replace(/\s+/g, ' ').trim();
      const code = r['Code']?.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (!name || !code || (r['Status'] ?? '').toLowerCase() === 'inactive') { skipped++; continue; }
      const catName = (r['Category'] ?? '').trim() || 'Other';
      if (!cats.has(catName)) cats.set(catName, await ensureCategory(tx, orgId, catName));
      const rawUnit = (r['Base UOM'] ?? '').trim().toUpperCase();
      const unit = UNIT[rawUnit] ?? rawUnit;
      const price = Number(r['Purchase Price']); const shelf = Number(r['Shelf Life (days)']);
      const useAs = /asset/i.test(r['Use As'] ?? '') ? 'ASSET' : 'CONSUMABLE';
      const up = await tx.query(
        `INSERT INTO products (organization_id, sku, name, unit, category_id, room_item, has_expiry, shelf_life_days, last_price, use_as)
         VALUES ($1,$2,$3,$4,$5,false,$6,$7,$8,$9)
         ON CONFLICT (organization_id, sku) DO UPDATE SET name = EXCLUDED.name, unit = EXCLUDED.unit, category_id = EXCLUDED.category_id,
           has_expiry = EXCLUDED.has_expiry, shelf_life_days = EXCLUDED.shelf_life_days, last_price = COALESCE(products.last_price, EXCLUDED.last_price), use_as = EXCLUDED.use_as
         RETURNING id, (xmax = 0) AS inserted`,
        [orgId, code, name.slice(0, 80), unit.slice(0, 20), cats.get(catName), /^yes$/i.test(r['Has Expiry'] ?? ''), shelf > 0 ? Math.round(shelf) : null, price > 0 ? price : null, useAs]);
      up.rows[0].inserted ? created++ : updated++;
      const alias = (r['Alias/Nick Name'] ?? '').replace(/\s+/g, ' ').trim();
      if (alias && alias.toLowerCase() !== name.toLowerCase())
        await tx.query('INSERT INTO product_aliases (product_id, locale, alias) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [up.rows[0].id, 'en', alias.slice(0, 60)]);
    }
    return { created, updated, skipped, categories: cats.size };
  });
}

export async function listCategories(db: Db, orgId: string) {
  const r = await db.query(
    `SELECT c.id, c.name, c.short_name AS "shortName", (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.active) AS items
       FROM categories c WHERE c.organization_id = $1 ORDER BY items DESC, c.name`, [orgId]);
  return r.rows;
}

/** Days before expiry at which a lot is shown as "use first": a third of its shelf life, between 2 and 7 days. */
export const USE_FIRST_SQL = `LEAST(7, GREATEST(2, COALESCE(p.shelf_life_days, 21) / 3))`;

/**
 * Items at one site with stock, status and supplier tag. Without a search this lists what the site stocks (plus room items);
 * with a search it looks across the whole catalog by name, nickname or code, and by supplier name.
 */
export async function listItems(db: Db, actor: Actor, o: { siteId: string; q?: string; categoryId?: string; filter?: string; limit?: number; offset?: number }) {
  await requireHotel(db, actor, o.siteId);
  const q = o.q?.trim() ? `%${o.q.trim().toLowerCase().replace(/[%_]/g, '')}%` : null;
  const r = await db.query(
    `WITH base AS (
       SELECT p.id, p.sku, p.name, p.unit, p.icon, p.photo_url, p.has_expiry, p.last_price, c.id AS category_id, c.short_name AS category,
              COALESCE((SELECT b.quantity FROM stock_balances b JOIN stock_locations sl ON sl.id = b.location_id
                         WHERE sl.hotel_id = $2 AND sl.type = 'HOTEL_STORE' AND b.product_id = p.id), 0) AS store,
              COALESCE(s.reorder_threshold, 0) AS min, COALESCE(s.par_level, s.reorder_threshold * 2, 0) AS par,
              (SELECT min(bt.expiry_date) FROM batches bt WHERE bt.site_id = $2 AND bt.product_id = p.id AND bt.quantity_left > 0
                 AND bt.expiry_date <= CURRENT_DATE + ${USE_FIRST_SQL}) AS use_first_by,
              (SELECT COALESCE(sum(bt.quantity_left),0)::int FROM batches bt WHERE bt.site_id = $2 AND bt.product_id = p.id AND bt.quantity_left > 0
                 AND bt.expiry_date <= CURRENT_DATE + ${USE_FIRST_SQL}) AS use_first_qty,
              (SELECT json_build_object('id', su.id, 'name', su.name) FROM deliveries d JOIN delivery_lines dl ON dl.delivery_id = d.id JOIN suppliers su ON su.id = d.supplier_id
                WHERE d.organization_id = $1 AND dl.product_id = p.id AND dl.received > 0 ORDER BY d.created_at DESC LIMIT 1) AS last_supplier,
              (SELECT count(DISTINCT d.supplier_id)::int FROM deliveries d JOIN delivery_lines dl ON dl.delivery_id = d.id
                WHERE d.organization_id = $1 AND dl.product_id = p.id AND dl.received > 0) AS supplier_count,
              EXISTS (SELECT 1 FROM stock_balances b JOIN stock_locations sl ON sl.id = b.location_id WHERE sl.hotel_id = $2 AND b.product_id = p.id) AS stocked
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN hotel_product_settings s ON s.hotel_id = $2 AND s.product_id = p.id
        WHERE p.organization_id = $1 AND p.active
          AND ($4::uuid IS NULL OR p.category_id = $4)
          AND ($3::text IS NULL OR lower(p.name) LIKE $3 OR lower(p.sku) LIKE $3
               OR EXISTS (SELECT 1 FROM product_aliases a WHERE a.product_id = p.id AND lower(a.alias) LIKE $3)
               OR EXISTS (SELECT 1 FROM deliveries d JOIN delivery_lines dl ON dl.delivery_id = d.id JOIN suppliers su ON su.id = d.supplier_id
                           WHERE dl.product_id = p.id AND lower(su.name) LIKE $3)))
     SELECT *, count(*) OVER() AS total FROM base
      WHERE ($3::text IS NOT NULL OR $4::uuid IS NOT NULL OR stocked OR $5::text IS NOT NULL)
        AND ($5::text IS NULL OR ($5 = 'low' AND min > 0 AND store <= min) OR ($5 = 'usefirst' AND use_first_by IS NOT NULL))
      ORDER BY (store > 0) DESC, name LIMIT $6 OFFSET $7`,
    [actor.orgId, o.siteId, q, o.categoryId ?? null, o.filter ?? null, Math.min(o.limit ?? 50, 200), o.offset ?? 0]);
  return {
    total: Number(r.rows[0]?.total ?? 0),
    items: r.rows.map((x) => ({
      id: x.id, code: x.sku, name: x.name, unit: x.unit, icon: x.icon, photoUrl: x.photo_url, category: x.category, categoryId: x.category_id,
      store: x.store, min: x.min, par: x.par, lastPrice: x.last_price == null ? null : Number(x.last_price), hasExpiry: x.has_expiry,
      status: x.use_first_by ? 'USE_FIRST' : x.min > 0 && x.store <= x.min ? 'LOW' : x.store > 0 ? 'OK' : 'NONE',
      useFirst: x.use_first_by ? { by: x.use_first_by, quantity: x.use_first_qty } : null,
      supplier: x.last_supplier ? { ...x.last_supplier, more: Math.max(0, x.supplier_count - 1) } : null,
    })),
  };
}

/** Adds one item to the catalog (from the app's "add an item" screen). The code is generated. */
export async function createItem(db: Db, actor: Actor, b: { name: string; unit: string; categoryId?: string | null; photoUrl?: string | null; price?: number | null; hasExpiry?: boolean; shelfLifeDays?: number | null }) {
  return withTx(db, async (tx) => {
    const dup = await tx.query('SELECT id FROM products WHERE organization_id = $1 AND lower(name) = lower($2) AND active', [actor.orgId, b.name.trim()]);
    if (dup.rowCount) return { id: dup.rows[0].id as string, existed: true };
    if (b.categoryId) { const c = await tx.query('SELECT 1 FROM categories WHERE id = $1 AND organization_id = $2', [b.categoryId, actor.orgId]); if (!c.rowCount) throw err('INVALID_INPUT', 'Unknown category'); }
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['item-code|' + actor.orgId]);
    const n = await tx.query(`SELECT COALESCE(max(substring(sku from 'APP-([0-9]+)')::int), 0) + 1 AS n FROM products WHERE organization_id = $1 AND sku LIKE 'APP-%'`, [actor.orgId]);
    const r = await tx.query(
      `INSERT INTO products (organization_id, sku, name, unit, category_id, photo_url, last_price, has_expiry, shelf_life_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [actor.orgId, `APP-${String(n.rows[0].n).padStart(4, '0')}`, b.name.trim().slice(0, 80), b.unit.trim().toUpperCase().slice(0, 20) || 'PCS', b.categoryId ?? null, b.photoUrl ?? null, b.price ?? null, b.hasExpiry ?? false, b.shelfLifeDays ?? null]);
    return { id: r.rows[0].id as string, existed: false };
  });
}

/** Takes stock leaving a site out of its lots, soonest-to-expire first. Lots are a guide to "use first"; balances stay the source of truth. */
export async function consumeBatches(tx: Tx, siteId: string, productId: string, quantity: number) {
  let left = quantity;
  const r = await tx.query(`SELECT id, quantity_left FROM batches WHERE site_id = $1 AND product_id = $2 AND quantity_left > 0 ORDER BY expiry_date NULLS LAST, created_at FOR UPDATE`, [siteId, productId]);
  for (const b of r.rows) {
    if (left <= 0) break;
    const take = Math.min(left, b.quantity_left);
    await tx.query('UPDATE batches SET quantity_left = quantity_left - $2 WHERE id = $1', [b.id, take]);
    left -= take;
  }
}
