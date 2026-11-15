#!/usr/bin/env bash
# Start the API on :3100 with a fresh demo database and the test-mode voice parser, run the browser tests, stop the API.
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${E2E_DATABASE_URL:-postgresql://postgres@localhost:5432/stockwise_e2e}"
export SESSION_SECRET="${SESSION_SECRET:-$(printf 'x%.0s' $(seq 1 40))}"
export VOICE_PROVIDER=fake NODE_ENV=development PORT=3100 API_PORT=3100 AUTH_RATE_LIMIT_PER_MIN=1000
export SERVE_WEB_DIR="$PWD/apps/web/dist"
psql "${DATABASE_URL%/*}/postgres" -qc 'DROP DATABASE IF EXISTS stockwise_e2e' -c 'CREATE DATABASE stockwise_e2e' >/dev/null
npm run build -w @stockwise/web >/dev/null
(cd apps/api && npx tsx src/db/migrate.ts >/dev/null && npx tsx src/db/seed-demo.ts >/dev/null)
(cd apps/api && npx tsx src/server.ts > /tmp/stockwise-e2e-api.log 2>&1 &) 
for i in $(seq 1 40); do curl -sf "http://localhost:$PORT/health/ready" >/dev/null && break; sleep 0.5; done
trap 'pkill -f "tsx src/server.ts" || true' EXIT
STOCKWISE_URL="http://localhost:$PORT" npx playwright test -c tests/e2e/playwright.config.ts "$@"
