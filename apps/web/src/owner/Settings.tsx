import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText, get, getDevice, mutate, setDevice } from '../api';
import { ErrorBanner, fmtTime, Loading, Stepper, useMe } from '../ui/common';

function useAction() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); qc.invalidateQueries(); return true; } catch (e) { setMsg({ ok: false, text: errorText(e) }); return false; }
  };
  const Msg = () => (msg ? <div className={`banner ${msg.ok ? 'ok' : 'bad'} small`} role="status">{msg.text}</div> : null);
  return { run, Msg };
}
const Section = ({ title, children }: { title: string; children: ReactNode }) => <section className="card stack"><h2>{title}</h2>{children}</section>;

export function Settings() {
  const { me } = useMe();
  const isOwner = me.role === 'OWNER';
  const hotels = me.hotels.filter((h) => isOwner || h.roles.includes('MANAGER'));
  const [hotelId, setHotelId] = useState(hotels[0]?.id);
  return (
    <>
      <div className="row spread"><h1>Settings</h1>
        {hotels.length > 1 && <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>Hotel<select value={hotelId} onChange={(e) => setHotelId(e.target.value)} style={{ width: 'auto' }}>{hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>}
      </div>
      <ThisDevice hotelId={hotelId} />
      <Devices hotelId={hotelId} />
      <Users hotelId={hotelId} />
      <StockAdmin hotelId={hotelId} />
      <Rooms hotelId={hotelId} />
      <Thresholds hotelId={hotelId} />
      {isOwner && <ImportItems />}
      {isOwner && <Products />}
      {isOwner && <Hotels />}
    </>
  );
}

function ThisDevice({ hotelId }: { hotelId: string }) {
  const { me } = useMe();
  const { run, Msg } = useAction();
  const [label, setLabel] = useState('Housekeeping phone');
  const current = getDevice();
  const [, force] = useState(0);
  return (
    <Section title="This device (shared staff phone)">
      {current ? <div className="small">Enrolled as <b>{current.label}</b> for {me.hotels.find((h) => h.id === current.hotelId)?.name ?? 'another hotel'}. Staff can sign in here with their PIN after you sign out.</div>
        : <div className="small muted">Not enrolled. Enroll it so staff can sign in with employee code + PIN. Credentials stay on this phone only.</div>}
      <div className="row"><input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Device label" style={{ maxWidth: 260 }} />
        <button className="btn primary" onClick={() => run(async () => { const d = await api('POST', '/devices', { hotelId, label }); setDevice(d); force((x) => x + 1); }, 'Device enrolled. Sign out to let staff sign in.')}>Enroll this device for staff</button>
        {current && <button className="link" onClick={() => { setDevice(null); force((x) => x + 1); }}>Forget enrollment on this phone</button>}</div>
      <Msg />
    </Section>
  );
}

function Devices({ hotelId }: { hotelId: string }) {
  const q = useQuery<any[]>({ queryKey: ['devices', hotelId], queryFn: () => get(`/devices?hotelId=${hotelId}`) });
  const { run, Msg } = useAction();
  return (
    <Section title="Enrolled devices">
      <p className="small muted">Revoke a lost or replaced phone — this signs out everyone on it immediately.</p>
      {q.isLoading ? <Loading /> : <table><thead><tr><th>Label</th><th>Enrolled</th><th>Last used</th><th></th></tr></thead><tbody>
        {(q.data ?? []).map((d) => <tr key={d.id}><td>{d.label}</td><td className="small">{fmtTime(d.enrolled_at)}</td><td className="small">{fmtTime(d.last_seen_at)}</td>
          <td>{d.revoked_at ? <span className="badge neutral">Revoked</span> : <button className="btn danger" onClick={() => confirm(`Revoke ${d.label}?`) && run(() => mutate(`/devices/${d.id}/revoke`, {}), 'Device revoked')}>Revoke</button>}</td></tr>)}
      </tbody></table>}
      <Msg />
    </Section>
  );
}

function Users({ hotelId }: { hotelId: string }) {
  const { me } = useMe();
  const q = useQuery<any[]>({ queryKey: ['users', hotelId], queryFn: () => get(`/users?hotelId=${hotelId}`) });
  const { run, Msg } = useAction();
  const [f, setF] = useState({ employeeCode: '', displayName: '', role: 'STAFF', secret: '', preferredLanguage: 'gu' });
  const create = () => run(() => api('POST', '/users', { employeeCode: f.employeeCode.toUpperCase(), displayName: f.displayName, role: f.role, hotelIds: [hotelId], preferredLanguage: f.preferredLanguage,
    ...(f.role === 'STAFF' ? { pin: f.secret } : { password: f.secret }) }), 'User created').then((ok) => ok && setF({ ...f, employeeCode: '', displayName: '', secret: '' }));
  return (
    <Section title="Staff & managers">
      <table><thead><tr><th>Code</th><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
        {(q.data ?? []).map((u) => { const role = u.memberships.find((m: any) => m.hotelId === hotelId)?.role; return (
          <tr key={u.id}><td className="mono">{u.employeeCode}</td><td>{u.displayName}</td><td>{role}</td>
            <td>{!u.active ? <span className="badge neutral">Inactive</span> : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <span className="badge bad">! Locked</span> : <span className="badge ok">Active</span>}</td>
            <td className="row">
              {u.lockedUntil && <button className="link" onClick={() => run(() => api('PATCH', `/users/${u.id}`, { unlock: true }), 'Unlocked')}>Unlock</button>}
              {role === 'STAFF' && <button className="link" onClick={() => { const pin = prompt('New 4–8 digit PIN'); if (pin) run(() => api('PATCH', `/users/${u.id}`, { pin }), 'PIN reset; existing sessions signed out'); }}>Reset PIN</button>}
              {(role === 'STAFF' || me.role === 'OWNER') && <button className="link" onClick={() => run(() => api('PATCH', `/users/${u.id}`, { active: !u.active }), u.active ? 'Deactivated' : 'Reactivated')}>{u.active ? 'Deactivate' : 'Reactivate'}</button>}
            </td></tr>); })}
      </tbody></table>
      <div className="grid" style={{ alignItems: 'end' }}>
        <label className="field">Employee code<input value={f.employeeCode} onChange={(e) => setF({ ...f, employeeCode: e.target.value })} /></label>
        <label className="field">Display name<input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} placeholder="e.g. Staff 014" /></label>
        <label className="field">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="STAFF">Staff</option>{me.role === 'OWNER' && <option value="MANAGER">Manager</option>}</select></label>
        <label className="field">{f.role === 'STAFF' ? 'PIN (4–8 digits)' : 'Password (10+ chars)'}<input type="password" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} /></label>
        <label className="field">Language<select value={f.preferredLanguage} onChange={(e) => setF({ ...f, preferredLanguage: e.target.value })}><option value="gu">ગુજરાતી</option><option value="hi">हिन्दी</option><option value="en">English</option></select></label>
        <button className="btn primary" onClick={create}>Add user</button>
      </div>
      <p className="small muted">Store only what's needed: an employee code and a display name are enough.</p>
      <Msg />
    </Section>
  );
}

