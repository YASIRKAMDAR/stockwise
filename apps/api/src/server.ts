import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db/pool.ts';
import { migrate } from './db/migrate.ts';

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
if (process.env.MIGRATE_ON_START !== 'false') await migrate(cfg.DATABASE_URL);
const app = await buildApp({ db, cfg });
await app.listen({ port: cfg.API_PORT, host: cfg.API_HOST });
app.log.info({ voiceProvider: cfg.VOICE_PROVIDER, model: cfg.GEMINI_MODEL }, 'stockwise api ready');
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await app.close(); await db.end(); process.exit(0); });
