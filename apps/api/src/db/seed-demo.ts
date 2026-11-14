/**
 * DEMO DATA ONLY — illustrative hotels/rooms/staff for local evaluation. Refuses to run in production.
 * Opening stock, placements and transfers are posted through the real services (ledger), not raw inserts.
 */
import { createPool } from './pool.ts';
import { migrate } from './migrate.ts';
import { systemActor } from './fixtures.ts';
import { enrollDevice } from '../auth/auth.ts';
import { DEMO_PIN, DEMO_PW, seedDemo } from './demo.ts';
if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force-demo')) {
  console.error('Refusing to seed demo data with NODE_ENV=production.'); process.exit(1);
}
const url = process.env.DATABASE_URL!;
await migrate(url);
const db = createPool(url);
if ((await db.query('SELECT count(*)::int n FROM organizations')).rows[0].n > 0) { console.error('Database already has data; demo seed skipped.'); process.exit(0); }

const { orgId, ownerId, hotels } = await seedDemo(db);
const owner = systemActor(orgId, ownerId);
console.log('\nDEMO data created (sample only — do not use in production).');
console.log(`  Owner:    OWNER / ${DEMO_PW}`);
console.log(`  Managers: MGR1, MGR2, MGR3 / ${DEMO_PW}`);
console.log(`  Staff:    S101, S102 (Hotel 1), S201, S202 (Hotel 2), S301, S302 (Hotel 3) / PIN ${DEMO_PIN}`);
console.log('  Staff PIN login needs an enrolled device: sign in as a manager on the phone and use "Enroll this device for staff".');
if (process.argv.includes('--print-device')) {
  const d = await enrollDevice(db, { ...owner }, hotels[0], 'Demo device H1');
  console.log(`  Demo device for Hotel 1: deviceId=${d.deviceId} deviceSecret=${d.deviceSecret}`);
}
await db.end();
