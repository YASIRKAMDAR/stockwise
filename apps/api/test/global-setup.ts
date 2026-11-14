import pg from 'pg';
import { migrate } from '../src/db/migrate.ts';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/stockwise_test';

export default async function setup() {
  const u = new URL(TEST_DB);
  const name = u.pathname.slice(1);
  u.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  await migrate(TEST_DB, () => {});
}
