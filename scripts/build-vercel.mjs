// Produces Vercel Build Output API v3 in .vercel/output: static PWA + one Node function for /api and /health.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const out = '.vercel/output';
const fn = `${out}/functions/api.func`;
rmSync(out, { recursive: true, force: true });
execSync('npm run build -w @stockwise/web', { stdio: 'inherit' });
mkdirSync(`${out}/static`, { recursive: true });
cpSync('apps/web/dist', `${out}/static`, { recursive: true });

mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ['apps/api/src/vercel-handler.ts'],
  bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: `${fn}/index.mjs`,
  external: ['@node-rs/argon2'], // native addon: shipped as files below
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
cpSync('apps/api/src/db/migrations', `${fn}/migrations`, { recursive: true });
for (const pkg of ['@node-rs/argon2', '@node-rs/argon2-linux-x64-gnu']) {
  const src = `node_modules/${pkg}`;
  if (!existsSync(src)) throw new Error(`${pkg} missing — run npm install on linux x64`);
  cpSync(src, `${fn}/node_modules/${pkg}`, { recursive: true });
}
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'module' }));
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30, memory: 1024 }, null, 2));
writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '^/(api|health)/(.*)$', dest: '/api' },
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/(sw\\.js|index\\.html)?$', headers: { 'cache-control': 'no-cache' }, continue: true },
    { src: '^/(.*)$', headers: {
        'strict-transport-security': 'max-age=31536000; includeSubDomains', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff',
        'permissions-policy': 'microphone=(self), camera=(), geolocation=()',
        'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'",
      }, continue: true },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
}, null, 2));
console.log('Vercel build output ready in .vercel/output');
