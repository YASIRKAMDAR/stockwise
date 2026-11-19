import type { Db, Tx } from '../db/pool.ts';
import { withTx } from '../db/pool.ts';
import { err } from '../errors.ts';
import type { Actor } from './actor.ts';

/** Suppliers are managed by managers and the owner (password sign-in), never from a shared staff device. */
export function requireManager(actor: Actor) {
  if (actor.authMethod !== 'PASSWORD' || !(actor.isOwner || actor.memberships.some((m) => m.role === 'MANAGER'))) throw err('FORBIDDEN', 'Managers only');
}
const digits = (s: string) => s.replace(/[^\d+]/g, '');

const CATS_SQL = `
  COALESCE((SELECT json_agg(json_build_object(
      'id', c.id, 'name', c.short_name, 'allItems', sc.all_items,
      'picked', (SELECT count(*)::int FROM supplier_items si JOIN products p ON p.id = si.product_id WHERE si.supplier_id = s.id AND p.category_id = c.id),
      'orders', (SELECT count(DISTINCT o.id)::int FROM purchase_orders o JOIN purchase_order_lines ol ON ol.order_id = o.id JOIN products p ON p.id = ol.product_id
                  WHERE o.supplier_id = s.id AND o.status IN ('SENT','PARTIAL','RECEIVED') AND p.category_id = c.id),
      'lastAt', (SELECT max(o.sent_at) FROM purchase_orders o JOIN purchase_order_lines ol ON ol.order_id = o.id JOIN products p ON p.id = ol.product_id
                  WHERE o.supplier_id = s.id AND o.status IN ('SENT','PARTIAL','RECEIVED') AND p.category_id = c.id)) ORDER BY c.short_name)
    FROM supplier_categories sc JOIN categories c ON c.id = sc.category_id WHERE sc.supplier_id = s.id), '[]')`;

function shape(x: any) {
  const cats = (x.categories as any[]).map((c) => ({ ...c, boughtBefore: c.orders > 0 }));
  return { id: x.id, name: x.name, phone: x.phone, onWhatsapp: x.on_whatsapp, deliveryDays: x.delivery_days, favourite: x.favourite, orders: x.orders,
    lastOrderAt: x.last_order_at, boughtBefore: x.orders > 0, categories: cats };
}

/** Contacts-style list. `q` matches the name, the phone number, a category they sell, or an item bought from or linked to them. */
export async function listSuppliers(db: Db, actor: Actor, o: { q?: string; categoryId?: string }) {
  requireManager(actor);
  const raw = o.q?.trim().toLowerCase().replace(/[%_]/g, '') ?? '';
  const q = raw ? `%${raw}%` : null;
  const ph = raw && digits(raw).length >= 3 ? `%${digits(raw)}%` : null;
  const r = await db.query(
    `SELECT s.id, s.name, s.phone, s.on_whatsapp, s.delivery_days, s.favourite,
            (SELECT count(*)::int FROM purchase_orders o WHERE o.supplier_id = s.id AND o.status IN ('SENT','PARTIAL','RECEIVED')) AS orders,
            (SELECT max(o.sent_at) FROM purchase_orders o WHERE o.supplier_id = s.id) AS last_order_at,
            ${CATS_SQL} AS categories
       FROM suppliers s
      WHERE s.organization_id = $1 AND s.active
        AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM supplier_categories sc WHERE sc.supplier_id = s.id AND sc.category_id = $4))
        AND ($2::text IS NULL OR lower(s.name) LIKE $2 OR ($3::text IS NOT NULL AND regexp_replace(COALESCE(s.phone,''), '[^0-9+]', '', 'g') LIKE $3)
             OR EXISTS (SELECT 1 FROM supplier_categories sc JOIN categories c ON c.id = sc.category_id WHERE sc.supplier_id = s.id AND (lower(c.short_name) LIKE $2 OR lower(c.name) LIKE $2))
             OR EXISTS (SELECT 1 FROM supplier_items si JOIN products p ON p.id = si.product_id WHERE si.supplier_id = s.id AND lower(p.name) LIKE $2)
             OR EXISTS (SELECT 1 FROM purchase_orders o JOIN purchase_order_lines ol ON ol.order_id = o.id JOIN products p ON p.id = ol.product_id
                         WHERE o.supplier_id = s.id AND o.status <> 'CANCELLED' AND lower(p.name) LIKE $2))
      ORDER BY lower(s.name)`, [actor.orgId, q, ph, o.categoryId ?? null]);
  return r.rows.map(shape);
}

