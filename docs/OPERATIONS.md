# Operations runbook

## Health & monitoring
- `GET /health/live` checks that the process is up. `GET /health/ready` checks the DB connection and reports the voice provider. The Docker healthcheck uses `/health/ready`.
- Structured JSON logs (pino) include a request ID that matches the `X-Request-ID` response header. Secrets are redacted. View them with `docker compose logs -f api`.
- **Suggested cron alerts** (via any uptime/cron monitor, e.g. healthchecks.io):
  - `/health/ready` fails
  - backup older than 26 h: `docker run --rm -v stockwise_backup_staging:/b alpine sh -c 'test $(( $(date +%s) - $(cat /b/LAST_SUCCESS) )) -lt 93600'`
  - disk over 80%: `df /`
- In-app (Owner → Alerts / Reports): low stock, transfers past the age limit, discrepancies, overdue counts, large variances, repeated voice failures, and voice cost per day.
- Targets: RPO 24 h (nightly backup), RTO 4–8 h (rebuild VPS + restore). Tighten after the pilot.

## Backup & restore drill (do monthly)
```bash
# on any machine with gpg + postgres 16 client
aws s3 cp s3://bucket/stockwise/stockwise-<stamp>.dump.gpg . --endpoint-url $BACKUP_ENDPOINT
aws s3 cp s3://bucket/stockwise/stockwise-<stamp>.dump.gpg.sha256 . --endpoint-url $BACKUP_ENDPOINT
createdb stockwise_restore
BACKUP_PASSPHRASE=... infra/restore.sh stockwise-<stamp>.dump.gpg postgresql://…/stockwise_restore
# -> prints events/lines/balances and "ledger verification PASSED" (fails loudly on any mismatch or negative balance)
```
Executed in the build environment against the demo DB: 25 events / 60 lines / 27 balances, 0 mismatches, PASSED.

**Full VPS loss:** provision a new VPS → follow README steps 1–5 (skip bootstrap) → stop `api` → restore into the `stockwise` DB inside the postgres container → start `api` → check `/health/ready` and the owner dashboard.

## Measured locally (not on a VPS)
Build machine: 2 vCPU, local PostgreSQL 16, API + DB on the same host.

| Measurement | Result |
|---|---|
| 120,060 movement lines (synthetic), owner overview all hotels / 90 days | median 25 ms |
| Room-placement analytics (90 days, all hotels) | median 165 ms |
| Activity page (50 rows) | median 2 ms (was 440 ms before query rewrite) |
| Load: 30 concurrent sessions × 40 mixed requests (1,200 total) | reads p95 68 ms, writes p95 108 ms, dashboard p95 75 ms, 0 errors; ledger verified afterwards (0 mismatches) |

Re-run on the real VPS with `tests/load/load-demo.mts` against a **staging** copy before launch.

## Common tasks
- **Lost phone:** Settings → Enrolled devices → Revoke.
- **Locked staff:** Settings → Staff → Unlock or Reset PIN.
- **Wrong entry:** Activity → Reverse (manager/owner, reason required). History is preserved.
- **Transfer short:** the receiver taps "That's all that came" → Owner/Manager → Transfers → Resolve.
- **Model upgrade:** change `GEMINI_MODEL`, run the voice evaluation corpus on staging, compare per-language accuracy, then deploy.
- **Schema change:** add `apps/api/src/db/migrations/00N_*.sql`. Migrations run on API start under an advisory lock. Never edit an applied migration.
