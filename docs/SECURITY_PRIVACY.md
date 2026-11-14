# Security & privacy guidance

## What the code enforces
- **Authorization on the server.** Every route resolves the actor from the session and checks hotel + role with `requireHotel()` / `scopeHotels()`. Hotel IDs from the client are only accepted after that check. PIN sessions are pinned to the enrolled device's hotel. Tests: `rbac-auth.test.ts`, INV-15.
- **Shared phones.** Staff can sign in with a PIN only on a device a manager has enrolled. The per-device secret is stored hashed. Revoking a device ends its sessions immediately. Logout revokes the server session and clears local user data (drafts, cached queries). The service worker never caches `/api` responses.
- **Credentials.** PINs and passwords are hashed with argon2id. After 5 failures an account locks for 15 minutes (configurable). Login is rate-limited per IP. PINs, passwords, device secrets and cookies are redacted from logs. Failed logins are audited without the attempted secret.
- **Sessions.** Random 256-bit token, stored as a SHA-256 hash. Signed `HttpOnly; SameSite=Strict; Secure` cookie (in production). 12 h expiry. Revoked on PIN/password reset or deactivation.
- **CSRF.** SameSite=Strict, plus mutating API calls must send `X-Requested-With: stockwise`.
- **Ledger integrity.** A database trigger blocks `UPDATE`/`DELETE` on `inventory_events` and `inventory_event_lines`. There is no `DELETE /transactions`. Balances have `CHECK (quantity >= 0)`. Each mutation is one transaction with row locks taken in a fixed order, plus an idempotency record.
- **Voice is untrusted input.** The model has no tool or database access. Output is schema-validated (Zod, `.strict()`), and every product, room and hotel is re-resolved against the catalog. Nothing changes stock until a human confirms. Confirmation revalidates stock and room status. Proposals expire (10 min) and are single-use. Prompt-injection text is treated as data (tested).
- **No raw audio retention.** Audio is held in memory only for the provider call. `VOICE_RETAIN_AUDIO=true` is refused at startup. Only metadata is stored: duration, bytes, tokens, cost, status.
- **Headers.** HSTS, CSP, `X-Frame-Options: DENY`, `Permissions-Policy` (microphone=self) via Caddy. `nosniff` and `no-store` on API responses.
- **Network.** Only Caddy publishes ports 80/443. Postgres sits on an `internal: true` Docker network. The API container is read-only with `no-new-privileges`.
- **CSV exports** neutralise spreadsheet formula injection.

## What you must do operationally
1. Use a **paid** Gemini API project and review Google's data-processing terms and processing location before sending staff voice recordings. Get staff consent for the pilot recordings used for accuracy testing.
2. Review cross-border data-processing obligations (Indian DPDP Act 2023, plus any local rules where the hotels or owners are). Staff ID + display name is enough; don't store phone numbers or other personal details. No guest data is collected.
3. Keep `.env` at `chmod 600`. Rotate `SESSION_SECRET` if leaked (this signs everyone out). Store `BACKUP_PASSPHRASE` offline: without it, backups cannot be restored.
4. Restrict SSH (keys only), keep the host patched, and limit who can run `docker` (docker group = root).
5. When a phone is lost, **revoke the device** (Settings → Enrolled devices). When someone leaves, **deactivate the user**.
6. Run `npm audit` before each deploy and pin base images.

## Known gaps (see REMAINING_WORK.md)
No TOTP/passkey for owners/managers yet. No row-level security in Postgres (scoping is enforced in the app layer). Rate limiting is in-memory, which is fine for a single API instance.
