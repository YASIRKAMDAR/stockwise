-- Stockwise v1 schema. Derived from backend/schema.sql with additions needed for
-- sessions, device enrollment, idempotency, voice proposals, settings and immutability.
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
  allow_store_to_room boolean NOT NULL DEFAULT true,
  count_week_start smallint NOT NULL DEFAULT 1 CHECK (count_week_start BETWEEN 0 AND 6), -- 0=Sun
  transfer_aging_hours integer NOT NULL DEFAULT 24 CHECK (transfer_aging_hours > 0),
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
  -- Chain-wide role. Owners see every hotel in the organisation (incl. hotels added later).
  org_role text CHECK (org_role IN ('OWNER')),
  preferred_language text NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en','hi','gu')),
  active boolean NOT NULL DEFAULT true,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, employee_code)
);

CREATE TABLE hotel_memberships (
  user_id uuid NOT NULL REFERENCES users(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  role text NOT NULL CHECK (role IN ('STAFF','MANAGER')),
  PRIMARY KEY (user_id, hotel_id, role)
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  label text NOT NULL,
  secret_hash text NOT NULL,
  enrolled_by uuid NOT NULL REFERENCES users(id),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  device_id uuid REFERENCES devices(id),
  active_hotel_id uuid REFERENCES hotels(id),
  auth_method text NOT NULL CHECK (auth_method IN ('PIN','PASSWORD')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX idx_sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  sku text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'pcs',
  icon text,
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
CREATE INDEX idx_alias_lower ON product_aliases (lower(alias));

CREATE TABLE hotel_product_settings (
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  product_id uuid NOT NULL REFERENCES products(id),
  reorder_threshold integer NOT NULL DEFAULT 0 CHECK (reorder_threshold >= 0),
  suggested_reorder_qty integer NOT NULL DEFAULT 0 CHECK (suggested_reorder_qty >= 0),
  PRIMARY KEY (hotel_id, product_id)
);

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
CREATE INDEX idx_transfers_to_status ON transfers (to_hotel_id, status, dispatched_at);
CREATE INDEX idx_transfers_from_status ON transfers (from_hotel_id, status, dispatched_at);
CREATE SEQUENCE transfer_ref_seq START 1001;

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

CREATE TABLE stock_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  hotel_id uuid REFERENCES hotels(id),
  type text NOT NULL CHECK (type IN ('HOTEL_STORE','STAFF_BAG','TRANSFER_IN_TRANSIT')),
  owner_user_id uuid REFERENCES users(id),
  transfer_id uuid REFERENCES transfers(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type <> 'HOTEL_STORE') OR (hotel_id IS NOT NULL AND owner_user_id IS NULL AND transfer_id IS NULL)),
  CHECK ((type <> 'STAFF_BAG') OR (hotel_id IS NOT NULL AND owner_user_id IS NOT NULL AND transfer_id IS NULL)),
  CHECK ((type <> 'TRANSFER_IN_TRANSIT') OR (transfer_id IS NOT NULL AND owner_user_id IS NULL))
);
CREATE UNIQUE INDEX stock_location_unique_store ON stock_locations (hotel_id) WHERE type = 'HOTEL_STORE';
CREATE UNIQUE INDEX stock_location_unique_staff ON stock_locations (hotel_id, owner_user_id) WHERE type = 'STAFF_BAG';
CREATE UNIQUE INDEX stock_location_unique_transit ON stock_locations (transfer_id) WHERE type = 'TRANSFER_IN_TRANSIT';

CREATE TABLE stock_balances (
  location_id uuid NOT NULL REFERENCES stock_locations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, product_id)
);

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
CREATE UNIQUE INDEX one_draft_count_per_hotel ON stock_counts (hotel_id) WHERE status = 'DRAFT';
CREATE INDEX idx_stock_counts_hotel_created ON stock_counts (hotel_id, started_at DESC);

CREATE TABLE stock_count_lines (
  count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  expected_qty integer NOT NULL CHECK (expected_qty >= 0),
  expected_version bigint NOT NULL,
  physical_qty integer CHECK (physical_qty >= 0),
  reason text,
  PRIMARY KEY (count_id, product_id)
);

CREATE TABLE inventory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  session_id uuid REFERENCES sessions(id),
  device_id uuid REFERENCES devices(id),
  hotel_context_id uuid REFERENCES hotels(id),
  action text NOT NULL CHECK (action IN (
    'OPENING_BALANCE','SUPPLIER_RECEIPT','CHECKOUT_TO_STAFF','PLACE_IN_ROOM',
    'RETURN_TO_STORE','TRANSFER_DISPATCH','TRANSFER_RECEIPT','TRANSFER_RESOLUTION',
    'WASTE','STOCK_ADJUSTMENT','REVERSAL')),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  reversal_of_event_id uuid REFERENCES inventory_events(id),
  related_transfer_id uuid REFERENCES transfers(id),
  related_stock_count_id uuid REFERENCES stock_counts(id),
  voice_proposal_id uuid,
  reason text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id, idempotency_key)
);
-- An event can be reversed at most once.
CREATE UNIQUE INDEX one_reversal_per_event ON inventory_events (reversal_of_event_id) WHERE reversal_of_event_id IS NOT NULL;
CREATE INDEX idx_events_hotel_created ON inventory_events (hotel_context_id, created_at DESC);
CREATE INDEX idx_events_org_created ON inventory_events (organization_id, created_at DESC);
CREATE INDEX idx_events_action_hotel_created ON inventory_events (action, hotel_context_id, created_at);
CREATE INDEX idx_events_related_transfer ON inventory_events (related_transfer_id) WHERE related_transfer_id IS NOT NULL;

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
CREATE INDEX idx_event_lines_event ON inventory_event_lines (event_id);
CREATE INDEX idx_event_lines_product ON inventory_event_lines (product_id);
CREATE INDEX idx_event_lines_room ON inventory_event_lines (room_id) WHERE room_id IS NOT NULL;
CREATE INDEX idx_event_lines_from ON inventory_event_lines (from_location_id);
CREATE INDEX idx_event_lines_to ON inventory_event_lines (to_location_id);

-- Immutable ledger: block UPDATE/DELETE on events and lines.
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory ledger is append-only (% on %)', TG_OP, TG_TABLE_NAME;
END $$;
CREATE TRIGGER inventory_events_immutable BEFORE UPDATE OR DELETE ON inventory_events
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER inventory_event_lines_immutable BEFORE UPDATE OR DELETE ON inventory_event_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TABLE idempotency_records (
  actor_user_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status_code integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, idempotency_key)
);

CREATE TABLE voice_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  proposal jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_event_id uuid REFERENCES inventory_events(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE voice_parse_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  proposal_id uuid REFERENCES voice_proposals(id),
  model_name text NOT NULL,
  language_detected text,
  duration_ms integer,
  audio_bytes integer,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12,6),
  latency_ms integer,
  status text NOT NULL CHECK (status IN ('SUCCESS','AMBIGUOUS','FAILED')),
  error_code text,
  correction_needed boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_voice_attempts_created ON voice_parse_attempts (organization_id, created_at DESC);

CREATE TABLE correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid NOT NULL REFERENCES inventory_events(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  note text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','DISMISSED')),
  resolved_by uuid REFERENCES users(id),
  resolution_event_id uuid REFERENCES inventory_events(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
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
