# Stockwise

Voice-first stock management for a small hotel chain (built for 3 hotels; hotels are configurable). Staff say or tap what they did, check an editable proposal, and confirm. Each confirmation is an immutable, idempotent ledger entry. Managers do weekly storeroom counts. Owners see live stock, staff-held and in-transit balances, room placements, alerts, trends and exports.

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite PWA (`apps/web`), TanStack Query |
| API | Node 22 + Fastify 5 + Zod (`apps/api`) |
| Data | PostgreSQL 16, plain SQL migrations, append-only ledger + balance projection |
| Voice | Gemini `gemini-3.5-flash-lite` direct audio → JSON proposal, server-side adapter (`apps/api/src/voice`) |
| Deploy | Docker Compose + Caddy (auto-HTTPS) on one Ubuntu VPS; encrypted `pg_dump` to S3-compatible storage |

## Repository layout
```
apps/api/src/
  db/            migrations/001_init.sql, migrate.ts, seed-demo.ts (demo only), bootstrap.ts (production)
  services/      ledger.ts (the only stock write path), transactions, transfers, counts, reports, idempotency, actor (RBAC)
  voice/         provider.ts (Gemini + FAKE), prompt.ts, service.ts (validation + catalog resolution), fake.ts
  auth/          argon2id PIN/password, device enrollment, sessions, lockout
  routes/        REST API under /api/v1
apps/api/test/   invariants (INV-01..20), RBAC/auth/validation, voice pipeline + Gemini contract
apps/web/src/    staff/ (Speak, review, My stock, Transfers, Activity), manager/ (weekly count), owner/ (dashboards, settings)
packages/shared/ Zod DTOs, enums, voice_intent_schema.json
infra/           compose.yaml, Caddyfile, backup.sh, restore.sh, verify-ledger.sql
tests/           voice-fixtures/, e2e/smoke_demo.py (Playwright), load/load-demo.mts
docs/            BUILD_SPEC.md (original), SPEC_INCONSISTENCIES.md, SECURITY_PRIVACY.md, REMAINING_WORK.md, OPERATIONS.md
```

## Local development
Prerequisites: Node 22+, PostgreSQL 16 (local or `docker run -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16`).

```bash
npm install
createdb stockwise_dev
export DATABASE_URL=postgresql://postgres@localhost:5432/stockwise_dev
export SESSION_SECRET=$(openssl rand -base64 48) VOICE_PROVIDER=fake

npm run db:seed:demo -- --print-device   # DEMO data only; refuses to run with NODE_ENV=production
npm run dev:api                          # http://localhost:3000 (runs migrations on start)
npm run dev:web                          # http://localhost:5173 (proxies /api)
```
Demo logins (printed by the seed): `OWNER` / `MGR1..3` with password `demo-password-123`. Staff `S101`, `S201`, … use PIN `1234`, but only on an **enrolled device**. To enroll one, sign in as a manager on that phone and go to **Settings → Enroll this device for staff**, then sign out.

With `VOICE_PROVIDER=fake`, the Speak screen shows a *developer: simulate speech* box. It runs a rule-based text parser so you can exercise the proposal → review → confirm flow. **It is not speech recognition.**

### Checks
```bash
npm run typecheck   # shared + api + web
npm test            # API integration tests against real PostgreSQL (creates/drops stockwise_test)
npm run build       # production web bundle + api typecheck
```
Tests need a reachable Postgres. Set `TEST_DATABASE_URL` if it isn't `postgresql://postgres@localhost:5432/stockwise_test`.

## Production on a VPS (Ubuntu 24.04, 2 vCPU / 2–4 GB)
1. **Harden the host:** create a non-root sudo user, use SSH keys only, run `ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`, and install `unattended-upgrades`.
2. **Install Docker Engine + compose plugin** (docs.docker.com/engine/install/ubuntu).
3. **Point DNS** (A/AAAA) for your domain at the VPS.
4. **Configure:** `git clone … && cd stockwise && cp .env.example .env`, then set `STOCKWISE_DOMAIN`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `BACKUP_*`, and the voice settings. `chmod 600 .env`.
5. **Start:** `cd infra && docker compose --env-file ../.env up -d --build`. Caddy obtains TLS certificates automatically. Postgres is on an internal network with no published port.
6. **Bootstrap the organisation and the first owner** (once):
   ```bash
   docker compose --env-file ../.env exec -e BACKUP_PASSPHRASE= -e BOOTSTRAP_OWNER_PASSWORD='<12+ chars>' api \
     node --import tsx apps/api/src/db/bootstrap.ts --org "Your Hotels" --owner-code OWNER --owner-name "Owner"
   ```
   Then sign in at `https://<domain>` and use **Settings** to add the real hotels, rooms (e.g. `101-120, 201-220`), products with spoken aliases, managers/staff, thresholds, and **opening balances**. Opening balances are posted as signed ledger events. No demo data is loaded in production.
7. **Health:** `curl https://<domain>/health/ready` should return `{"status":"ok","db":"ok",…}`.
8. **Backups:** add a root crontab entry: `15 2 * * * cd /path/stockwise/infra && docker compose --env-file ../.env --profile backup run --rm backup >> /var/log/stockwise-backup.log 2>&1`. Then **do a restore drill** (see `docs/OPERATIONS.md`).
9. **Smoke test** each flow once: supplier receipt, take stock, room placement, transfer + partial receipt, weekly count, owner dashboard.
10. **Pilot** at one hotel before enabling all three (see `docs/BUILD_SPEC.md` §06).

To enable voice: set `VOICE_PROVIDER=gemini` and `GEMINI_API_KEY` (use a **paid** Gemini API project, since free-tier data terms differ). Set the `VOICE_PRICE_*` values from Google's pricing page, then `docker compose up -d`. Manual entry keeps working if voice is disabled, over budget, or the provider is down.

## What is real vs simulated in this build
| Area | Status |
|---|---|
| Ledger, balances, transfers, counts, reversals, idempotency, RBAC, sessions, device enrollment, lockout | **Implemented and tested** against PostgreSQL 16 (74 automated tests) |
| Staff / manager / owner UIs | **Implemented**. Browser smoke-tested with Playwright over demo data (phone + desktop viewports) |
| Gemini adapter | **Implemented**. Request/response contract tested with a mocked HTTP client. **No live Gemini call has been made**: no API key was available. Real Gujarati/Hindi/Hinglish accuracy is **unmeasured** |
| FAKE voice provider | Rule-based text parser for CI/demo only. Clearly labelled in the API (`SIMULATED_PROVIDER`) and UI |
| Docker Compose / Caddy / HTTPS | Files written. **Not executed here** (no Docker daemon in the build environment) |
| Backup → encrypted → restore → ledger verification | **Executed locally** (gpg + pg_dump/pg_restore). Off-site upload step not exercised (no bucket credentials) |
| Performance | Measured locally (see `docs/OPERATIONS.md`). Not measured on a VPS |
