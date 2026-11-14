# Remaining work checklist

## Must do before go-live
- [ ] **Live Gemini integration test** with a real paid key: confirm `gemini-3.5-flash-lite` accepts the request shape (`systemInstruction`, `inlineData` audio, `generationConfig.responseJsonSchema`) on your project, and check latency from India.
- [ ] **Multilingual accuracy evaluation**: record ~180 consented utterances (Gujarati 40, Hindi 40, Hinglish 40, English 20, noisy/ambiguous 40) on the actual Android phones. Measure action/product/qty/room accuracy **per language** and the correction rate. Tune product aliases from real staff words. *Nothing has been measured yet.*
- [ ] Have a native speaker review the **Hindi and Gujarati UI strings** (`apps/web/src/i18n.ts`).
- [ ] **Deploy with Docker Compose on the VPS** and verify Caddy TLS, the internal-only DB network and container restarts. (Compose files are written but were not run in the build environment.)
- [ ] **Off-site backup upload** with real bucket credentials, plus a bucket lifecycle rule (`BACKUP_RETENTION_DAYS`). Do a restore drill from the bucket.
- [ ] Set `VOICE_PRICE_*` from Google's official pricing page, and set `VOICE_DAILY_LIMIT_USD`.
- [ ] Enter real hotels, rooms, products/aliases, staff and opening balances (from a physical count). Run the pilot at one hotel.
- [ ] Load test on the VPS against staging.

## Should do (security / ops)
- [ ] TOTP or passkey second factor for owners/managers (password + lockout only today).
- [ ] External alerting (uptime, backup age, disk), wired to a monitor (commands in OPERATIONS.md).
- [ ] PostgreSQL row-level security as defence-in-depth (scoping is currently enforced in the API layer and tested).
- [ ] ESLint/Prettier config and CI pipeline (GitHub Actions: typecheck, tests with a Postgres service, build, `npm audit`).
- [ ] Move the Playwright smoke test (`tests/e2e/smoke_demo.py`) into CI with a fresh DB per run.
- [ ] Periodic cleanup jobs: expired voice proposals, old idempotency records (e.g. > 30 days), revoked sessions.

## Product follow-ups
- [ ] Manager/owner UI is English-only; the staff UI is English/Hindi/Gujarati.
- [ ] Product pictograms are emoji placeholders; replace with real icons/photos.
- [ ] Optional prerecorded confirmation chime / TTS (feature-flagged).
- [ ] Spoken bulk entry during weekly counts (manual entry works now).
- [ ] Staff with memberships at several hotels must use a device enrolled at that hotel; there's no in-app hotel switch for PIN sessions.
- [ ] Offline: unsent confirmations are saved as labelled drafts and retried with the original idempotency key. Full offline sync is out of scope.
- [ ] Expiry dates / lot tracking, PMS occupancy integration, purchasing: out of V1 scope.
- [ ] Server-sent events instead of 15 s polling, if near-real-time matters more.
