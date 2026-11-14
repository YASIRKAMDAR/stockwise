/**
 * Vercel serverless entry. One Fastify instance per warm function instance; DB pool kept small
 * because each instance holds its own connections (use the provider's POOLED connection string).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db/pool.ts';
import { migrate } from './db/migrate.ts';
import { seedDemo } from './db/demo.ts';

const env = process.env;
// Accept the variable names Vercel's Neon/Postgres integrations inject.
const DATABASE_URL = env.DATABASE_URL || env.POSTGRES_URL || env.DATABASE_URL_UNPOOLED;

let ready: Promise<Awaited<ReturnType<typeof buildApp>>> | null = null;
async function init() {
  const cfg = loadConfig({ DATABASE_URL, TRUST_PROXY: 'true', SERVE_WEB_DIR: '' });
  if (env.MIGRATE_ON_START !== 'false') await migrate(env.DATABASE_URL_UNPOOLED || DATABASE_URL!, () => {});
  const db = createPool(cfg.DATABASE_URL, 3);
  // Opt-in DEMO data for evaluation deployments only: SEED_DEMO_ON_EMPTY=true and the DB has no organisation yet.
  if (env.SEED_DEMO_ON_EMPTY === 'true') {
    const c = await db.connect();
    try {
      await c.query('SELECT pg_advisory_lock(727002)');
      const n = (await c.query('SELECT count(*)::int n FROM organizations')).rows[0].n;
      if (n === 0) { await seedDemo(db); console.log('DEMO data seeded (SEED_DEMO_ON_EMPTY=true)'); }
    } finally { await c.query('SELECT pg_advisory_unlock(727002)').catch(() => {}); c.release(); }
  }
  const app = await buildApp({ db, cfg });
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= init().catch((e) => { ready = null; throw e; });
  try {
    const app = await ready;
    app.server.emit('request', req, res);
  } catch (e) {
    console.error('startup failed', e);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'TEMPORARY_UNAVAILABLE', message: 'Service is starting or misconfigured' } }));
  }
}
