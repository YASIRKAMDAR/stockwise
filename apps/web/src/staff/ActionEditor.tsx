import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, mutate, newKey, NetworkError, errorText, loadDrafts, saveDrafts } from '../api';
import { useMe, ProductIcon, Stepper, ACTION_LABEL } from '../ui/common';
import type { useT } from './StaffApp';

export type EditAction = 'SUPPLIER_RECEIPT' | 'CHECKOUT_TO_STAFF' | 'PLACE_IN_ROOM' | 'RETURN_TO_STORE' | 'TRANSFER_DISPATCH';
export interface EditLine { productId: string | null; quantity: number | null; roomId: string | null; source: 'STORE' | 'MY_STOCK' | null; issues?: string[]; candidates?: { productId: string; name: string }[]; spoken?: string }
export interface Draft0 { action: EditAction; lines: EditLine[]; targetHotelId?: string | null; proposalId?: string; transcript?: string; note?: string }

export interface Product { id: string; sku: string; name: string; unit: string; icon: string | null; active: boolean }
export interface Room { id: string; roomNumber: string; active: boolean }

const ISSUE_TEXT: Record<string, string> = {
  UNKNOWN_PRODUCT: 'Item not recognised — choose it', AMBIGUOUS_PRODUCT: 'Which item exactly?', MISSING_QUANTITY: 'How many?', CHECK_QUANTITY: 'Large quantity — please check',
  MISSING_ROOM: 'Which room?', UNKNOWN_ROOM: 'Room not found in this hotel', CHOOSE_SOURCE: 'Choose where these came from',
};

