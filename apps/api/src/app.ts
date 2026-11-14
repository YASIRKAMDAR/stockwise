import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db/pool.ts';
import { AppError, err } from './errors.ts';
import { loadActor, SESSION_COOKIE } from './auth/auth.ts';
import type { Actor } from './services/actor.ts';
import { registerRoutes } from './routes/index.ts';
import { createProvider, type VoiceProvider } from './voice/provider.ts';

declare module 'fastify' {
  interface FastifyRequest { actor: Actor | null }
}

export interface AppDeps { db: Db; cfg: Config; voice?: VoiceProvider | null }

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw err('INVALID_INPUT', 'Invalid request', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export function requireActor(req: FastifyRequest): Actor {
  if (!req.actor) throw err('UNAUTHENTICATED', 'Please sign in');
  return req.actor;
}

export function send(reply: FastifyReply, out: { status: number; body: unknown; replayed?: boolean }) {
  if (out.replayed) reply.header('Idempotent-Replayed', 'true');
  return reply.code(out.status).send(out.body);
}

export async function buildApp({ db, cfg, voice }: AppDeps) {
  const app = Fastify({
    logger: cfg.NODE_ENV === 'test' ? false : {
      level: cfg.LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.pin', 'req.body.password', 'req.body.deviceSecret'],
    },
    trustProxy: cfg.TRUST_PROXY,
    genReqId: () => randomUUID(),
    bodyLimit: 256 * 1024,
  });
  const provider = voice === undefined ? createProvider(cfg) : voice;

  await app.register(cookie, { secret: cfg.SESSION_SECRET });
  await app.register(multipart, { limits: { fileSize: cfg.VOICE_MAX_BYTES, files: 1, fields: 6 } });
  await app.register(rateLimit, {
    global: true, max: 300, timeWindow: '1 minute',
    // Per session when signed in (many shared phones sit behind one hotel Wi-Fi IP), else per IP.
    keyGenerator: (req) => (req.cookies?.[SESSION_COOKIE] ? 's:' + req.cookies[SESSION_COOKIE].slice(0, 64) : 'ip:' + req.ip),
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, error: { code: 'RATE_LIMITED', message: `Too many requests. Retry in ${Math.ceil(ctx.ttl / 1000)}s` } }),
  });

  app.decorateRequest('actor', null);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-ID', req.id);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (!req.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    // CSRF defence in depth (cookies are SameSite=Strict): mutating API calls must carry a custom header.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'stockwise') {
      throw err('FORBIDDEN', 'Missing X-Requested-With header');
    }
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    req.actor = unsigned?.valid ? await loadActor(db, cfg, unsigned.value ?? undefined) : null;
  });

  app.setErrorHandler((e: any, req, reply) => {
    if (e instanceof AppError) return reply.code(e.status).send({ error: { code: e.code, message: e.message, details: e.details } });
    if (e instanceof ZodError) return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: 'Invalid request', details: e.issues } });
    if (e?.statusCode === 429) return reply.code(429).send(e.error ? { error: e.error } : { error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    if (e?.code === '23514') return reply.code(409).send({ error: { code: 'INSUFFICIENT_STOCK', message: 'Stock cannot go negative' } });
    if (e?.code === '22P02') return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: 'Malformed identifier' } });
    if (e?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(422).send({ error: { code: 'UNSUPPORTED_AUDIO', message: 'Recording too large' } });
    if (e?.validation || e?.statusCode === 400 || e?.statusCode === 415) return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: e.message } });
    req.log.error({ err: e }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'TEMPORARY_UNAVAILABLE', message: 'Something went wrong. Nothing was saved unless you saw a confirmation.', details: { requestId: req.id } } });
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ok', db: 'ok', voiceProvider: provider?.name ?? 'disabled' };
    } catch {
      return reply.code(503).send({ status: 'degraded', db: 'unreachable' });
    }
  });

  await app.register(async (api) => registerRoutes(api, { db, cfg, provider }), { prefix: '/api/v1' });

  if (cfg.SERVE_WEB_DIR && existsSync(cfg.SERVE_WEB_DIR)) {
    await app.register(fastifyStatic, { root: cfg.SERVE_WEB_DIR, wildcard: false, list: false, dotfiles: 'deny' });
    // Android app link verification (the static server denies dot-folders, so this one file is served explicitly).
    app.get('/.well-known/assetlinks.json', async (_req, reply) => {
      const { readFile } = await import('node:fs/promises');
      try { return reply.type('application/json').send(await readFile(`${cfg.SERVE_WEB_DIR}/.well-known/assetlinks.json`, 'utf8')); }
      catch { return reply.code(404).send({ error: 'NOT_FOUND' }); }
    });
    // App shell and service worker must revalidate so deploys take effect; hashed assets can cache long.
    app.addHook('onSend', async (req, reply, payload) => {
      if (req.url.startsWith('/api/')) return payload;
      const ct = String(reply.getHeader('content-type') ?? '');
      if (ct.includes('text/html') || req.url.startsWith('/sw.js')) reply.header('Cache-Control', 'no-cache');
      else if (req.url.startsWith('/assets/')) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return payload;
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
