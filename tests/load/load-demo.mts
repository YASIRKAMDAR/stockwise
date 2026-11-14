// 30 concurrent sessions x 40 mixed requests against the running dev server (DEMO data).
const B = 'http://localhost:3000/api/v1';
const H = { 'content-type': 'application/json', 'x-requested-with': 'stockwise' };
async function login(code: string) {
  const r = await fetch(B + '/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ employeeCode: code, password: 'demo-password-123' }) });
  return r.headers.get('set-cookie')!.split(';')[0];
}
const codes = ['MGR1', 'MGR2', 'MGR3', 'OWNER'];
const cookies = []; for (let i = 0; i < 30; i++) cookies.push(await login(codes[i % 4]));
const me = await (await fetch(B + '/me', { headers: { ...H, cookie: cookies[0] } })).json();
const h1 = me.hotels[0].id; const products = await (await fetch(B + '/products', { headers: { ...H, cookie: cookies[0] } })).json();
const comb = products.find((p: any) => p.sku === 'COMB').id;
const lat: Record<string, number[]> = { read: [], write: [], dashboard: [] }; let errors = 0, conflicts = 0;
async function worker(i: number) {
  const cookie = cookies[i]; const code = codes[i % 4];
  const hotel = code === 'OWNER' ? h1 : (await (await fetch(B + '/me', { headers: { ...H, cookie } })).json()).hotels[0].id;
  for (let n = 0; n < 40; n++) {
    const kind = n % 4 === 0 ? 'write' : n % 4 === 1 ? 'dashboard' : 'read';
    const t = performance.now(); let r: Response;
    if (kind === 'write') r = await fetch(B + '/transactions', { method: 'POST', headers: { ...H, cookie, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ action: n % 8 === 0 ? 'CHECKOUT_TO_STAFF' : 'RETURN_TO_STORE', hotelId: hotel, lines: [{ productId: comb, quantity: 1 }] }) });
    else if (kind === 'dashboard') r = await fetch(B + `/dashboard/overview?hotelId=${code === 'OWNER' ? 'all' : hotel}&periodDays=30`, { headers: { ...H, cookie } });
    else r = await fetch(B + `/hotels/${hotel}/stock`, { headers: { ...H, cookie } });
    await r.text(); lat[kind].push(performance.now() - t);
    if (r.status === 409) conflicts++; else if (r.status >= 400) errors++;
  }
}
const t0 = performance.now(); await Promise.all(cookies.map((_, i) => worker(i))); const total = performance.now() - t0;
const pct = (a: number[], p: number) => a.sort((x, y) => x - y)[Math.floor(a.length * p)].toFixed(0);
for (const [k, a] of Object.entries(lat)) console.log(`${k.padEnd(10)} n=${a.length} p50=${pct(a, .5)}ms p95=${pct(a, .95)}ms`);
console.log(`1200 requests in ${(total / 1000).toFixed(1)}s; errors=${errors}; 409 insufficient-stock (expected when returning with an empty bag)=${conflicts}`);
