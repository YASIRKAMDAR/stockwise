import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

// Return bigint/int8 counts as JS numbers (quantities are small integers).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export function createPool(url: string, max = 10): Db {
  return new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30_000 });
}

const RETRYABLE = new Set(['40P01', '40001']); // deadlock, serialization failure

/** Runs fn inside BEGIN/COMMIT. Retries only on deadlock/serialization errors (bounded). */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (RETRYABLE.has(e?.code) && i < attempts) continue;
      throw e;
    } finally {
      client.release();
    }
  }
}