async function assertCategories(tx: Tx, orgId: string, ids: string[]) {
  if (!ids.length) return;
  const r = await tx.query('SELECT id FROM categories WHERE organization_id = $1 AND id = ANY($2::uuid[])', [orgId, ids]);
  if (r.rowCount !== new Set(ids).size) throw err('INVALID_INPUT', 'Unknown category');
}

export async function createSupplier(db: Db, actor: Actor, b: { name: string; phone?: string | null; onWhatsapp?: boolean; deliveryDays?: number | null; categoryIds?: string[] }) {
  requireManager(actor);
  const phone = b.phone ? digits(b.phone) : null;
  return withTx(db, async (tx) => {
    if (phone) {
      const dup = await tx.query('SELECT id, name FROM suppliers WHERE organization_id = $1 AND phone = $2 AND active', [actor.orgId, phone]);
      if (dup.rowCount) throw err('INVALID_INPUT', `This number is already saved as ${dup.rows[0].name}`, { supplierId: dup.rows[0].id });
    }
    await assertCategories(tx, actor.orgId, b.categoryIds ?? []);
    const r = await tx.query('INSERT INTO suppliers (organization_id, name, phone, on_whatsapp, delivery_days, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [actor.orgId, b.name.trim(), phone, b.onWhatsapp ?? true, b.deliveryDays ?? null, actor.userId]);
    for (const c of new Set(b.categoryIds ?? [])) await tx.query('INSERT INTO supplier_categories (supplier_id, category_id) VALUES ($1,$2)', [r.rows[0].id, c]);
    return { id: r.rows[0].id as string };
  });
}

async function own(db: Db | Tx, actor: Actor, id: string) {
  const r = await db.query('SELECT id FROM suppliers WHERE id = $1 AND organization_id = $2 AND active', [id, actor.orgId]);
  if (!r.rowCount) throw err('NOT_FOUND', 'Supplier not found');
}

export async function patchSupplier(db: Db, actor: Actor, id: string, b: { name?: string; phone?: string | null; onWhatsapp?: boolean; deliveryDays?: number | null; favourite?: boolean; active?: boolean; categoryIds?: string[] }) {
  requireManager(actor);
  return withTx(db, async (tx) => {
    await own(tx, actor, id);
    const phone = b.phone === undefined ? undefined : b.phone ? digits(b.phone) : null;
    if (phone) {
      const dup = await tx.query('SELECT name FROM suppliers WHERE organization_id = $1 AND phone = $2 AND active AND id <> $3', [actor.orgId, phone, id]);
      if (dup.rowCount) throw err('INVALID_INPUT', `This number is already saved as ${dup.rows[0].name}`);
    }
    await tx.query(
      `UPDATE suppliers SET name = COALESCE($2, name), phone = CASE WHEN $3::boolean THEN $4 ELSE phone END, on_whatsapp = COALESCE($5, on_whatsapp),
              delivery_days = CASE WHEN $6::boolean THEN $7 ELSE delivery_days END, favourite = COALESCE($8, favourite), active = COALESCE($9, active) WHERE id = $1`,
      [id, b.name?.trim() ?? null, phone !== undefined, phone ?? null, b.onWhatsapp ?? null, b.deliveryDays !== undefined, b.deliveryDays ?? null, b.favourite ?? null, b.active ?? null]);
    if (b.categoryIds) {
      await assertCategories(tx, actor.orgId, b.categoryIds);
      await tx.query('DELETE FROM supplier_categories WHERE supplier_id = $1 AND NOT (category_id = ANY($2::uuid[]))', [id, b.categoryIds]);
      for (const c of new Set(b.categoryIds)) await tx.query('INSERT INTO supplier_categories (supplier_id, category_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, c]);
    }
    return { id };
  });
}

/** Within one category: the supplier sells everything, or only the picked items. */
export async function setSupplierCategory(db: Db, actor: Actor, id: string, categoryId: string, b: { allItems: boolean; productIds?: string[] }) {
  requireManager(actor);
  return withTx(db, async (tx) => {
    await own(tx, actor, id);
    await assertCategories(tx, actor.orgId, [categoryId]);
    const ids = [...new Set(b.productIds ?? [])];
    if (ids.length) {
      const p = await tx.query('SELECT id FROM products WHERE organization_id = $1 AND category_id = $2 AND id = ANY($3::uuid[])', [actor.orgId, categoryId, ids]);
      if (p.rowCount !== ids.length) throw err('INVALID_ROOM_OR_PRODUCT', 'An item is not in this category');
    }
    await tx.query('INSERT INTO supplier_categories (supplier_id, category_id, all_items) VALUES ($1,$2,$3) ON CONFLICT (supplier_id, category_id) DO UPDATE SET all_items = EXCLUDED.all_items', [id, categoryId, b.allItems]);
    await tx.query('DELETE FROM supplier_items si USING products p WHERE si.supplier_id = $1 AND p.id = si.product_id AND p.category_id = $2', [id, categoryId]);
    if (!b.allItems) for (const p of ids) await tx.query('INSERT INTO supplier_items (supplier_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, p]);
    return { id, categoryId, allItems: b.allItems, picked: b.allItems ? 0 : ids.length };
  });
}

/** Items of one category for a supplier's picker: ticked ones, with "bought here before" from deliveries and orders. */
export async function supplierCategoryItems(db: Db, actor: Actor, id: string, categoryId: string, q?: string) {
  requireManager(actor); await own(db, actor, id);
  const like = q?.trim() ? `%${q.trim().toLowerCase().replace(/[%_]/g, '')}%` : null;
  const r = await db.query(
    `SELECT p.id, p.name, p.unit, p.photo_url AS "photoUrl",
            EXISTS (SELECT 1 FROM supplier_items si WHERE si.supplier_id = $1 AND si.product_id = p.id) AS picked,
            (SELECT count(DISTINCT o.id)::int FROM purchase_orders o JOIN purchase_order_lines ol ON ol.order_id = o.id WHERE o.supplier_id = $1 AND ol.product_id = p.id AND o.status IN ('SENT','PARTIAL','RECEIVED')) AS times,
            (SELECT ol.unit_price FROM purchase_orders o JOIN purchase_order_lines ol ON ol.order_id = o.id WHERE o.supplier_id = $1 AND ol.product_id = p.id AND o.status IN ('SENT','PARTIAL','RECEIVED') ORDER BY o.sent_at DESC LIMIT 1) AS last_price
       FROM products p WHERE p.organization_id = $2 AND p.active AND p.category_id = $3 AND ($4::text IS NULL OR lower(p.name) LIKE $4)
      ORDER BY 5 DESC, 4 DESC, p.name LIMIT 200`, [id, actor.orgId, categoryId, like]);
  return r.rows.map((x) => ({ id: x.id, name: x.name, unit: x.unit, photoUrl: x.photoUrl, picked: x.picked || x.times > 0, boughtBefore: x.times > 0, times: x.times, lastPrice: x.last_price == null ? null : Number(x.last_price) }));
}

/** The supplier's card: details, what they sell, recent orders and the items bought most often. */
export async function getSupplier(db: Db, actor: Actor, id: string) {
  requireManager(actor); await own(db, actor, id);
  const s = await db.query(
    `SELECT s.id, s.name, s.phone, s.on_whatsapp, s.delivery_days, s.favourite,
            (SELECT count(*)::int FROM purchase_orders o WHERE o.supplier_id = s.id AND o.status IN ('SENT','PARTIAL','RECEIVED')) AS orders,
            (SELECT max(o.sent_at) FROM purchase_orders o WHERE o.supplier_id = s.id) AS last_order_at, ${CATS_SQL} AS categories
       FROM suppliers s WHERE s.id = $1`, [id]);
  const recent = await db.query(
    `SELECT o.id, o.number, o.status, o.sent_at AS "sentAt", o.created_at AS "createdAt",
            (SELECT string_agg(p.name, ', ' ORDER BY p.name) FROM purchase_order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = o.id) AS items,
            (SELECT COALESCE(sum(ol.quantity * COALESCE(ol.unit_price, 0)), 0) FROM purchase_order_lines ol WHERE ol.order_id = o.id) AS total
       FROM purchase_orders o WHERE o.supplier_id = $1 AND o.status <> 'CANCELLED' ORDER BY o.created_at DESC LIMIT 5`, [id]);
  const top = await db.query(
    `SELECT p.id, p.name, p.unit, p.photo_url AS "photoUrl", count(DISTINCT o.id)::int AS times,
            (array_agg(ol.unit_price ORDER BY o.sent_at DESC))[1] AS last_price
       FROM purchase_orders o JOIN purchase_order_lines ol ON ol.order_id = o.id JOIN products p ON p.id = ol.product_id
      WHERE o.supplier_id = $1 AND o.status IN ('SENT','PARTIAL','RECEIVED') GROUP BY p.id ORDER BY times DESC, p.name LIMIT 8`, [id]);
  return { ...shape(s.rows[0]), recentOrders: recent.rows.map((x) => ({ ...x, total: Number(x.total) })), boughtMost: top.rows.map((x) => ({ id: x.id, name: x.name, unit: x.unit, photoUrl: x.photoUrl, times: x.times, lastPrice: x.last_price == null ? null : Number(x.last_price) })) };
}
