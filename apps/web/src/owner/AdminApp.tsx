import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, mutate } from '../api';
import { ACTION_LABEL, BarList, downloadUrl, ErrorBanner, fmtTime, Freshness, Loading, Modal, StatusBadge, useMe } from '../ui/common';
import { IconArrived, IconChart, IconCheck, IconClock, IconCount, IconHome, IconList, IconSend, IconSettings, IconSignOut, IconStore } from '../ui/icons';
import { CountHistory, WeeklyCount } from '../manager/Count';
import { Settings } from './Settings';
import { Changes, StockCards, TransferCards } from '../manager/ManagerApp';
import { VoiceAsk, type VoiceGo } from '../ui/VoiceAsk';
import { BurgerMenu } from '../ui/Menu';

export type Page = 'today' | 'count' | 'stock' | 'usage' | 'transfers' | 'history' | 'activity' | 'reports' | 'settings';

function useIsPhone() {
  const q = '(max-width: 760px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  return m;
}

export function AdminApp() {
  const { me, logout } = useMe();
  const phone = useIsPhone();
  const isOwner = me.role === 'OWNER';
  const pages: [Page, string, () => JSX.Element][] = isOwner
    ? [['today', 'Today', IconHome], ['stock', 'Stock by hotel', IconStore], ['usage', 'Room use', IconChart], ['transfers', 'Between hotels', IconSend], ['history', 'Weekly counts', IconCount], ['activity', 'All changes', IconList], ['reports', 'Reports', IconArrived], ['settings', 'Settings', IconSettings]]
    : [['today', 'Today', IconHome], ['count', 'Weekly count', IconCount], ['stock', 'Stock', IconStore], ['transfers', 'Between hotels', IconSend], ['activity', 'All changes', IconList], ['history', 'Past counts', IconClock], ['settings', 'Settings', IconSettings]];
  const [page, setPage] = useState<Page>('today');
  const managed = me.hotels.filter((h) => isOwner || h.roles.includes('MANAGER'));
  const [hotel, setHotel] = useState<string>(isOwner ? 'all' : managed[0]?.id);
  const pickerOptions = isOwner ? [{ id: 'all', name: `All ${managed.length} hotels` }, ...managed] : managed;

  if (phone) {
    return (
      <div className="app mshell nobottom">
        <header className="topbar">
          <BurgerMenu who={<><b>{me.displayName}</b><div className="small">{isOwner ? 'Owner' : 'Manager'}</div></>}
            items={pages.map(([k, l, Icon]) => ({ key: k, label: l, Icon, current: page === k, onClick: () => setPage(k) }))} onSignOut={logout} />
          <div className="who" style={{ flex: 1, minWidth: 0 }}>
            <select aria-label="Hotel" value={hotel} onChange={(e) => setHotel(e.target.value)} style={{ fontWeight: 700, maxWidth: '100%' }}>{pickerOptions.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
            <div className="small muted">{pages.find((x) => x[0] === page)?.[1]}</div>
          </div>
        </header>
        <main className="content">
          {page === 'today' && <Today hotel={hotel} go={setPage} isOwner={isOwner} showAsk={false} />}
          {page === 'count' && <WeeklyCount hotelId={hotel === 'all' ? managed[0].id : hotel} />}
          {page === 'stock' && <StockCards hotelId={hotel} />}
          {page === 'usage' && <Usage hotel={hotel} />}
          {page === 'activity' && <Changes hotelId={hotel} />}
          {page === 'transfers' && <TransferCards hotelId={hotel} />}
          {page === 'history' && <CountHistory hotel={hotel} />}
          {page === 'reports' && <Reports hotel={hotel} />}
          {page === 'settings' && <Settings />}
        </main>
        {page !== 'count' && <DockedAsk hotel={hotel} go={setPage} isOwner={isOwner} />}
      </div>
    );
  }

  return (
    <div className="shell">
      <nav className="sidenav" aria-label="Main">
        <div className="brand"><img src="/icon.svg" alt="" width="28" />Stockwise</div>
        {pages.map(([k, l, Ico]) => <button key={k} aria-current={page === k ? 'page' : undefined} onClick={() => setPage(k)}><Ico />{l}</button>)}
        <div className="spacer" style={{ flex: 1 }} />
        <div className="me">{me.displayName}<br />{isOwner ? 'Owner' : 'Manager'}</div>
        <button onClick={logout}><IconSignOut />Sign out</button>
      </nav>
      <main className="main">
        {pickerOptions.length > 1 && page !== 'settings' && page !== 'count' && (
          <div className="hotelpick">
            <label htmlFor="hotelpick" className="small muted">Showing</label>
            <select id="hotelpick" value={hotel} onChange={(e) => setHotel(e.target.value)}>{pickerOptions.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          </div>
        )}
        {page === 'today' && <Today hotel={hotel} go={setPage} isOwner={isOwner} />}
        {page === 'count' && <WeeklyCount hotelId={hotel === 'all' ? managed[0].id : hotel} />}
        {page === 'stock' && <Availability hotel={hotel} />}
        {page === 'usage' && <Usage hotel={hotel} />}
        {page === 'transfers' && <TransfersPage hotel={hotel} />}
        {page === 'history' && <CountHistory hotel={hotel} />}
        {page === 'activity' && <ActivityAdmin hotel={hotel} />}
        {page === 'reports' && <Reports hotel={hotel} />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}

export const usePoll = () => useMe().me.config.ownerPollSeconds * 1000;
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

/** "What needs me today" first, then the stock picture, then each hotel. */
/** The ask bar docked at the bottom of phone screens (manager and owner). */
export function DockedAsk({ hotel, go, isOwner }: { hotel: string; go: (p: Page) => void; isOwner: boolean }) {
  const { me } = useMe();
  return <VoiceAsk docked hotelId={hotel === 'all' ? me.hotels[0].id : hotel} scopeAll={hotel === 'all'} onGo={(a: VoiceGo) => {
    const map: Record<VoiceGo, Page | null> = { SHOW_ALERTS: 'today', SHOW_TRANSFERS: 'transfers', SHOW_ROOM_USE: isOwner ? 'usage' : null, SHOW_CHANGES: 'activity', START_COUNT: isOwner ? 'history' : 'count' };
    const p = map[a]; if (p) setTimeout(() => go(p), 700);
  }} />;
}

export function Today({ hotel, go, isOwner, showAsk = true }: { hotel: string; go: (p: Page) => void; isOwner: boolean; showAsk?: boolean }) {
  const { me } = useMe();
  const poll = usePoll();
  const ov = useQuery<any>({ queryKey: ['overview', hotel, 30], queryFn: () => get(`/dashboard/overview?hotelId=${hotel}&periodDays=30`), refetchInterval: poll });
  const al = useQuery<any>({ queryKey: ['alerts', hotel], queryFn: () => get(`/dashboard/alerts?hotelId=${hotel}`), refetchInterval: poll });
  const corr = useQuery<any[]>({ queryKey: ['corrections', hotel], queryFn: () => get(`/correction-requests?hotelId=${hotel}`) });
  const qc = useQueryClient();
  const d = ov.data;
  const items: any[] = al.data?.items ?? [];
  const action = (cat: string): [string, Page] | null =>
    cat === 'LOW_STOCK' ? ['See stock', 'stock'] : cat.startsWith('TRANSFER') ? ['Open', 'transfers'] : cat === 'COUNT_OVERDUE' ? (isOwner ? ['See counts', 'history'] : ['Start count', 'count'])
    : cat === 'LARGE_VARIANCE' ? ['See count', 'history'] : cat === 'CORRECTION_REQUEST' ? ['Review', 'activity'] : null;
  const plain = (a: any) =>
    a.category === 'LOW_STOCK' ? a.title.replace(' low at ', ' is running low at ').replace(' out of stock at ', ' has run out at ')
    : a.category === 'TRANSFER_AGED' ? `${a.title.replace(/^Transfer /, 'Delivery ')} hasn't fully arrived`
    : a.category === 'TRANSFER_DISCREPANCY' ? `${a.title.replace(/^Transfer /, 'Delivery ')} arrived short`
    : a.category === 'COUNT_OVERDUE' ? a.title.replace('Weekly count overdue at', 'Weekly count not done at')
    : a.category === 'LARGE_VARIANCE' ? a.title.replace('Large count variance', 'Count found a big difference')
    : a.title;
  return (
    <>
      <div className="pagehead">
        <div><h1>{greeting()}, {me.displayName.split(' ')[0]}</h1><p>{items.length ? `${items.length} ${items.length === 1 ? 'thing needs' : 'things need'} your attention.` : 'Everything is in order.'}</p></div>
        <Freshness asOf={d?.asOf} isError={ov.isError} />
      </div>
      {showAsk && <VoiceAsk hotelId={hotel === 'all' ? me.hotels[0].id : hotel} scopeAll={hotel === 'all'} onGo={(a: VoiceGo) => {
        const map: Record<VoiceGo, Page | null> = { SHOW_ALERTS: null, SHOW_TRANSFERS: 'transfers', SHOW_ROOM_USE: isOwner ? 'usage' : null, SHOW_CHANGES: 'activity', START_COUNT: isOwner ? 'history' : 'count' };
        const p = map[a]; if (p) setTimeout(() => go(p), 900); else document.querySelector('.attention')?.scrollIntoView({ behavior: 'smooth' });
      }} />}

      <section className="attention" aria-label="Needs attention">
        <div className="head"><h2>Needs attention</h2>{items.length > 0 && <span className="small muted">Most urgent first</span>}</div>
        {al.isLoading ? <div style={{ padding: 16 }}><Loading /></div> : !items.length ? (
          <div className="allclear"><IconCheck /> Nothing needs you right now.</div>
        ) : items.slice(0, 8).map((a) => { const act = action(a.category); return (
          <div key={a.id} className={`att ${a.severity}`}>
            <span className="bar" />
            <div><div className="t">{plain(a)}</div><div className="d">{a.detail}</div></div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <StatusBadge s={a.severity} />
              {act && <button className="btn" onClick={() => go(act[1])}>{act[0]}</button>}
            </div>
          </div>); })}
        {(corr.data ?? []).filter((c) => c.status === 'OPEN').map((c) => (
          <div key={c.id} className="att LOW">
            <span className="bar" />
            <div><div className="t">{c.requestedBy} reported a mistake</div><div className="d">“{c.note}” · {c.hotelName}</div></div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <button className="btn" onClick={() => go('activity')}>Fix it</button>
              <button className="link" onClick={async () => { await mutate(`/correction-requests/${c.id}/dismiss`, {}); qc.invalidateQueries(); }}>Dismiss</button>
            </div>
          </div>))}
      </section>

      {d && (
        <>
          <section className="stack" aria-label="Stock right now">
            <h2>Stock right now</h2>
            <div className="figs">
              <div className="fig"><div className="v">{d.storeAvailableUnits.toLocaleString()}</div><div className="l">In the storerooms</div><div className="h">Ready to use</div></div>
              <div className="fig"><div className="v">{d.staffHeldUnits.toLocaleString()}</div><div className="l">With housekeeping staff</div><div className="h">Taken out, not yet in rooms</div></div>
              <div className="fig"><div className="v">{d.inTransitUnits.toLocaleString()}</div><div className="l">On the way between hotels</div><div className="h">Sent, not yet received</div></div>
            </div>
            <div className="flowfig"><span className="v">{d.placedInRoomsUnits.toLocaleString()}</span><span><b>Put in guest rooms</b> in the last 30 days <span className="faint small">— a separate measure, not part of stock</span></span>
              {isOwner && <button className="btn quiet" style={{ marginLeft: 'auto' }} onClick={() => go('usage')}>Room use</button>}</div>
          </section>
          {d.hotels.length > 1 || isOwner ? (
            <section className="stack" aria-label="Hotels">
              <h2>Hotels</h2>
              <div className="hotels">
                {d.hotels.map((h: any) => (
                  <div key={h.hotelId} className="hotel">
                    <div className="row spread"><h3>{h.name}</h3><StatusBadge s={h.countState} /></div>
                    <div className="kv">
                      <span>In storeroom</span><span>{h.storeAvailableUnits}</span>
                      <span>With staff</span><span>{h.staffHeldUnits}</span>
                      <span>Sent, on the way</span><span>{h.inTransitOutUnits}</span>
                      <span>Put in rooms (30 days)</span><span>{h.placedInRoomsUnits}</span>
                    </div>
                    <div className="small">{h.lowStockCount ? <span className="badge warn">▲ {h.lowStockCount} running low</span> : <span className="badge ok">✓ Stock OK</span>}
                      <span className="faint"> · last counted {h.lastCountAt ? fmtTime(h.lastCountAt) : 'never'}</span></div>
                  </div>))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

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
      <div className="row spread"><h1>Stock by hotel</h1><div className="row"><Freshness asOf={q.data?.asOf} isError={q.isError} />
        <button className="btn" onClick={() => downloadUrl(`/reports/stock-events.csv?hotelId=${hotel}`)}>Export activity CSV</button></div></div>
      <div className="small muted">How many are in each hotel's storeroom. <span className="badge warn">▲ Low</span> means below the reorder level, <span className="badge bad">! Out</span> means none left. Click a product to see where it is.</div>
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
      <div className="row spread"><h1>Room use</h1>
        <div className="row">
          <select value={product} onChange={(e) => setProduct(e.target.value)} style={{ width: 'auto' }} aria-label="Product"><option value="">All products</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <div className="seg" role="group" aria-label="Period">{[7, 30, 90].map((p) => <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)} style={{ padding: '0 14px' }}>{p}d</button>)}</div>
        </div></div>
      <p className="small muted">Units issued to rooms by staff. This is not guest consumption — high numbers can reflect room turnover or special requests. Occupancy data is not connected, so per-room-night rates are not shown.</p>
      {q.isLoading ? <Loading /> : !d?.totalUnits ? <div className="card muted">No room placements in this period.</div> : (
        <>
          <div className="figs" style={{ gridTemplateColumns: "1fr 1fr" }}><div className="fig"><div className="v">{d.totalUnits.toLocaleString()}</div><div className="l">Items put in rooms</div></div><div className="fig"><div className="v">{d.placementEvents.toLocaleString()}</div><div className="l">Times staff recorded it</div></div></div>
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
      <div className="row spread"><h1>Between hotels</h1>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="Status">
          <option value="OPEN">Not fully arrived</option><option value="DISCREPANCY">Arrived short</option><option value="RECEIVED">Arrived</option><option value="RESOLVED">Closed</option><option value="">All</option>
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
                <button className="btn" onClick={() => setResolve(t)}>Close {t.outstandingUnits} missing</button>}</td></tr>))}</tbody>
        </table></div>
      )}
      {resolve && <ResolveModal t={resolve} onClose={() => setResolve(null)} />}
    </>
  );
}

export function ResolveModal({ t, onClose }: { t: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('LOST'), [note, setNote] = useState(''), [key] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await mutate(`/transfers/${t.id}/resolve`, { reason, note: note || undefined }, key); qc.invalidateQueries(); onClose(); } catch (e) { setError(e); } finally { setBusy(false); } };
  return (
    <Modal title={`Close missing items on ${t.refCode}`} onClose={onClose}>
      <p>{t.outstandingUnits} item(s) were sent but never arrived. Closing writes them off as missing and keeps a record of who did it and why.</p>
      <label className="field">Reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="LOST">Lost</option><option value="DAMAGED">Damaged</option><option value="COUNTING_ERROR">Counting error when sent</option><option value="OTHER">Other</option></select></label>
      <label className="field">Note<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <ErrorBanner error={error} />
      <button className="btn primary" disabled={busy} onClick={go}>Write off as missing</button>
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
      <div className="row spread"><h1>All changes</h1>
        <select value={action} onChange={(e) => { setAction(e.target.value); setCursor(null); }} style={{ width: 'auto' }} aria-label="Action"><option value="">All actions</option>{Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      {q.isLoading ? <Loading /> : (
        <div className="card table-wrap"><table>
          <thead><tr><th>When</th><th>Action</th><th>Items</th><th>Who</th><th>Hotel</th><th></th></tr></thead>
          <tbody>{q.data.items.map((e: any) => (
            <tr key={e.eventId}><td className="small">{fmtTime(e.createdAt)}<div className="mono muted">{e.eventId.slice(0, 8).toUpperCase()}</div></td>
              <td>{ACTION_LABEL[e.action]}{e.viaVoice && <span title="Recorded by voice"> 🎙</span>}{e.reason && <div className="small muted">{e.reason}</div>}</td>
              <td className="small">{e.lines.map((l: any) => `${l.quantity} ${l.name}${l.roomNumber ? ` → ${l.roomNumber}` : ''}`).join(' · ')}</td>
              <td className="small">{e.actor.name}</td><td className="small">{e.hotelName}</td>
              <td>{e.reversedBy ? <span className="badge neutral">Undone</span> : e.reversalOf ? <span className="badge neutral">Undo entry</span> :
                !['TRANSFER_DISPATCH', 'TRANSFER_RECEIPT', 'TRANSFER_RESOLUTION'].includes(e.action) && <button className="link" onClick={() => setRev(e)}>Undo with a reason</button>}</td></tr>))}</tbody>
        </table>
          {q.data.nextCursor && <button className="btn" onClick={() => setCursor(q.data.nextCursor)}>Older</button>}
        </div>
      )}
      {rev && <ReverseModal e={rev} onClose={() => setRev(null)} />}
    </>
  );
}

export function ReverseModal({ e, onClose }: { e: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState(''), [key] = useState(() => crypto.randomUUID()), [error, setError] = useState<unknown>(null);
  const go = async () => { try { await mutate(`/transactions/${e.eventId}/reversal`, { reason }, key); qc.invalidateQueries(); onClose(); } catch (x) { setError(x); } };
  return (
    <Modal title="Undo this change" onClose={onClose}>
      <p>This adds a correcting entry that cancels it out. The original stays in the history, marked as undone.</p>
      <div className="card small">{ACTION_LABEL[e.action]}: {e.lines.map((l: any) => `${l.quantity} ${l.name}${l.roomNumber ? ` → room ${l.roomNumber}` : ''}`).join(', ')} · {e.actor.name}</div>
      <label className="field">Reason (required)<input value={reason} onChange={(x) => setReason(x.target.value)} /></label>
      <ErrorBanner error={error} />
      <button className="btn danger" disabled={reason.trim().length < 3} onClick={go}>Undo it</button>
    </Modal>
  );
}

function Reports({ hotel }: { hotel: string }) {
  const { me } = useMe();
  const usage = useQuery<any>({ queryKey: ['voice-usage'], queryFn: () => get('/dashboard/voice-usage'), enabled: me.role === 'OWNER' });
  const health = useQuery<any>({ queryKey: ['voice-health'], queryFn: () => get('/dashboard/voice-health?days=7'), enabled: me.role === 'OWNER', refetchInterval: 60_000 });
  return (
    <>
      <h1>Reports</h1>
      {me.role === 'OWNER' && <VoiceHealth h={health.data} />}
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

/** Is voice working? Success rate and speed over the last 7 days, by language and by app, plus the latest attempts. */
function VoiceHealth({ h }: { h: any }) {
  if (!h) return null;
  const tot = h.total ?? {};
  const rate = tot.attempts ? Math.round(((tot.success + tot.ambiguous) / tot.attempts) * 100) : null;
  const tone = rate === null ? '' : rate >= 95 && tot.p95_ms <= 4000 ? 'ok' : rate >= 85 ? 'warn' : 'bad';
  const secs = (ms: number) => (ms / 1000).toFixed(1) + 's';
  const Row = ({ r, label }: { r: any; label: string }) => (
    <tr><td>{label}</td><td className="num">{r.attempts}</td><td className="num">{r.attempts ? Math.round(((r.success + r.ambiguous) / r.attempts) * 100) + '%' : '–'}</td>
      <td className="num">{r.failed}</td><td className="num">{r.fallback}</td><td className="num">{secs(r.p50_ms)}</td><td className="num">{secs(r.p95_ms)}</td></tr>
  );
  const langName: Record<string, string> = { 'gu-IN': 'Gujarati', 'hi-IN': 'Hindi', 'en-IN': 'English', mixed: 'Mixed', unknown: 'Unknown' };
  return (
    <div className="card stack">
      <div className="row spread"><h2>Voice health (last {h.days} days)</h2><span className="small muted">{h.provider} · {h.model}</span></div>
      {!tot.attempts ? <div className="muted">No voice attempts yet.</div> : (
        <>
          <div className={`banner ${tone}`} style={{ fontSize: '1.05rem' }}>
            <b>{rate}% answered</b> · typical {secs(tot.p50_ms)} · slowest 5% {secs(tot.p95_ms)} · {tot.failed} failed · {tot.fallback} answered from phone words
            {typeof tot.cost_usd === 'number' && <> · ${tot.cost_usd.toFixed(3)} spent</>}
            <div className="small" style={{ marginTop: 4 }}>Target: 95% answered, slowest 5% under 4 seconds.</div>
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th>By language / app</th><th className="num">Attempts</th><th className="num">Answered</th><th className="num">Failed</th><th className="num">Fallback</th><th className="num">Typical</th><th className="num">Slow 5%</th></tr></thead>
            <tbody>
              {h.byLanguage.map((r: any) => <Row key={'l' + r.language} r={r} label={langName[r.language] ?? r.language} />)}
              {h.byClient.map((r: any) => <Row key={'c' + r.client} r={r} label={r.client === 'ios' ? 'iPhone app' : r.client === 'android' ? 'Android app' : r.client === 'web' ? 'Website' : 'Older app'} />)}
            </tbody></table></div>
          <details className="small"><summary>Last {h.recent.length} attempts</summary>
            <div className="table-wrap"><table>
              <thead><tr><th>When</th><th>Who</th><th>Heard</th><th>Language</th><th>App</th><th className="num">Secs</th><th>Result</th></tr></thead>
              <tbody>{h.recent.map((r: any, i: number) => (
                <tr key={i}><td>{new Date(r.created_at).toLocaleString()}</td><td>{r.user}</td><td style={{ maxWidth: 260 }}>{r.transcript ?? <span className="muted">–</span>}</td>
                  <td>{langName[r.language] ?? r.language ?? '–'}</td><td>{r.client ?? '–'}{r.input_kind === 'text' ? ' (typed)' : ''}</td><td className="num">{secs(r.latency_ms)}</td>
                  <td>{r.status === 'FAILED' ? <span style={{ color: 'var(--brick)' }}>Failed {r.error_code ? `(${r.error_code})` : ''}</span> : r.fallback ? 'From phone words' : r.confirmed ? 'Confirmed' : r.status === 'AMBIGUOUS' ? 'Needed help' : r.action}</td></tr>
              ))}</tbody></table></div>
          </details>
        </>
      )}
    </div>
  );
}
