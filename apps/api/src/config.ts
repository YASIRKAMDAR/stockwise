import { z } from 'zod';

const bool = z.preprocess((v) => (typeof v === 'string' ? ['1', 'true', 'yes'].includes(v.toLowerCase()) : v), z.boolean());

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  API_PORT: z.coerce.number().int().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  TRUST_PROXY: bool.default(false),
  SERVE_WEB_DIR: z.string().optional(),
  SESSION_TTL_HOURS_PIN: z.coerce.number().int().positive().default(12),
  SESSION_TTL_HOURS_PASSWORD: z.coerce.number().int().positive().default(12),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  VOICE_PROVIDER: z.enum(['gemini', 'fake', 'disabled']).default('disabled'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_API_BASE: z.string().url().default('https://generativelanguage.googleapis.com/v1beta'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(6000),
  VOICE_BUDGET_MS: z.coerce.number().int().positive().default(7000),
  VOICE_MAX_SECONDS: z.coerce.number().int().positive().default(25),
  VOICE_MAX_BYTES: z.coerce.number().int().positive().default(3_000_000),
  VOICE_DAILY_LIMIT_USD: z.coerce.number().nonnegative().default(3),
  VOICE_PRICE_INPUT_PER_M_USD: z.coerce.number().nonnegative().default(0.3),
  VOICE_PRICE_OUTPUT_PER_M_USD: z.coerce.number().nonnegative().default(2.5),
  VOICE_PROPOSAL_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  VOICE_RETAIN_AUDIO: bool.default(false),
  OWNER_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(overrides: Record<string, string | undefined> = {}): Config {
  const parsed = Env.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    throw new Error('Invalid environment: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const cfg = parsed.data;
  // Adding GEMINI_API_KEY is enough to switch on Google's model (unless voice is turned off).
  if (cfg.GEMINI_API_KEY && cfg.VOICE_PROVIDER === 'fake' && cfg.NODE_ENV !== 'test') cfg.VOICE_PROVIDER = 'gemini';
  // Gemini without a key would fail every request: keep the simple test parser instead of refusing to start.
  if (cfg.VOICE_PROVIDER === 'gemini' && !cfg.GEMINI_API_KEY) cfg.VOICE_PROVIDER = cfg.NODE_ENV === 'production' ? 'fake' : cfg.VOICE_PROVIDER;
  if (cfg.VOICE_PROVIDER === 'gemini' && !cfg.GEMINI_API_KEY) {
    throw new Error('VOICE_PROVIDER=gemini requires GEMINI_API_KEY');
  }
  if (cfg.VOICE_RETAIN_AUDIO) {
    // Retention is deliberately not implemented: audio is processed in memory only.
    throw new Error('VOICE_RETAIN_AUDIO=true is not supported in this build (no raw audio retention).');
  }
  return cfg;
}
