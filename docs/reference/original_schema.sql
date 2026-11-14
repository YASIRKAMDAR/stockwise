-- Stockwise reference PostgreSQL schema (v1) — reviewed starting point, not a complete migration system.
-- Build Claude should convert this into versioned migrations and implement balance mutations with SQL transactions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  code text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  room_number text NOT NULL,
  floor_name text,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (hotel_id, room_number)
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_code text NOT NULL,
  display_name text NOT NULL,
  pin_hash text,
  password_hash text,
  preferred_language text NOT NULL DEFAULT 'en',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, employee_code)
);
CREATE TABLE hotel_memberships (
  user_id uuid NOT NULL REFERENCES users(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  role text NOT NULL CHECK (role IN ('STAFF','MANAGER','OWNER')),
  PRIMARY KEY (user_id, hotel_id, role)
);
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  sku text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'pcs',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sku)
);
CREATE TABLE product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  locale text NOT NULL,
  alias text NOT NULL,
  UNIQUE (product_id, locale, alias)
);
CREATE TABLE hotel_product_settings (
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  product_id uuid NOT NULL REFERENCES products(id),
  reorder_threshold integer NOT NULL DEFAULT 0 CHECK (reorder_threshold >= 0),
  suggested_reorder_qty integer NOT NULL DEFAULT 0 CHECK (suggested_reorder_qty >= 0),
  PRIMARY KEY (hotel_id, product_id)
);
CREATE TABLE stock_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  hotel_id uuid REFERENCES hotels(id),
  type text NOT NULL CHECK (type IN ('HOTEL_STORE','STAFF_BAG','TRANSFER_IN_TRANSIT')),
  owner_user_id uuid REFERENCES users(id),
  transfer_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type <> 'HOTEL_STORE') OR (hotel_id IS NOT NULL AND owner_user_id IS NULL AND transfer_id IS NULL)),
  CHECK ((type <> 'STAFF_BAG') OR (hotel_id IS NOT NULL AND owner_user_id IS NOT NULL AND transfer_id IS NULL)),
  CHECK ((type <> 'TRANSFER_IN_TRANSIT') OR (transfer_id IS NOT NULL AND owner_user_id IS NULL))
);
CREATE UNIQUE INDEX stock_location_unique_store ON stock_locations (hotel_id)
  WHERE type = 'HOTEL_STORE';
CREATE UNIQUE INDEX stock_location_unique_staff ON stock_locations (hotel_id, owner_user_id)
  WHERE type = 'STAFF_BAG';
CREATE UNIQUE INDEX stock_location_unique_transit ON stock_locations (transfer_id)
  WHERE type = 'TRANSFER_IN_TRANSIT';
CREATE TABLE stock_balances (
  location_id uuid NOT NULL REFERENCES stock_locations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, product_id)
);
CREATE TABLE inventory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  hotel_context_id uuid REFERENCES hotels(id),
  action text NOT NULL CHECK (action IN (
    'OPENING_BALANCE', 'SUPPLIER_RECEIPT', 'CHECKOUT_TO_STAFF', 'PLACE_IN_ROOM',
    'RETURN_TO_STORE','TRANSFER_DISPATCH','TRANSFER_RECEIPT','TRANSFER_RESOLUTION',
    'WASTE','STOCK_ADJUSTMENT','REVERSAL')),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  reversal_of_event_id uuid REFERENCES inventory_events(id),
  related_transfer_id uuid,
  related_stock_count_id uuid,
  spoken_transcript text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id, idempotency_key)
);
CREATE TABLE inventory_event_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES inventory_events(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  from_location_id uuid REFERENCES stock_locations(id),
  to_location_id uuid REFERENCES stock_locations(id),
  room_id uuid REFERENCES rooms(id),
  note text,
  CHECK (from_location_id IS DISTINCT FROM to_location_id),
  CHECK (from_location_id IS NOT NULL OR to_location_id IS NOT NULL),
  -- A room placement is a flow to guest-room usage, not a stock balance location.
  CHECK (room_id IS NULL OR (from_location_id IS NOT NULL AND to_location_id IS NULL))
);
CREATE INDEX idx_event_lines_product ON inventory_event_lines (product_id);
CREATE INDEX idx_event_lines_room ON inventory_event_lines (room_id) WHERE room_id IS NOT NULL;
CREATE INDEX idx_events_hotel_created ON inventory_events (hotel_context_id, created_at DESC);
CREATE INDEX idx_events_org_created ON inventory_events (organization_id, created_at DESC);

CREATE TABLE transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  ref_code text NOT NULL,
  from_hotel_id uuid NOT NULL REFERENCES hotels(id),
  to_hotel_id uuid NOT NULL REFERENCES hotels(id),
  dispatched_by uuid NOT NULL REFERENCES users(id),
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('IN_TRANSIT','PARTIALLY_RECEIVED','RECEIVED','DISCREPANCY','RESOLVED')),
  note text,
  CHECK (from_hotel_id <> to_hotel_id),
  UNIQUE (organization_id, ref_code)
);
-- Add transfer FK after transfers exists; keep single transit location per transfer.
ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_transfer_id_fk
  FOREIGN KEY (transfer_id) REFERENCES transfers(id);
ALTER TABLE inventory_events ADD CONSTRAINT inventory_events_transfer_fk
  FOREIGN KEY (related_transfer_id) REFERENCES transfers(id);
CREATE TABLE transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES transfers(id),
  product_id uuid NOT NULL REFERENCES products(id),
  sent_qty integer NOT NULL CHECK (sent_qty > 0),
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  resolved_short_qty integer NOT NULL DEFAULT 0 CHECK (resolved_short_qty >= 0),
  CHECK (received_qty + resolved_short_qty <= sent_qty),
  UNIQUE (transfer_id, product_id)
);
CREATE INDEX idx_transfers_to_status ON transfers (to_hotel_id, status, dispatched_at);

CREATE TABLE stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  store_location_id uuid NOT NULL REFERENCES stock_locations(id),
  started_by uuid NOT NULL REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES users(id),
  submitted_at timestamptz,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','CANCELLED')),
  note text
);
ALTER TABLE inventory_events ADD CONSTRAINT inventory_events_count_fk
  FOREIGN KEY (related_stock_count_id) REFERENCES stock_counts(id);
CREATE TABLE stock_count_lines (
  count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  expected_qty integer NOT NULL CHECK (expected_qty >= 0),
  expected_version bigint NOT NULL,
  physical_qty integer CHECK (physical_qty >= 0),
  reason text,
  PRIMARY KEY (count_id, product_id)
);
CREATE INDEX idx_stock_counts_hotel_created ON stock_counts (hotel_id, started_at DESC);

CREATE TABLE voice_parse_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  model_name text NOT NULL,
  language_detected text,
  duration_ms integer,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12,6),
  status text NOT NULL CHECK (status IN ('SUCCESS','AMBIGUOUS','FAILED')),
  correction_needed boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_org_created ON audit_events (organization_id, created_at DESC);

-- Explicit inventory operations / count concurrency algorithms belong in backend service and integration tests.
-- Multi-tenant consistency (hotel/room/product org) must be enforced at backend and can be hardened with RLS/triggers.
-- Rooms do not hold current stock balances in this MVP. Room placements are usage-flow records.