function StockAdmin({ hotelId }: { hotelId: string }) {
  const { me } = useMe();
  const products = useQuery<any[]>({ queryKey: ['products'], queryFn: () => get('/products') });
  const { run, Msg } = useAction();
  const [action, setAction] = useState(me.role === 'OWNER' ? 'OPENING_BALANCE' : 'STOCK_ADJUSTMENT');
  const [productId, setProductId] = useState(''), [qty, setQty] = useState(1), [direction, setDirection] = useState<'IN' | 'OUT'>('OUT'), [reason, setReason] = useState('');
  const go = () => run(() => mutate('/transactions', { action, hotelId, reason: reason || undefined, note: action === 'OPENING_BALANCE' ? 'Opening balance' : undefined,
    lines: [{ productId, quantity: qty, ...(action === 'STOCK_ADJUSTMENT' ? { direction } : {}) }] }), 'Posted to ledger');
  return (
    <Section title="Opening balances & adjustments">
      <p className="small muted">Every change is a new signed ledger entry. Use the weekly count for routine reconciliation.</p>
      <div className="grid" style={{ alignItems: 'end' }}>
        <label className="field">Type<select value={action} onChange={(e) => setAction(e.target.value)}>
          {me.role === 'OWNER' && <option value="OPENING_BALANCE">Set opening balance (+)</option>}<option value="STOCK_ADJUSTMENT">Adjustment (+/−)</option><option value="WASTE">Waste / damaged (−)</option></select></label>
        <label className="field">Product<select value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">—</option>{(products.data ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="field">Quantity<Stepper label="Quantity" value={qty} min={1} onChange={setQty} /></div>
        {action === 'STOCK_ADJUSTMENT' && <label className="field">Direction<select value={direction} onChange={(e) => setDirection(e.target.value as any)}><option value="OUT">Remove (−)</option><option value="IN">Add (+)</option></select></label>}
        {action !== 'OPENING_BALANCE' && <label className="field">Reason (required)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
        <button className="btn primary" disabled={!productId || (action !== 'OPENING_BALANCE' && !reason.trim())} onClick={go}>Post</button>
      </div>
      <Msg />
    </Section>
  );
}

function Rooms({ hotelId }: { hotelId: string }) {
  const q = useQuery<any[]>({ queryKey: ['rooms', hotelId], queryFn: () => get(`/hotels/${hotelId}/rooms`) });
  const { run, Msg } = useAction();
  const [text, setText] = useState('');
  const parseRooms = (s: string) => s.split(/[\s,]+/).filter(Boolean).flatMap((tok) => {
    const m = tok.match(/^(\d+)-(\d+)$/);
    if (m && Number(m[2]) >= Number(m[1]) && Number(m[2]) - Number(m[1]) < 300) return Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => String(Number(m[1]) + i));
    return [tok];
  });
  return (
    <Section title={`Rooms (${(q.data ?? []).filter((r) => r.active).length} active)`}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{(q.data ?? []).map((r) => (
        <button key={r.id} className={`badge ${r.active ? 'ok' : 'neutral'}`} style={{ minHeight: 32, cursor: 'pointer' }} title={r.active ? 'Click to deactivate' : 'Click to reactivate'}
          onClick={() => run(() => api('PATCH', `/rooms/${r.id}`, { active: !r.active }), `Room ${r.roomNumber} ${r.active ? 'deactivated' : 'reactivated'}`)}>{r.roomNumber}{!r.active && ' (off)'}</button>))}</div>
      <div className="row"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add rooms: 101-120, 201, 202" aria-label="Rooms to add" style={{ maxWidth: 360 }} />
        <button className="btn" onClick={() => run(() => api('POST', '/rooms', { hotelId, roomNumbers: parseRooms(text) }), 'Rooms saved').then((ok) => ok && setText(''))}>Add</button></div>
      <Msg />
    </Section>
  );
}

