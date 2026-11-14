/** Phone-first manager app: same shell as staff, cards instead of tables. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../api';
import { ACTION_LABEL, ErrorBanner, fmtTime, Loading, StatusBadge, useMe } from '../ui/common';
import { IconCount, IconHome, IconList, IconSend, IconSettings, IconStore } from '../ui/icons';
import { ResolveModal, ReverseModal, Today, usePoll, type Page } from '../owner/AdminApp';
import { CountHistory, WeeklyCount } from './Count';
import { Settings } from '../owner/Settings';
import { emojiFor } from '../staff/Flow';

type Tab = 'today' | 'count' | 'stock' | 'changes' | 'more';
type More = 'menu' | 'transfers' | 'history' | 'settings';

export function ManagerApp() {
  const { me, logout } = useMe();
  const hotels = me.hotels.filter((h) => h.roles.includes('MANAGER'));
  const [hotelId, setHotelId] = useState(hotels[0]?.id);
  const hotel = hotels.find((h) => h.id === hotelId)!;
  const [tab, setTab] = useState<Tab>('today');
  const [more, setMore] = useState<More>('menu');
  const go = (p: Page) => {
    if (p === 'count') setTab('count'); else if (p === 'stock') setTab('stock'); else if (p === 'activity') setTab('changes');
    else if (p === 'transfers') { setTab('more'); setMore('transfers'); } else if (p === 'history') { setTab('more'); setMore('history'); }
  };
  const nav: [Tab, () => JSX.Element, string][] = [['today', IconHome, 'Today'], ['count', IconCount, 'Count'], ['stock', IconStore, 'Stock'], ['changes', IconList, 'Changes'], ['more', IconSettings, 'More']];
  return (
    <div className="app mshell">
      <header className="topbar">
        <div className="who">
          {hotels.length > 1
            ? <select aria-label="Hotel" value={hotelId} onChange={(e) => setHotelId(e.target.value)} style={{ fontWeight: 700 }}>{hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
            : <b>{hotel.name}</b>}
          <div className="small muted">{me.displayName} · Manager</div>
        </div>
        <button className="link" onClick={logout}>Sign out</button>
      </header>
      <main className="content">
        {tab === 'today' && <Today hotel={hotelId} go={go} isOwner={false} />}
        {tab === 'count' && <WeeklyCount hotelId={hotelId} />}
        {tab === 'stock' && <StockCards hotelId={hotelId} />}
        {tab === 'changes' && <Changes hotelId={hotelId} tz={hotel.timezone} />}
        {tab === 'more' && (more === 'menu' ? (
          <>
            <h1>More</h1>
            <div className="tiles">
              <button className="tile" onClick={() => setMore('transfers')}><span className="ic"><IconSend /></span><span className="t">Between hotels</span></button>
              <button className="tile" onClick={() => setMore('history')}><span className="ic"><IconCount /></span><span className="t">Past counts</span></button>
              <button className="tile" onClick={() => setMore('settings')}><span className="ic"><IconSettings /></span><span><span className="t" style={{ display: 'block' }}>Settings</span><span className="s">Phones, staff, rooms, stock levels</span></span></button>
            </div>
          </>
        ) : (
          <>
            <button className="link" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setMore('menu')}>‹ More</button>
            {more === 'transfers' && <TransferCards hotelId={hotelId} />}
            {more === 'history' && <CountHistory hotel={hotelId} />}
            {more === 'settings' && <Settings />}
          </>
        ))}
      </main>
      <nav className="bottomnav" aria-label="Main"><div>
        {nav.map(([k, Ico, label]) => <button key={k} aria-current={tab === k ? 'page' : undefined} onClick={() => { setTab(k); if (k === 'more') setMore('menu'); }}><Ico />{label}</button>)}
      </div></nav>
    </div>
  );
}

export function StockCards({ hotelId }: { hotelId: string }) {
  const q = useQuery<any>({ queryKey: ['availability', hotelId], queryFn: () => get(`/dashboard/availability?hotelId=${hotelId}`), refetchInterval: usePoll() });
  const items: any[] = q.data?.items ?? [];
  const order = (i: any) => (i.out && i.reorderThreshold ? 0 : i.low ? 1 : 2);
  return (
    <>
      <h1>Stock</h1>
      <p className="small muted">Storeroom first. Low items are at the top.</p>
      <ErrorBanner error={q.error} />
      {q.isLoading ? <Loading /> : new Set(items.map((i) => i.hotelId)).size > 1 ? (
        <div className="stack" style={{ gap: 10 }}>
          {[...new Map(items.map((i) => [i.productId, i])).values()].map((p) => {
            const rows = items.filter((i) => i.productId === p.productId);
            return (
              <div key={p.productId} className="panel stack" style={{ gap: 8 }}>
                <div className="row"><span style={{ fontSize: '1.5rem' }} aria-hidden="true">{emojiFor({ sku: p.sku, icon: p.icon })}</span><b>{p.name}</b><span className="faint small">{p.unit}</span></div>
                {rows.map((i) => (
                  <div key={i.hotelId} className="row spread" style={{ flexWrap: 'nowrap' }}>
                    <span className="small">{i.hotelName}</span>
                    <span className="row" style={{ flexWrap: 'nowrap' }}>
                      {i.out && i.reorderThreshold ? <span className="badge bad">! Out</span> : i.low ? <span className="badge warn">▲ Low</span> : null}
                      <b style={{ minWidth: 40, textAlign: 'right' }}>{i.store}</b>
                    </span>
                  </div>))}
              </div>);
          })}
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {[...items].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map((i) => (
            <div key={i.productId} className="rline" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
              <span className="emoji" aria-hidden="true">{emojiFor({ sku: i.sku, icon: i.icon })}</span>
              <div><div className="what">{i.name}</div>
                <div className="where">With staff {i.staffHeld} · on the way {i.inTransitIn + i.inTransitOut} · reorder at {i.reorderThreshold}</div></div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{i.store}</div>
                {i.out && i.reorderThreshold ? <span className="badge bad">! Out</span> : i.low ? <span className="badge warn">▲ Low</span> : <span className="small faint">in store</span>}
              </div>
            </div>))}
        </div>
      )}
    </>
  );
}

export function Changes({ hotelId, tz }: { hotelId: string; tz?: string }) {
  const q = useQuery<any>({ queryKey: ['activity-admin', hotelId], queryFn: () => get(`/transactions?hotelId=${hotelId}&limit=40`) });
  const [rev, setRev] = useState<any>(null);
  return (
    <>
      <h1>Changes</h1>
      <p className="small muted">Everything recorded at this hotel, newest first. Undo a mistake with a reason — the original stays in the history.</p>
      {q.isLoading ? <Loading /> : (
        <section className="panel"><div className="recent">
          {(q.data?.items ?? []).map((e: any) => (
            <div key={e.eventId} className="item" style={{ gridTemplateColumns: '1fr auto' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{ACTION_LABEL[e.action] ?? e.action}{e.viaVoice && <span className="faint"> · by voice</span>}</div>
                <div className="small muted">{e.lines.map((l: any) => `${l.quantity} ${l.name}${l.roomNumber ? ` · room ${l.roomNumber}` : ''}`).join(', ')}</div>
                <div className="small faint">{e.actor.name} · {fmtTime(e.createdAt, tz)}</div>
              </div>
              {e.reversedBy ? <span className="badge neutral">Undone</span> : e.reversalOf ? <span className="badge neutral">Undo entry</span>
                : !['TRANSFER_DISPATCH', 'TRANSFER_RECEIPT', 'TRANSFER_RESOLUTION'].includes(e.action) && <button className="btn" onClick={() => setRev(e)}>Undo</button>}
            </div>))}
        </div></section>
      )}
      {rev && <ReverseModal e={rev} onClose={() => setRev(null)} />}
    </>
  );
}

export function TransferCards({ hotelId }: { hotelId: string }) {
  const q = useQuery<any>({ queryKey: ['dash-transfers', hotelId, 'OPEN'], queryFn: () => get(`/dashboard/transfers?hotelId=${hotelId}&status=OPEN`), refetchInterval: usePoll() });
  const [close, setClose] = useState<any>(null);
  return (
    <>
      <h1>Between hotels</h1>
      <p className="small muted">Deliveries that haven't fully arrived yet.</p>
      {q.isLoading ? <Loading /> : !q.data.items.length ? <div className="panel empty-state"><b>All deliveries have arrived.</b></div> : q.data.items.map((t: any) => (
        <div key={t.id} className="panel stack" style={{ gap: 8 }}>
          <div className="row spread"><b>{t.fromHotel.name} → {t.toHotel.name}</b><StatusBadge s={t.status} /></div>
          <div className="small">{t.lines.map((l: any) => `${l.name}: ${l.received} of ${l.sent} arrived`).join(' · ')}</div>
          <div className="small faint">{t.refCode} · sent {t.ageHours < 48 ? `${Math.round(t.ageHours)} hours` : `${Math.round(t.ageHours / 24)} days`} ago by {t.dispatchedBy.name}{t.aged ? ' · taking too long' : ''}</div>
          {t.outstandingUnits > 0 && <button className="btn" onClick={() => setClose(t)}>Close {t.outstandingUnits} missing</button>}
        </div>))}
      {close && <ResolveModal t={close} onClose={() => setClose(null)} />}
    </>
  );
}
