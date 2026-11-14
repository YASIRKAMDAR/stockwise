export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}
export class NetworkError extends Error {}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

async function handle(res: Response) {
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const e = body?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? `Request failed (${res.status})`, e.details);
  }
  return body;
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { key?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'stockwise' };
  if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  if (opts.key) headers['idempotency-key'] = opts.key;
  let res: Response;
  try {
    res = await fetch('/api/v1' + path, { method, headers, credentials: 'same-origin', body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new NetworkError('No connection');
  }
  return handle(res);
}
export const get = <T = any>(p: string) => api<T>('GET', p);
/** Mutation with an idempotency key. Retrying must reuse the same key. */
export const mutate = <T = any>(p: string, body: unknown, key = newKey()) => api<T>('POST', p, body, { key });

// ---- Unsent drafts (offline): kept per user, labelled "Not submitted", replayed with the ORIGINAL key ----
export interface Draft { key: string; path: string; body: any; label: string; createdAt: string }
const draftKey = (userId: string) => `sw_drafts_${userId}`;
export const loadDrafts = (userId: string): Draft[] => { try { return JSON.parse(localStorage.getItem(draftKey(userId)) ?? '[]'); } catch { return []; } };
export const saveDrafts = (userId: string, d: Draft[]) => { try { localStorage.setItem(draftKey(userId), JSON.stringify(d)); } catch { /* storage unavailable */ } };

// ---- Device credential for shared phones (not personal data; survives logout) ----
export interface DeviceCred { deviceId: string; deviceSecret: string; hotelId: string; label: string }
export const getDevice = (): DeviceCred | null => { try { return JSON.parse(localStorage.getItem('sw_device') ?? 'null'); } catch { return null; } };
export const setDevice = (d: DeviceCred | null) => { try { d ? localStorage.setItem('sw_device', JSON.stringify(d)) : localStorage.removeItem('sw_device'); } catch { /* ignore */ } };

/** Clears everything personal on a shared device. */
export function clearLocalUserData() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sw_') && k !== 'sw_device' && k !== 'sw_lang') localStorage.removeItem(k);
    sessionStorage.clear();
  } catch { /* ignore */ }
}

export function errorText(e: unknown): string {
  if (e instanceof NetworkError) return 'No connection. Nothing was saved.';
  if (e instanceof ApiError) {
    if (e.code === 'INSUFFICIENT_STOCK' && e.details?.shortages?.length) {
      const s = e.details.shortages[0];
      return `Not enough stock. Available now: ${s.available}.`;
    }
    return e.message;
  }
  return 'Something went wrong. Nothing was saved.';
}
