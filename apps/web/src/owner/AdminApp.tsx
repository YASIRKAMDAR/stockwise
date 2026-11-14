import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, mutate } from '../api';
import { ACTION_LABEL, BarList, downloadUrl, ErrorBanner, fmtTime, Freshness, Loading, Modal, StatusBadge, useMe } from '../ui/common';
import { CountHistory, WeeklyCount } from '../manager/Count';
import { Settings } from './Settings';

type Page = 'overview' | 'count' | 'stock' | 'usage' | 'transfers' | 'alerts' | 'history' | 'activity' | 'reports' | 'settings';

export function AdminApp() {
  const { me, logout } = useMe();
  const isOwner = me.role === 'OWNER';
  const pages: [Page, string][] = isOwner
    ? [['overview', 'Overview'], ['stock', 'Hotels & stock'], ['usage', 'Usage'], ['transfers', 'Transfers'], ['alerts', 'Alerts'], ['history', 'Verification'], ['activity', 'Activity'], ['reports', 'Reports'], ['settings', 'Settings']]
    : [['count', 'Weekly count'], ['alerts', 'Exceptions'], ['history', 'History'], ['stock', 'Stock'], ['transfers', 'Transfers'], ['activity', 'Activity'], ['overview', 'Overview'], ['settings', 'Settings']];
  const [page, setPage] = useState<Page>(pages[0][0]);
  const managed = me.hotels.filter((h) => isOwner || h.roles.includes('MANAGER'));
  const [hotel, setHotel] = useState<string>(isOwner ? 'all' : managed[0]?.id);
  const pickerOptions = isOwner ? [{ id: 'all', name: `All ${managed.length} hotels` }, ...managed] : managed;

  return (
    <div className="shell">
      <nav className="sidenav" aria-label="Main">
        <div className="brand row" style={{ padding: '4px 10px 14px' }}><img src="/icon.svg" alt="" width="28" /><b>Stockwise</b></div>
        {pages.map(([k, l]) => <button key={k} aria-current={page === k ? 'page' : undefined} onClick={() => setPage(k)}>{l}</button>)}
        <div style={{ flex: 1 }} />
        <div className="small muted brand" style={{ padding: '0 10px' }}>{me.displayName}<br />{isOwner ? 'Owner' : 'Manager'}</div>
        <button onClick={logout}>Sign out</button>
      </nav>
      <main className="main">
        {pickerOptions.length > 1 && page !== 'settings' && (
          <div className="row">
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>Hotel
              <select value={hotel} onChange={(e) => setHotel(e.target.value)} style={{ width: 'auto' }}>{pickerOptions.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
            </label>
          </div>
        )}
        {page === 'overview' && <Overview hotel={hotel} />}
        {page === 'count' && <WeeklyCount hotelId={hotel === 'all' ? managed[0].id : hotel} />}
        {page === 'stock' && <Availability hotel={hotel} />}
        {page === 'usage' && <Usage hotel={hotel} />}
        {page === 'transfers' && <TransfersPage hotel={hotel} />}
        {page === 'alerts' && <Alerts hotel={hotel} />}
        {page === 'history' && <CountHistory hotel={hotel} />}
        {page === 'activity' && <ActivityAdmin hotel={hotel} />}
        {page === 'reports' && <Reports hotel={hotel} />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}

const usePoll = () => useMe().me.config.ownerPollSeconds * 1000;

function Overview({ hotel }: { hotel: string }) {
  const [period, setPeriod] = useState(30);
  const poll = usePoll();
  const q = useQuery<any>({ queryKey: ['overview', hotel, period], queryFn: () => get(`/dashboard/overview?hotelId=${hotel}&periodDays=${period}`), refetchInterval: poll, refetchIntervalInBackground: false });
  const d = q.data;
  return (
    <>
      <div className="row spread"><h1>Overview</h1>
        <div className="row">
          <div className="seg" role="group" aria-label="Period">{[7, 30, 90].map((p) => <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)} style={{ padding: '0 14px' }}>{p} days</button>)}</div>
          <Freshness asOf={d?.asOf} isError={q.isError} />
        </div>
      </div>
      {q.isLoading ? <Loading /> : !d ? <ErrorBanner error={q.error} /> : (
        <>
          <h2 className="small muted" style={{ textTransform: 'uppercase' }}>Stock on hand now (units)</h2>
          <div className="grid">
            <Kpi v={d.storeAvailableUnits} l="Available in stores" />
            <Kpi v={d.staffHeldUnits} l="With staff" />
            <Kpi v={d.inTransitUnits} l="In transit" />
          </div>
          <h2 className="small muted" style={{ textTransform: 'uppercase' }}>Activity &amp; exceptions</h2>
          <div className="grid">
            <Kpi v={d.placedInRoomsUnits} l={`Amenities placed in rooms (last ${period} days)`} />
            <Kpi v={d.lowStockCount} l="Low-stock products" tone={d.lowStockCount ? 'warn' : undefined} />
            <Kpi v={d.overdueCountHotels} l="Overdue weekly counts" tone={d.overdueCountHotels ? 'bad' : undefined} />
          </div>
          <div className="card table-wrap">
            <table>
              <caption className="sr-only">Per-hotel summary</caption>
              <thead><tr><th>Hotel</th><th className="num">In store</th><th className="num">With staff</th><th className="num">Sent, in transit</th><th className="num">Placed in rooms ({period}d)</th><th className="num">Low stock</th><th>Weekly count</th></tr></thead>
              <tbody>{d.hotels.map((h: any) => (
                <tr key={h.hotelId}><td><b>{h.name}</b></td><td className="num">{h.storeAvailableUnits}</td><td className="num">{h.staffHeldUnits}</td><td className="num">{h.inTransitOutUnits}</td>
                  <td className="num">{h.placedInRoomsUnits}</td><td className="num">{h.lowStockCount}</td><td><StatusBadge s={h.countState} /> <span className="small muted">{h.lastCountAt ? fmtTime(h.lastCountAt) : 'never'}</span></td></tr>))}</tbody>
            </table>
          </div>
          <p className="small muted">Stock balances and room placements are different measures and are never added together. “Placed in rooms” counts amenities issued to rooms, not guest consumption.</p>
        </>
      )}
    </>
  );
}
const Kpi = ({ v, l, tone }: { v: number; l: string; tone?: 'warn' | 'bad' }) => (
  <div className="card kpi" style={tone ? { borderColor: `var(--${tone === 'bad' ? 'danger' : 'warning'})` } : undefined}>
    <span className="v">{v.toLocaleString()}</span><span className="l">{tone && <span aria-hidden="true">{tone === 'bad' ? '! ' : '▲ '}</span>}{l}</span>
  </div>
);

function Availability({ hotel }: { hotel: string }) {
  const poll = usePoll();
  const q = useQuery<any>({ queryKey: ['availability', hotel], queryFn: () => get(`/dashboard/availability?hotelId=${hotel}`), refetchInterval: poll });
  const [drawer, setDrawer] = useState<string | null>(null);
  const items: any[] = q.data?.items ?? [];
  const hotels = [...new Map(items.map((i) => [i.hotelId, i.hotelName])).entries()];
  const products = [...new Map(items.map((i) => [i.productId, i])).values()];
  const cell = (h: string, p: string) => items.find((i) => i.hotelId === h && i.productId === p);
  return (
    <>
      <div className="row spread"><h1>Store availability</h1><div className="row"><Freshness asOf={q.data?.asOf} isError={q.isError} />
        <button className="btn" onClick={() => downloadUrl(`/reports/stock-events.csv?hotelId=${hotel}`)}>Export activity CSV</button></div></div>
      <div className="small muted">Store quantity per hotel. <span className="badge warn">▲ Low</span> below reorder level · <span className="badge bad">! Out</span> none in store. Click a product for detail.</div>
      {q.isLoading ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Product</th>{hotels.map(([id, n]) => <th key={id} className="num">{n}</th>)}</tr></thead>
            <tbody>{products.map((p) => (
              <tr key={p.productId}>
                <td><button className="link" onClick={() => setDrawer(p.productId)}>{p.name}</button> <span className="small muted">{p.unit}</span></td>
                {hotels.map(([h]) => { const c = cell(h, p.productId); return (
                  <td key={h} className={`num ${c.out && c.reorderThreshold ? 'cell-out' : c.low ? 'cell-low' : ''}`} title={`Store ${c.store} · reorder at ${c.reorderThreshold}`}>
                    {c.store}{c.out && c.reorderThreshold ? ' !' : c.low ? ' ▲' : ''}<div className="small muted">min {c.reorderThreshold}</div></td>); })}
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {drawer && <ProductDrawer productId={drawer} items={items.filter((i) => i.productId === drawer)} onClose={() => setDrawer(null)} />}
    </>
  );
}

function ProductDrawer({ productId, items, onClose }: { productId: string; items: any[]; onClose: () => void }) {
  const ids = items.map((i) => i.hotelId);
  const hist = useQuery<any>({ queryKey: ['activity-p', productId, ids.join()], queryFn: () => get(`/transactions?productId=${productId}&limit=20${ids.length === 1 ? `&hotelId=${ids[0]}` : ''}`) });
  return (
    <aside className="drawer stack" aria-label="Product detail">
      <div className="row spread"><h2>{items[0]?.name}</h2><button className="link" onClick={onClose}>Close</button></div>
      <table><thead><tr><th>Hotel</th><th className="num">Store</th><th className="num">Staff</th><th className="num">Out</th><th className="num">In</th><th className="num">Min</th></tr></thead>
        <tbody>{items.map((i) => <tr key={i.hotelId}><td>{i.hotelName}</td><td className="num">{i.store}</td><td className="num">{i.staffHeld}</td><td className="num">{i.inTransitOut}</td><td className="num">{i.inTransitIn}</td><td className="num">{i.reorderThreshold}</td></tr>)}</tbody></table>
      <p className="small muted">Out/In = units in transit from / to this hotel.</p>
      <h3>Recent movements</h3>
      {hist.isLoading ? <Loading /> : (hist.data?.items ?? []).map((e: any) => (
        <div key={e.eventId} className="small" style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
          <b>{ACTION_LABEL[e.action]}</b> · {e.hotelName} · {fmtTime(e.createdAt)} · {e.actor.name}<br />
          {e.lines.filter((l: any) => l.productId === productId).map((l: any) => `${l.quantity}${l.roomNumber ? ` → room ${l.roomNumber}` : ''}`).join(', ')}
        </div>))}
    </aside>
  );
}

function Usage({ hotel }: { hotel: string }) {
  const [period, setPeriod] = useState(30);
  const [product, setProduct] = useState('');
  const products = useQuery<any[]>({ queryKey: ['products'], queryFn: () => get('/products') });
  const q = useQuery<any>({ queryKey: ['placements', hotel, period, product], queryFn: () => get(`/dashboard/room-placements?hotelId=${hotel}&periodDays=${period}${product ? `&productId=${product}` : ''}`) });
  const d = q.data;
  // Fill every day of the window (zeros included) so the time axis spans the whole period.
  const days: string[] = [];
  if (d) for (let t = new Date(d.from).getTime(); t <= new Date(d.to).getTime(); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const perDay = days.map((day) => ({ day, units: d.series.filter((s: any) => s.day === day).reduce((a: number, s: any) => a + s.units, 0) }));
  const maxDay = Math.max(1, ...perDay.map((x) => x.units));
  const [showTable, setShowTable] = useState(false);
  return (
    <>
      <div className="row spread"><h1>Amenities placed in rooms</h1>
        <div className="row">
          <select value={product} onChange={(e) => setProduct(e.target.value)} style={{ width: 'auto' }} aria-label="Product"><option value="">All products</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <div className="seg" role="group" aria-label="Period">{[7, 30, 90].map((p) => <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)} style={{ padding: '0 14px' }}>{p}d</button>)}</div>
        </div></div>
      <p className="small muted">Units issued to rooms by staff. This is not guest consumption — high numbers can reflect room turnover or special requests. Occupancy data is not connected, so per-room-night rates are not shown.</p>
      {q.isLoading ? <Loading /> : !d?.totalUnits ? <div className="card muted">No room placements in this period.</div> : (
        <>
          <div className="grid"><Kpi v={d.totalUnits} l="Units placed" /><Kpi v={d.placementEvents} l="Placement records" /></div>
          <div className="card stack">
            <div className="row spread"><h2>Units placed per day</h2><button className="link" onClick={() => setShowTable(!showTable)}>{showTable ? 'Show chart' : 'Show table'}</button></div>
            {showTable ? <table><thead><tr><th>Day</th><th className="num">Units</th></tr></thead><tbody>{perDay.map((x) => <tr key={x.day}><td>{x.day}</td><td className="num">{x.units}</td></tr>)}</tbody></table> : (
              <>
                <div className="cols" role="img" aria-label={`Daily units placed, ${perDay.length} days, peak ${maxDay}`}>
                  {perDay.map((x) => <div key={x.day} style={{ height: `${(x.units / maxDay) * 100}%` }} title={`${x.day}: ${x.units} units`} />)}
                </div>
                <div className="row spread small muted"><span>{days[0]}</span><span>peak {maxDay}</span><span>{days[days.length - 1]}</span></div>
              </>
            )}
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <div className="card stack"><h2>By product</h2><BarList rows={d.products.map((p: any) => ({ label: p.name, value: p.units, sub: p.unit }))} unit="units" /></div>
            <div className="card stack"><h2>Top rooms</h2><BarList rows={d.rooms.slice(0, 15).map((r: any) => ({ label: hotel === 'all' ? `${r.hotelName} · ${r.roomNumber}` : `Room ${r.roomNumber}`, value: r.units }))} unit="units" /></div>
          </div>
        </>
      )}
    </>
  );
}

function TransfersPage({ hotel }: { hotel: string }) {
  const { me } = useMe();
  const [status, setStatus] = useState('OPEN');
  const q = useQuery<any>({ queryKey: ['dash-transfers', hotel, status], queryFn: () => get(`/dashboard/transfers?hotelId=${hotel}${status ? `&status=${status}` : ''}`), refetchInterval: usePoll() });
  const [resolve, setResolve] = useState<any>(null);
  return (
    <>
      <div className="row spread"><h1>Transfers</h1>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="Status">
          <option value="OPEN">Open (not fully received)</option><option value="DISCREPANCY">Discrepancy</option><option value="RECEIVED">Received</option><option value="RESOLVED">Resolved</option><option value="">All</option>
        </select></div>
      {q.isLoading ? <Loading /> : !q.data.items.length ? <div className="card muted">No transfers.</div> : (
        <div className="card table-wrap"><table>
          <thead><tr><th>Ref</th><th>Route</th><th>Items (received / sent)</th><th>Status</th><th className="num">Age</th><th></th></tr></thead>
          <tbody>{q.data.items.map((t: any) => (
            <tr key={t.id}><td className="mono">{t.refCode}</td><td>{t.fromHotel.name} → {t.toHotel.name}<div className="small muted">by {t.dispatchedBy.name}</div></td>
              <td className="small">{t.lines.map((l: any) => `${l.name}: ${l.received}/${l.sent}${l.resolvedShort ? ` (${l.resolvedShort} written off)` : ''}`).join(' · ')}</td>
              <td><StatusBadge s={t.status} />{t.aged && <div><span className="badge warn">▲ Over age limit</span></div>}</td>
              <td className="num">{t.ageHours < 48 ? `${Math.round(t.ageHours)}h` : `${Math.round(t.ageHours / 24)}d`}</td>
              <td>{t.outstandingUnits > 0 && (me.role === 'OWNER' || me.hotels.some((h) => (h.id === t.toHotel.id || h.id === t.fromHotel.id) && h.roles.includes('MANAGER'))) &&
                <button className="btn" onClick={() => setResolve(t)}>Resolve {t.outstandingUnits}</button>}</td></tr>))}</tbody>
        </table></div>
      )}
      {resolve && <ResolveModal t={resolve} onClose={() => setResolve(null)} />}
    </>
  );
}

function ResolveModal({ t, onClose }: { t: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('LOST'), [note, setNote] = useState(''), [key] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await mutate(`/transfers/${t.id}/resolve`, { reason, note: note || undefined }, key); qc.invalidateQueries(); onClose(); } catch (e) { setError(e); } finally { setBusy(false); } };
  return (
    <Modal title={`Resolve ${t.refCode}`} onClose={onClose}>
      <p>{t.outstandingUnits} unit(s) were sent but not received. Resolving writes them off from “in transit” with an auditable reconciliation event. Sent quantities are never edited.</p>
      <label className="field">Reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="LOST">Lost</option><option value="DAMAGED">Damaged</option><option value="COUNTING_ERROR">Counting error when sent</option><option value="OTHER">Other</option></select></label>
      <label className="field">Note<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <ErrorBanner error={error} />
      <button className="btn primary" disabled={busy} onClick={go}>Resolve shortfall</button>
    </Modal>
  );
}

function Alerts({ hotel }: { hotel: string }) {
  const q = useQuery<any>({ queryKey: ['alerts', hotel], queryFn: () => get(`/dashboard/alerts?hotelId=${hotel}`), refetchInterval: usePoll() });
  const corr = useQuery<any[]>({ queryKey: ['corrections', hotel], queryFn: () => get(`/correction-requests?hotelId=${hotel}`) });
  const qc = useQueryClient();
  return (
    <>
      <div className="row spread"><h1>Alerts &amp; exceptions</h1><Freshness asOf={q.data?.asOf} isError={q.isError} /></div>
      {q.isLoading ? <Loading /> : !q.data.items.length ? <div className="card muted">No open alerts.</div> : (
        <div className="stack">{q.data.items.map((a: any) => (
          <div key={a.id} className="card row spread"><div><b>{a.title}</b><div className="small muted">{a.detail}{a.createdAt ? ` · ${fmtTime(a.createdAt)}` : ''}</div></div><div className="row"><span className="badge neutral">{a.category.replace(/_/g, ' ').toLowerCase()}</span><StatusBadge s={a.severity} /></div></div>))}</div>
      )}
      <h2>Staff correction requests</h2>
      {(corr.data ?? []).filter((c) => c.status === 'OPEN').length === 0 ? <div className="card muted">None open.</div> :
        (corr.data ?? []).filter((c) => c.status === 'OPEN').map((c) => (
          <div key={c.id} className="card stack"><div><b>{c.requestedBy}</b> · {c.hotelName} · {fmtTime(c.createdAt)}</div><div>“{c.note}”</div>
            <div className="small muted">Transaction <span className="mono">{c.eventId.slice(0, 8).toUpperCase()}</span>. Fix it from Activity → Reverse, or dismiss.</div>
            <button className="link" style={{ alignSelf: 'flex-start' }} onClick={async () => { await mutate(`/correction-requests/${c.id}/dismiss`, {}); qc.invalidateQueries(); }}>Dismiss</button></div>))}
    </>
  );
}

function ActivityAdmin({ hotel }: { hotel: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const q = useQuery<any>({ queryKey: ['activity-admin', hotel, cursor, action], queryFn: () => get(`/transactions?hotelId=${hotel}&limit=50${action ? `&action=${action}` : ''}${cursor ? `&cursor=${cursor}` : ''}`) });
  const [rev, setRev] = useState<any>(null);
  return (
    <>
      <div className="row spread"><h1>Activity</h1>
        <select value={action} onChange={(e) => { setAction(e.target.value); setCursor(null); }} style={{ width: 'auto' }} aria-label="Action"><option value="">All actions</option>{Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      {q.isLoading ? <Loading /> : (
        <div className="card table-wrap"><table>
          <thead><tr><th>When</th><th>Action</th><th>Items</th><th>Who</th><th>Hotel</th><th></th></tr></thead>
          <tbody>{q.data.items.map((e: any) => (
            <tr key={e.eventId}><td className="small">{fmtTime(e.createdAt)}<div className="mono muted">{e.eventId.slice(0, 8).toUpperCase()}</div></td>
              <td>{ACTION_LABEL[e.action]}{e.viaVoice && <span title="Recorded by voice"> 🎙</span>}{e.reason && <div className="small muted">{e.reason}</div>}</td>
              <td className="small">{e.lines.map((l: any) => `${l.quantity} ${l.name}${l.roomNumber ? ` → ${l.roomNumber}` : ''}`).join(' · ')}</td>
              <td className="small">{e.actor.name}</td><td className="small">{e.hotelName}</td>
              <td>{e.reversedBy ? <span className="badge neutral">Reversed</span> : e.reversalOf ? <span className="badge neutral">Correction</span> :
                !['TRANSFER_DISPATCH', 'TRANSFER_RECEIPT', 'TRANSFER_RESOLUTION'].includes(e.action) && <button className="link" onClick={() => setRev(e)}>Reverse</button>}</td></tr>))}</tbody>
        </table>
          {q.data.nextCursor && <button className="btn" onClick={() => setCursor(q.data.nextCursor)}>Older</button>}
        </div>
      )}
      {rev && <ReverseModal e={rev} onClose={() => setRev(null)} />}
    </>
  );
}

function ReverseModal({ e, onClose }: { e: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState(''), [key] = useState(() => crypto.randomUUID()), [error, setError] = useState<unknown>(null);
  const go = async () => { try { await mutate(`/transactions/${e.eventId}/reversal`, { reason }, key); qc.invalidateQueries(); onClose(); } catch (x) { setError(x); } };
  return (
    <Modal title="Reverse transaction" onClose={onClose}>
      <p>This posts a new compensating movement linked to the original. The original record stays in history.</p>
      <div className="card small">{ACTION_LABEL[e.action]}: {e.lines.map((l: any) => `${l.quantity} ${l.name}${l.roomNumber ? ` → room ${l.roomNumber}` : ''}`).join(', ')} · {e.actor.name}</div>
      <label className="field">Reason (required)<input value={reason} onChange={(x) => setReason(x.target.value)} /></label>
      <ErrorBanner error={error} />
      <button className="btn danger" disabled={reason.trim().length < 3} onClick={go}>Post reversal</button>
    </Modal>
  );
}

function Reports({ hotel }: { hotel: string }) {
  const { me } = useMe();
  const usage = useQuery<any>({ queryKey: ['voice-usage'], queryFn: () => get('/dashboard/voice-usage'), enabled: me.role === 'OWNER' });
  return (
    <>
      <h1>Reports</h1>
      <div className="card stack"><h2>Exports (CSV)</h2>
        <div className="row"><button className="btn" onClick={() => downloadUrl(`/reports/stock-events.csv?hotelId=${hotel}`)}>Stock activity</button>
          <button className="btn" onClick={() => downloadUrl(`/reports/counts.csv?hotelId=${hotel}`)}>Count history</button></div>
        <p className="small muted">Timestamps are UTC (ISO 8601).</p></div>
      {me.role === 'OWNER' && (
        <div className="card stack"><h2>Voice usage &amp; cost (last 30 days)</h2>
          {usage.data && <p className="small muted">Provider: {usage.data.provider} · model {usage.data.model} · daily cap ${usage.data.dailyLimitUsd}. Cost uses the per-token prices configured on the server; verify against Google's published pricing.</p>}
          {!usage.data?.days?.length ? <div className="muted">No voice attempts yet.</div> : (
            <div className="table-wrap"><table><thead><tr><th>Day</th><th className="num">Attempts</th><th className="num">Ready</th><th className="num">Needed help</th><th className="num">Failed</th><th className="num">Confirmed</th><th className="num">Avg sec</th><th className="num">Tokens in/out</th><th className="num">USD</th></tr></thead>
              <tbody>{usage.data.days.map((d: any) => <tr key={d.day}><td>{d.day}</td><td className="num">{d.attempts}</td><td className="num">{d.success}</td><td className="num">{d.ambiguous}</td><td className="num">{d.failed}</td><td className="num">{d.confirmed}</td>
                <td className="num">{(d.avg_duration_ms / 1000).toFixed(1)}</td><td className="num">{d.input_tokens}/{d.output_tokens}</td><td className="num">{Number(d.cost_usd).toFixed(4)}</td></tr>)}</tbody></table></div>)}
        </div>
      )}
    </>
  );
}
