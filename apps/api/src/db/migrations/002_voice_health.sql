-- Voice health: which app and input kind each attempt came from, so success rate and latency can be read per app and per language.
ALTER TABLE voice_parse_attempts ADD COLUMN IF NOT EXISTS client text;
ALTER TABLE voice_parse_attempts ADD COLUMN IF NOT EXISTS input_kind text;
ALTER TABLE voice_parse_attempts ADD COLUMN IF NOT EXISTS fallback text;
CREATE INDEX IF NOT EXISTS voice_parse_attempts_org_created ON voice_parse_attempts (organization_id, created_at DESC);
