/**
 * Production bootstrap: creates the organisation and ONE owner account. Hotels, rooms, products,
 * staff and opening balances are then configured in the app (Settings) — no imaginary data.
 *   BOOTSTRAP_OWNER_PASSWORD=... npm run bootstrap -w @stockwise/api -- --org "My Hotels" --owner-code OWNER --owner-name "Owner"
 */
import { parseArgs } from 'node:util';
import { createPool } from './pool.ts';
import { migrate } from './migrate.ts';
import { createOrg, createUser } from './fixtures.ts';

const { values } = parseArgs({ options: { org: { type: 'string' }, 'owner-code': { type: 'string' }, 'owner-name': { type: 'string' } } });
const pw = process.env.BOOTSTRAP_OWNER_PASSWORD;
if (!values.org || !values['owner-code'] || !values['owner-name'] || !pw || pw.length < 12) {
  console.error('Usage: BOOTSTRAP_OWNER_PASSWORD=<12+ chars> bootstrap --org <name> --owner-code <code> --owner-name <name>');
  process.exit(1);
}
const url = process.env.DATABASE_URL!;
await migrate(url);
const db = createPool(url);
const existing = await db.query('SELECT count(*)::int AS n FROM organizations');
if (existing.rows[0].n > 0) { console.error('An organisation already exists; refusing to bootstrap twice.'); process.exit(1); }
const orgId = await createOrg(db, values.org);
await createUser(db, orgId, { code: values['owner-code'], name: values['owner-name'], password: pw, owner: true });
console.log(`Created organisation and owner ${values['owner-code']}. Sign in and configure hotels, rooms, products and staff in Settings.`);
await db.end();
