-- One central warehouse holds the primary inventory; hotels keep a buffer and ask the warehouse when low.
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'HOTEL' CHECK (kind IN ('HOTEL','WAREHOUSE'));
CREATE UNIQUE INDEX IF NOT EXISTS hotels_one_warehouse ON hotels (organization_id) WHERE kind = 'WAREHOUSE' AND active;

-- A hotel's request to the warehouse. Dispatching turns it into a normal transfer; receiving that transfer closes it.
CREATE TABLE IF NOT EXISTS stock_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  warehouse_id uuid NOT NULL REFERENCES hotels(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SENT','RECEIVED','DECLINED','CANCELLED')),
  note text,
  transfer_id uuid REFERENCES transfers(id),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stock_request_lines (
  request_id uuid NOT NULL REFERENCES stock_requests(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (request_id, product_id)
);
CREATE INDEX IF NOT EXISTS stock_requests_open ON stock_requests (organization_id, status, created_at);

-- Par level: the quantity a hotel's store should be topped up to. Null means twice the reorder threshold.
ALTER TABLE hotel_product_settings ADD COLUMN IF NOT EXISTS par_level integer CHECK (par_level IS NULL OR par_level >= 0);

-- Auto-request schedule: at the set weekday/hour (hotel local time) a request is created for everything below par.
CREATE TABLE IF NOT EXISTS request_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0=Sun
  hour smallint NOT NULL DEFAULT 7 CHECK (hour BETWEEN 0 AND 23),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  last_run_at timestamptz,
  last_request_id uuid REFERENCES stock_requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, weekday, hour)
);
