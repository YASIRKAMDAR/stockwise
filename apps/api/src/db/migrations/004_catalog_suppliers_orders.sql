-- Full item catalog, suppliers (linked by category, optionally by item), orders to suppliers and deliveries with lots.

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  short_name text NOT NULL,
  code text,
  parent_id uuid REFERENCES categories(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id);
-- Items staff place in rooms. Everything else is warehouse / department stock and stays out of the staff app.
ALTER TABLE products ADD COLUMN IF NOT EXISTS room_item boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_expiry boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS shelf_life_days integer CHECK (shelf_life_days IS NULL OR shelf_life_days > 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS last_price numeric(12,2) CHECK (last_price IS NULL OR last_price >= 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS use_as text NOT NULL DEFAULT 'CONSUMABLE' CHECK (use_as IN ('CONSUMABLE','ASSET'));
UPDATE products SET room_item = true WHERE category_id IS NULL AND created_at < now();
CREATE INDEX IF NOT EXISTS products_org_name ON products (organization_id, lower(name));

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  phone text,
  on_whatsapp boolean NOT NULL DEFAULT true,
  delivery_days integer CHECK (delivery_days IS NULL OR delivery_days BETWEEN 0 AND 60),
  favourite boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_phone ON suppliers (organization_id, phone) WHERE phone IS NOT NULL AND active;
CREATE INDEX IF NOT EXISTS suppliers_org_name ON suppliers (organization_id, lower(name));

-- What a supplier sells: a category (everything in it, or only the picked items).
CREATE TABLE IF NOT EXISTS supplier_categories (
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id),
  all_items boolean NOT NULL DEFAULT true,
  PRIMARY KEY (supplier_id, category_id)
);
CREATE TABLE IF NOT EXISTS supplier_items (
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  PRIMARY KEY (supplier_id, product_id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  number integer NOT NULL,
  site_id uuid NOT NULL REFERENCES hotels(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','PARTIAL','RECEIVED','CANCELLED')),
  source text NOT NULL DEFAULT 'FORM' CHECK (source IN ('FORM','VOICE','CHAT')),
  expected_date date,
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (organization_id, number)
);
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  PRIMARY KEY (order_id, product_id)
);
CREATE INDEX IF NOT EXISTS purchase_orders_site ON purchase_orders (site_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  order_id uuid REFERENCES purchase_orders(id),
  site_id uuid NOT NULL REFERENCES hotels(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  received_by uuid NOT NULL REFERENCES users(id),
  event_id uuid REFERENCES inventory_events(id),
  checked_by text NOT NULL DEFAULT 'COUNT' CHECK (checked_by IN ('COUNT','BILL_PHOTO')),
  bill_total numeric(12,2),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS delivery_lines (
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  ordered integer,
  received integer NOT NULL CHECK (received >= 0),
  rejected integer NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  reject_reason text,
  unit_price numeric(12,2),
  expiry_date date,
  PRIMARY KEY (delivery_id, product_id)
);
-- Photos kept with a delivery as proof: the supplier's bill and the goods.
CREATE TABLE IF NOT EXISTS delivery_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('BILL','GOODS')),
  content_type text NOT NULL,
  data bytea NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- A lot of one item from one delivery. "Use first" = the lot that expires soonest; sending stock out takes from it first.
CREATE TABLE IF NOT EXISTS batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  site_id uuid NOT NULL REFERENCES hotels(id),
  product_id uuid NOT NULL REFERENCES products(id),
  delivery_id uuid REFERENCES deliveries(id),
  expiry_date date,
  quantity_received integer NOT NULL CHECK (quantity_received > 0),
  quantity_left integer NOT NULL CHECK (quantity_left >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batches_site_product ON batches (site_id, product_id, expiry_date NULLS LAST, created_at) WHERE quantity_left > 0;
