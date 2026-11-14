import { createHash } from 'node:crypto';
import type { Db, Tx } from '../db/pool.ts';
import { withTx } from '../db/pool.ts';
import { err } from '../errors.ts';
import type { Actor } from './actor.ts';

export function hashRequest(scope: string, body: unknown): string {
  return createHash('sha256').update(scope + '\n' + stableStringify(body)).digest('hex');
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}

export function requireKey(key: string | undefined): string {
  if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw err('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (8-100 chars) is required');
  return key;
}

/**
 * Executes a mutation exactly once per (actor, key). Same key + same payload returns the
 * original stored response; same key + different payload -> 409 IDEMPOTENCY_CONFLICT.
 * Concurrent duplicates are serialised with a transaction-scoped advisory lock.
 */
export async function idempotent<T>(
  db: Db,
  actor: Actor,
  key: string,
  requestHash: string,
  fn: (tx: Tx) => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T; replayed: boolean }> {
  return withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [actor.userId + '|' + key]);
    const prior = await tx.query('SELECT request_hash, status_code, response FROM idempotency_records WHERE actor_user_id = $1 AND idempotency_key = $2', [actor.userId, key]);
    if (prior.rowCount) {
      if (prior.rows[0].request_hash !== requestHash) throw err('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request');
      return { status: prior.rows[0].status_code, body: prior.rows[0].response as T, replayed: true };
    }
    const out = await fn(tx);
    await tx.query(
      'INSERT INTO idempotency_records (actor_user_id, idempotency_key, request_hash, status_code, response) VALUES ($1,$2,$3,$4,$5)',
      [actor.userId, key, requestHash, out.status, JSON.stringify(out.body)],
    );
    return { ...out, replayed: false };
  });
}