function Thresholds({ hotelId }: { hotelId: string }) {
  const q = useQuery<any>({ queryKey: ['stock', hotelId], queryFn: () => get(`/hotels/${hotelId}/stock`) });
  const { run, Msg } = useAction();
  const [edit, setEdit] = useState<Record<string, number>>({});
  return (
    <Section title="Reorder thresholds">
      {q.isLoading ? <Loading /> : <table><thead><tr><th>Product</th><th className="num">In store</th><th className="num">Alert below</th><th></th></tr></thead><tbody>
        {q.data.items.map((i: any) => <tr key={i.productId}><td>{i.name}</td><td className="num">{i.store}</td>
          <td className="num"><input inputMode="numeric" aria-label={`Threshold ${i.name}`} style={{ width: 90, textAlign: 'right' }} value={edit[i.productId] ?? i.reorderThreshold} onChange={(e) => setEdit({ ...edit, [i.productId]: parseInt(e.target.value, 10) || 0 })} /></td>
          <td>{edit[i.productId] !== undefined && edit[i.productId] !== i.reorderThreshold && <button className="btn" onClick={() => run(() => api('PATCH', `/hotels/${hotelId}/thresholds/${i.productId}`, { reorderThreshold: edit[i.productId] }), 'Saved')}>Save</button>}</td></tr>)}
      </tbody></table>}
      <Msg />
    </Section>
  );
}