export function ActionEditor({ initial, hotelId, t, onDone, onCancel }: { initial: Draft0; hotelId: string; t: ReturnType<typeof useT>; onDone: () => void; onCancel: () => void }) {
  const { me } = useMe();
  const qc = useQueryClient();
  const hotel = me.hotels.find((h) => h.id === hotelId)!;
  const products = useQuery<Product[]>({ queryKey: ['products'], queryFn: () => get('/products') });
  const rooms = useQuery<Room[]>({ queryKey: ['rooms', hotelId], queryFn: () => get(`/hotels/${hotelId}/rooms`) });
  const stock = useQuery<any>({ queryKey: ['stock', hotelId], queryFn: () => get(`/hotels/${hotelId}/stock`) });
  const bag = useQuery<any>({ queryKey: ['mystock', hotelId], queryFn: () => get(`/me/stock?hotelId=${hotelId}`) });
  const dests = useQuery<{ id: string; name: string }[]>({ queryKey: ['destinations'], queryFn: () => get('/hotels/destinations') });

  const [action, setAction] = useState<EditAction>(initial.action);
  const [lines, setLines] = useState<EditLine[]>(initial.lines.length ? initial.lines : [{ productId: null, quantity: 1, roomId: null, source: null }]);
  const [target, setTarget] = useState<string | null>(initial.targetHotelId ?? null);
  const [note, setNote] = useState(initial.note ?? '');
  const [key] = useState(newKey); // one key per confirmation attempt; retries reuse it
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<{ ref: string } | null>(null);

  const active = (products.data ?? []).filter((p) => p.active);
  const storeQty = (pid: string | null) => stock.data?.items.find((i: any) => i.productId === pid)?.store ?? 0;
  const bagQty = (pid: string | null) => bag.data?.items.find((i: any) => i.productId === pid)?.quantity ?? 0;
  const sourceOf = (l: EditLine): 'STORE' | 'MY_STOCK' | null =>
    action === 'PLACE_IN_ROOM' ? l.source : action === 'RETURN_TO_STORE' ? 'MY_STOCK' : action === 'CHECKOUT_TO_STAFF' || action === 'TRANSFER_DISPATCH' ? 'STORE' : null;

  // Aggregate need per (source, product) to block confirm on shortage before the server does.
  const shortages = useMemo(() => {
    const need = new Map<string, number>();
    for (const l of lines) { const s = sourceOf(l); if (s && l.productId && l.quantity) need.set(`${s}|${l.productId}`, (need.get(`${s}|${l.productId}`) ?? 0) + l.quantity); }
    const out = new Map<string, number>();
    for (const [k, q] of need) { const [s, p] = k.split('|'); const avail = s === 'STORE' ? storeQty(p) : bagQty(p); if (q > avail) out.set(k, avail); }
    return out;
  }, [lines, action, stock.data, bag.data]);

  const problems: string[] = [];
  lines.forEach((l, i) => {
    if (!l.productId) problems.push(`Line ${i + 1}: choose item`);
    if (!l.quantity || l.quantity < 1) problems.push(`Line ${i + 1}: quantity`);
    if (action === 'PLACE_IN_ROOM' && !l.roomId) problems.push(`Line ${i + 1}: room`);
    if (action === 'PLACE_IN_ROOM' && !l.source) problems.push(`Line ${i + 1}: ${t.chooseSource}`);
  });
  if (action === 'TRANSFER_DISPATCH' && (!target || target === hotelId)) problems.push('Choose a different destination hotel');
  if (shortages.size) problems.push('Not enough stock');

  const set = (i: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch, issues: (l.issues ?? []).filter((x) => !relatedIssue(x, patch)) } : l)));

  const confirm = async () => {
    setBusy(true); setError(null);
    let path: string, body: any;
    if (action === 'TRANSFER_DISPATCH') {
      path = '/transfers';
      body = { fromHotelId: hotelId, toHotelId: target, lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })), note: note || undefined, proposalId: initial.proposalId };
    } else {
      path = '/transactions';
      body = { action, hotelId, proposalId: initial.proposalId, note: note || undefined,
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, ...(action === 'PLACE_IN_ROOM' ? { roomId: l.roomId, source: l.source } : {}) })) };
    }
    try {
      const r = await mutate(path, body, key);
      setDone({ ref: r.refCode ?? r.eventId.slice(0, 8).toUpperCase() });
      qc.invalidateQueries();
    } catch (e) {
      if (e instanceof NetworkError) {
        const drafts = loadDrafts(me.id).filter((d) => d.key !== key);
        drafts.push({ key, path, body, label: `${ACTION_LABEL[action] ?? action}: ${lines.map((l) => `${l.quantity} × ${active.find((p) => p.id === l.productId)?.name}`).join(', ')}`, createdAt: new Date().toISOString() });
        saveDrafts(me.id, drafts);
      }
      setError(e);
      if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: ['stock'] }), qc.invalidateQueries({ queryKey: ['mystock'] });
    } finally { setBusy(false); }
  };

  if (done) return (
    <div className="card stack" role="status">
      <div className="banner ok">✓ {t.saved}</div>
      <div>{ACTION_LABEL[action]}: {lines.map((l) => `${l.quantity} × ${active.find((p) => p.id === l.productId)?.name}`).join(', ')}</div>
      <div className="small muted">{t.reference}: <b className="mono">{done.ref}</b></div>
      <button className="btn primary lg block" onClick={onDone}>{t.recordAnother}</button>
    </div>
  );

  const actions: [EditAction, string][] = [['CHECKOUT_TO_STAFF', t.takeStock], ['PLACE_IN_ROOM', t.placedInRoom], ['RETURN_TO_STORE', t.returnToStore], ['SUPPLIER_RECEIPT', t.stockReceived], ['TRANSFER_DISPATCH', t.sendToHotel]];
  return (
    <div className="card stack">
      <div className="row spread"><h2>{(actions.find(([a]) => a === action)?.[1] ?? ACTION_LABEL[action]).toUpperCase()} · {hotel.name}</h2></div>
      {initial.transcript && <div className="small muted">“{initial.transcript}”</div>}
      <label className="field">Action
        <select value={action} onChange={(e) => setAction(e.target.value as EditAction)}>{actions.map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select>
      </label>
      {action === 'TRANSFER_DISPATCH' && (
        <label className="field">{t.destination}
          <select value={target ?? ''} onChange={(e) => setTarget(e.target.value || null)} style={!target ? { borderColor: 'var(--warning)' } : undefined}>
            <option value="">—</option>{(dests.data ?? []).filter((h) => h.id !== hotelId).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </label>
      )}
      {action !== 'PLACE_IN_ROOM' && <div className="small muted">From: {action === 'SUPPLIER_RECEIPT' ? 'Supplier' : action === 'RETURN_TO_STORE' ? t.fromMyStock : t.fromStore} → To: {action === 'CHECKOUT_TO_STAFF' ? t.fromMyStock : action === 'TRANSFER_DISPATCH' ? 'In transit' : t.fromStore}</div>}
      {lines.map((l, i) => {
        const p = active.find((x) => x.id === l.productId);
        const src = sourceOf(l);
        const short = src && l.productId ? shortages.get(`${src}|${l.productId}`) : undefined;
        const flagged = (l.issues ?? []).length > 0;
        return (
          <div key={i} className={`line-card${flagged ? ' check' : ''}`}>
            {flagged && <div className="small" style={{ color: 'var(--warning)', fontWeight: 700 }}>⚠ {t.pleaseCheck}: {(l.issues ?? []).map((x) => ISSUE_TEXT[x] ?? x).join(' · ')}</div>}
            {l.spoken && <div className="small muted">Heard: “{l.spoken}”</div>}
            <div className="row">
              <ProductIcon sku={p?.sku} icon={p?.icon} />
              <select aria-label={t.item} value={l.productId ?? ''} onChange={(e) => set(i, { productId: e.target.value || null, candidates: undefined })} style={{ flex: 1 }}>
                <option value="">— {t.item} —</option>
                {(l.candidates?.length ? active.filter((x) => l.candidates!.some((c) => c.productId === x.id)) : active).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
                {l.candidates?.length ? <option disabled>──────</option> : null}
                {l.candidates?.length ? active.filter((x) => !l.candidates!.some((c) => c.productId === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>) : null}
              </select>
            </div>
            <div className="row spread">
              <Stepper label={t.qty} value={l.quantity} min={1} onChange={(n) => set(i, { quantity: n })} />
              {action === 'PLACE_IN_ROOM' && (
                <select aria-label={t.room} value={l.roomId ?? ''} onChange={(e) => set(i, { roomId: e.target.value || null })} style={{ width: 130 }}>
                  <option value="">{t.room}…</option>{(rooms.data ?? []).filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{t.room} {r.roomNumber}</option>)}
                </select>
              )}
            </div>
            {action === 'PLACE_IN_ROOM' && (
              <div className="seg" role="group" aria-label={t.source}>
                <button type="button" aria-pressed={l.source === 'MY_STOCK'} onClick={() => set(i, { source: 'MY_STOCK' })}>{t.fromMyStock} ({bagQty(l.productId)})</button>
                {hotel.allowStoreToRoom && <button type="button" aria-pressed={l.source === 'STORE'} onClick={() => set(i, { source: 'STORE' })}>{t.fromStore} ({storeQty(l.productId)})</button>}
              </div>
            )}
            {src && l.productId && action !== 'PLACE_IN_ROOM' && <div className="small muted">{t.available}: {src === 'STORE' ? storeQty(l.productId) : bagQty(l.productId)} {p?.unit}</div>}
            {short !== undefined && <div className="banner bad small">Not enough stock. {t.available}: {short}</div>}
            {lines.length > 1 && <button className="link" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        );
      })}
      <button className="btn" onClick={() => setLines((ls) => [...ls, { productId: null, quantity: 1, roomId: ls[ls.length - 1]?.roomId ?? null, source: ls[ls.length - 1]?.source ?? null }])}>+ {t.addItem}</button>
      {action === 'SUPPLIER_RECEIPT' || action === 'TRANSFER_DISPATCH' ? <label className="field">Note (optional)<input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Supplier / delivery note" /></label> : null}
      {error ? <div className="banner bad" role="alert">{error instanceof NetworkError ? `${t.notSubmitted}. Saved as draft — retry when online.` : errorText(error)}</div> : null}
      {problems.length > 0 && <div className="small muted">{problems.join(' · ')}</div>}
      <div className="row">
        <button className="btn lg" onClick={onCancel} style={{ flex: 1 }}>{t.cancel}</button>
        <button className="btn primary lg" style={{ flex: 2 }} disabled={busy || problems.length > 0} onClick={confirm}>{busy ? '…' : t.confirm}</button>
      </div>
    </div>
  );
}

function relatedIssue(issue: string, patch: Partial<EditLine>) {
  if ('productId' in patch) return issue === 'UNKNOWN_PRODUCT' || issue === 'AMBIGUOUS_PRODUCT';
  if ('quantity' in patch) return issue === 'MISSING_QUANTITY' || issue === 'CHECK_QUANTITY';
  if ('roomId' in patch) return issue === 'MISSING_ROOM' || issue === 'UNKNOWN_ROOM';
  if ('source' in patch) return issue === 'CHOOSE_SOURCE';
  return false;
}
