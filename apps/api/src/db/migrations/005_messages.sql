-- Team chat inside the app: one thread per site. People write in it, and the app posts what happened
-- (a hotel asked the warehouse, an order went to a supplier, a delivery came short) so nobody has to be told on WhatsApp.
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  site_id uuid NOT NULL REFERENCES hotels(id),
  author_id uuid REFERENCES users(id),
  kind text NOT NULL DEFAULT 'TEXT' CHECK (kind IN ('TEXT','REQUEST','REQUEST_SENT','REQUEST_DECLINED','ORDER_SENT','DELIVERY')),
  body text NOT NULL,
  ref_id uuid,
  flagged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_site ON messages (site_id, created_at DESC);
-- One card per event, even when the request that caused it is retried.
CREATE UNIQUE INDEX IF NOT EXISTS messages_once ON messages (ref_id, kind) WHERE ref_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS message_reads (
  user_id uuid NOT NULL REFERENCES users(id),
  site_id uuid NOT NULL REFERENCES hotels(id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, site_id)
);
