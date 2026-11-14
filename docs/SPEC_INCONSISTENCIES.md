# Spec inconsistencies found and how they were resolved

The handoff said the ZIP contains `prototype/index.html`, screenshots, a separate `CLAUDE.md` and other files. **Only the consolidated Markdown spec was provided**, so the UI is built from the UX spec (docs/02), not the prototype.

| # | Where | Inconsistency | Resolution |
|---|---|---|---|
| 1 | schema.sql `hotel_memberships.role` | Allows `OWNER` per hotel, but the PRD says owners are chain-wide (and should see hotels added later) | Added `users.org_role = 'OWNER'`. Memberships hold only `STAFF`/`MANAGER` |
| 2 | schema.sql | No tables for sessions, device enrollment, stored idempotent responses, voice proposals, correction requests, or hotel settings, all of which the PRD requires | Added `sessions`, `devices`, `idempotency_records`, `voice_proposals`, `correction_requests`, plus hotel columns `allow_store_to_room`, `count_week_start`, `transfer_aging_hours` |
| 3 | API §Inventory: `lines[].sourceLocationId` | The client supplies raw location IDs, which conflicts with "never trust hotel IDs from the client" | The client sends `source: STORE \| MY_STOCK`. The server resolves the actual location from the session user + hotel |
| 4 | API action enum | `OPENING_BALANCE` is in the schema, and the UX requires "Set opening balance", but the API doesn't expose it | Added to `POST /transactions`, owner-only |
| 5 | API `POST /auth/staff-login {…, hotelId}` | Device enrollment is required but no endpoints are defined. A client-supplied `hotelId` would let a PIN session pick its hotel | Added `POST /devices` (manager/owner), `POST /devices/:id/revoke`. A PIN session is pinned to the **device's** hotel. `hotelId` in the body is ignored |
| 6 | API `POST /auth/owner-login {email}` | The schema has no email column, and managers also need "stronger" login | `POST /auth/login {employeeCode, password}` for managers and owners (argon2id, 10+ chars, lockout). Email/OTP is listed in remaining work |
| 7 | Transfers `DISCREPANCY` status | Never says what moves a transfer into it | The receiver taps **"That's all that came"** (`final: true`) → `DISCREPANCY`. A manager/owner resolves it with a `TRANSFER_RESOLUTION` event |
| 8 | INV-09 "Reject or limit" | Ambiguous | Rejected with `409 TRANSFER_CONFLICT` and the remaining quantity in `details` |
| 9 | API `POST /counts {hotelId, locationId}` | Counts are store-only, so `locationId` is redundant and a misuse vector | Body is `{hotelId}`. The store location is resolved server-side |
| 10 | "Overdue counts" | Not defined | `COMPLETED` if signed off since the start of this week (hotel timezone + configurable week start). `DUE` if last signed off during the previous week. Otherwise `OVERDUE` |
| 11 | Reversing a room placement | Schema `CHECK` forbids `room_id` on lines with a destination, so a reversal can't be a "negative placement" | The reversal moves goods back to the original source with no `room_id`. Placement reports exclude reversed events |
| 12 | Voice `TRANSFER_RECEIPT` | Receipts need a specific transfer reference. Spec: "show matching incoming transfers; never create duplicate receipt" | Voice never creates receipts. The proposal returns `NEEDS_CLARIFICATION` + `USE_INCOMING_TRANSFERS`, and the UI points staff to Transfers → Incoming |
| 13 | Room placement default source | The PRD says default to the bag "if sufficient", but the voice doc says "do not infer source" | Server defaults to `MY_STOCK` **only** when the bag covers every line. Otherwise the line is flagged `CHOOSE_SOURCE` and the UI forces a choice. `POST /transactions` requires an explicit source per line (no silent server default) |
| 14 | Auth: "JWT with rotating refresh tokens" vs "secure server sessions" | Either allowed | Opaque, server-side sessions (hashed token, signed `HttpOnly SameSite=Strict` cookie). Instantly revocable on logout, PIN reset, deactivation, or device revocation |
| 15 | Voice prices | "Avoid hard-coded cost claims" vs a cost dashboard | Prices are env-configurable (`VOICE_PRICE_*`, default 0). The dashboard shows tokens and computed USD. The daily cap uses the same numbers |
| 16 | Sender receiving own transfer | "unless policy explicitly grants" | Blocked for staff/managers. Owners are allowed (they hold every role) |
| 17 | Staff activity visibility | Staff "see own carried stock and recent activity" | `GET /transactions` returns only the caller's own events for staff, and the whole hotel for managers/owners |
| 18 | Example IDs (`p-soap`, `room-h1-203`, …) | Human-readable IDs in the examples | UUIDs everywhere. Human-facing references are short event IDs and transfer refs `T1001…` |