function Products() {
  const q = useQuery<any[]>({ queryKey: ['products'], queryFn: () => get('/products') });
  const { run, Msg } = useAction();
  const [f, setF] = useState({ sku: '', name: '', unit: 'pcs', aliases: '' });
  const parseAliases = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).map((a) => ({ locale: /[઀-૿]/.test(a) ? 'gu' : /[ऀ-ॿ]/.test(a) ? 'hi' : 'en', alias: a }));
  return (
    <Section title="Products & spoken aliases">
      <p className="small muted">Aliases are the words staff actually say (e.g. shampu, शैम्पू, શેમ્પૂ). Avoid giving two products the same alias unless you want staff to be asked which one.</p>
      <table><thead><tr><th>SKU</th><th>Name</th><th>Unit</th><th>Aliases</th><th></th></tr></thead><tbody>
        {(q.data ?? []).map((p) => <tr key={p.id}><td className="mono small">{p.sku}</td><td>{p.name}</td><td>{p.unit}</td><td className="small">{p.aliases.map((a: any) => a.alias).join(', ')}</td>
          <td className="row"><button className="link" onClick={() => { const s = prompt('Aliases (comma separated)', p.aliases.map((a: any) => a.alias).join(', ')); if (s !== null) run(() => api('PATCH', `/products/${p.id}`, { aliases: parseAliases(s) }), 'Aliases saved'); }}>Aliases</button>
            <button className="link" onClick={() => run(() => api('PATCH', `/products/${p.id}`, { active: !p.active }), p.active ? 'Deactivated' : 'Reactivated')}>{p.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>)}
      </tbody></table>
      <div className="grid" style={{ alignItems: 'end' }}>
        <label className="field">SKU<input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} placeholder="BODY_LOTION" /></label>
        <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Unit<input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></label>
        <label className="field">Aliases<input value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} placeholder="lotion, लोशन, લોશન" /></label>
        <button className="btn primary" onClick={() => run(() => api('POST', '/products', { sku: f.sku, name: f.name, unit: f.unit, aliases: parseAliases(f.aliases) }), 'Product added').then((ok) => ok && setF({ sku: '', name: '', unit: 'pcs', aliases: '' }))}>Add product</button>
      </div>
      <Msg />
    </Section>
  );
}

function Hotels() {
  const q = useQuery<any[]>({ queryKey: ['hotels'], queryFn: () => get('/hotels') });
  const { run, Msg } = useAction();
  const [f, setF] = useState({ code: '', name: '' });
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <Section title="Hotels & rules">
      <table><thead><tr><th>Code</th><th>Name</th><th>Direct store → room</th><th>Count week starts</th><th>Transfer age alert</th></tr></thead><tbody>
        {(q.data ?? []).map((h) => <tr key={h.id}><td className="mono">{h.code}</td><td>{h.name}<div className="small muted">{h.timezone}</div></td>
          <td><label className="row"><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={h.allowStoreToRoom} onChange={(e) => run(() => api('PATCH', `/hotels/${h.id}`, { allowStoreToRoom: e.target.checked }), 'Saved')} />{h.allowStoreToRoom ? 'Allowed' : 'Off'}</label></td>
          <td><select value={h.countWeekStart} onChange={(e) => run(() => api('PATCH', `/hotels/${h.id}`, { countWeekStart: Number(e.target.value) }), 'Saved')} style={{ width: 'auto' }}>{days.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></td>
          <td><select value={h.transferAgingHours} onChange={(e) => run(() => api('PATCH', `/hotels/${h.id}`, { transferAgingHours: Number(e.target.value) }), 'Saved')} style={{ width: 'auto' }}>{[12, 24, 48, 72].map((n) => <option key={n} value={n}>{n}h</option>)}</select></td></tr>)}
      </tbody></table>
      <div className="row"><input placeholder="Code (e.g. H4)" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} style={{ maxWidth: 140 }} /><input placeholder="Hotel name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ maxWidth: 260 }} />
        <button className="btn" onClick={() => run(() => api('POST', '/hotels', f), 'Hotel added — reload to see it everywhere')}>Add hotel</button></div>
      <Msg />
      <ErrorBanner error={q.error} />
    </Section>
  );
}

/** Owner uploads the item master (CSV export). Items are matched on their code, so uploading again only updates. */
function ImportItems() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setMsg(null); setError(null);
    try {
      const r = await api<{ created: number; updated: number; skipped: number; categories: number }>('POST', '/catalog/import', { csv: await f.text() });
      setMsg(`${r.created} items added, ${r.updated} updated, ${r.skipped} skipped, in ${r.categories} categories.`);
      qc.invalidateQueries();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <section className="panel">
      <h2>Import the item list</h2>
      <p className="muted small">Upload the item master as a CSV file (columns: Code, Name, Category, Base UOM, and optionally Alias/Nick Name, Purchase Price, Has Expiry, Shelf Life (days), Status). Inactive rows are skipped. Uploading again updates items and never deletes anything.</p>
      <label className="field">Item master file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} /></label>
      {busy && <Loading />}
      {msg && <p role="status">{msg}</p>}
      {error != null && <ErrorBanner error={error} />}
    </section>
  );
}
