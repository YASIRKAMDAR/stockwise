import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorText, get, loadDrafts, mutate, NetworkError, saveDrafts, type Draft } from '../api';
import { DICTS, LANG_CODES, LANG_NAMES, type Lang } from '../i18n';
import { ACTION_LABEL, ErrorBanner, fmtTime, Loading, ProductIcon, StatusBadge, Stepper, useMe } from '../ui/common';
import { ActionEditor, type Draft0, type EditAction } from './ActionEditor';

export const useT = (lang: Lang) => DICTS[lang];
type Tab = 'speak' | 'stock' | 'transfers' | 'activity';

export function StaffApp() {
  const { me, logout } = useMe();
  const hotelId = me.activeHotel!;
  const hotel = me.hotels.find((h) => h.id === hotelId)!;
  const [lang, setLang] = useState<Lang>(me.language);
  const t = useT(lang);
  const [tab, setTab] = useState<Tab>('speak');
  const [editing, setEditing] = useState<Draft0 | null>(null);
  const changeLang = (l: Lang) => { setLang(l); api('PATCH', '/me', { language: l }).catch(() => {}); };

  const nav: [Tab, string, string][] = [['speak', '🎙', t.speak], ['stock', '🎒', t.myStock], ['transfers', '🚚', t.transfers], ['activity', '🕘', t.activity]];
  return (
    <div className="app" lang={lang}>
      <header className="topbar">
        <div><div style={{ fontWeight: 800 }}>{hotel.name}</div><div className="small muted">{me.displayName} · {me.employeeCode}</div></div>
        <div className="row">
          <label className="sr-only" htmlFor="lang">{t.language}</label>
          <select id="lang" value={lang} onChange={(e) => changeLang(e.target.value as Lang)} style={{ width: 'auto' }}>
            {(Object.keys(LANG_NAMES) as Lang[]).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
          </select>
          <button className="link" onClick={logout}>{t.signOut}</button>
        </div>
      </header>
      <main className="content">
        {editing ? (
          <ActionEditor key={JSON.stringify(editing).length + (editing.proposalId ?? '')} initial={editing} hotelId={hotelId} t={t} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
        ) : tab === 'speak' ? <Speak t={t} lang={lang} hotelId={hotelId} onEdit={setEditing} />
          : tab === 'stock' ? <MyStock t={t} hotelId={hotelId} onEdit={setEditing} />
          : tab === 'transfers' ? <Transfers t={t} hotelId={hotelId} onEdit={setEditing} />
          : <Activity hotelId={hotelId} tz={hotel.timezone} />}
      </main>
      <nav className="bottomnav" aria-label="Main"><div>
        {nav.map(([k, ico, label]) => <button key={k} aria-current={tab === k && !editing ? 'page' : undefined} onClick={() => { setEditing(null); setTab(k); }}><span className="ico" aria-hidden="true">{ico}</span>{label}</button>)}
      </div></nav>
    </div>
  );
}

// ---------------- Speak ----------------
type RecState = 'idle' | 'asking' | 'recording' | 'uploading' | 'denied' | 'error';

function Speak({ t, lang, hotelId, onEdit }: { t: ReturnType<typeof useT>; lang: Lang; hotelId: string; onEdit: (d: Draft0) => void }) {
  const { me } = useMe();
  const [state, setState] = useState<RecState>('idle');
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState<any>(null);
  const [clarify, setClarify] = useState<string | null>(null);
  const [fakeText, setFakeText] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const started = useRef(0);
  const max = me.config.voiceMaxSeconds;
  const voiceOn = me.config.voiceProvider !== 'disabled';

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((x) => x.stop()); }, []);

  const handleProposal = (p: any) => {
    setQuery(null); setClarify(null);
    if (p.status === 'QUERY_RESULT') { setQuery(p); return; }
    if (p.action === 'TRANSFER_RECEIPT') { setClarify('This sounds like stock arriving from another hotel. Open Transfers → Incoming to confirm it.'); return; }
    if (p.action === 'UNKNOWN' || !p.lines.length) { setClarify(p.clarificationQuestion ?? t.voiceUnavailable); return; }
    onEdit({ action: p.action as EditAction, proposalId: p.proposalId, transcript: p.transcript, targetHotelId: p.targetHotelId,
      lines: p.lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, roomId: l.roomId, source: l.source, issues: l.issues, candidates: l.candidates, spoken: l.spokenProduct })) });
  };

  const upload = async (blob: Blob, durationMs: number) => {
    setState('uploading');
    const fd = new FormData();
    fd.append('hotelId', hotelId); fd.append('preferredLanguage', LANG_CODES[lang]); fd.append('durationMs', String(durationMs));
    fd.append('audio', blob, 'speech');
    try { handleProposal(await api('POST', '/voice/interpret', fd)); setState('idle'); }
    catch (e) { setError(e); setState('error'); }
  };

  const start = async () => {
    setError(null); setQuery(null); setClarify(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setState('denied'); return; }
    setState('asking');
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true } }); } catch { setState('denied'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((x) => x.stop());
      if (timer.current) clearInterval(timer.current);
      const dur = Date.now() - started.current;
      if (dur < 600) { setState('idle'); return; }
      upload(new Blob(chunks, { type: (r.mimeType || 'audio/webm').split(';')[0] }), dur);
    };
    rec.current = r; started.current = Date.now(); setSecs(0);
    r.start();
    setState('recording');
    timer.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - started.current) / 1000);
      setSecs(s);
      if (s >= max && r.state === 'recording') r.stop(); // hard stop
    }, 250);
  };
  const stop = () => rec.current?.state === 'recording' && rec.current.stop();

  const sendFake = async () => {
    const fd = new FormData();
    fd.append('hotelId', hotelId); fd.append('audio', new Blob([fakeText], { type: 'text/plain' }), 'fixture.txt');
    setState('uploading');
    try { handleProposal(await api('POST', '/voice/interpret', fd)); setState('idle'); } catch (e) { setError(e); setState('error'); }
  };

  return (
    <>
      <Drafts />
      {voiceOn ? (
        <section className="card stack" style={{ textAlign: 'center' }} aria-live="polite">
          <p style={{ margin: 0, fontWeight: 600 }}>{t.tapAndTell}</p>
          <button className={`mic${state === 'recording' ? ' rec' : ''}`} onClick={state === 'recording' ? stop : start} disabled={state === 'uploading' || state === 'asking'}
            aria-label={state === 'recording' ? 'Stop recording' : 'Start recording'}>
            {state === 'recording' ? '■' : state === 'uploading' ? '…' : '🎙'}
          </button>
          <div className="small" style={{ minHeight: 24 }}>
            {state === 'recording' && <b>{t.recording} · {secs}s / {max}s</b>}
            {state === 'uploading' && <b>{t.understanding}</b>}
            {state === 'asking' && 'Waiting for microphone permission…'}
          </div>
          {state === 'denied' && <div className="banner warn">{t.micDenied}</div>}
          {state === 'error' && <div className="banner bad" role="alert">{error instanceof ApiError && error.status === 503 ? t.voiceUnavailable : errorText(error)}</div>}
          {clarify && <div className="banner warn">{clarify}</div>}
          <div className="small muted">{t.examples.map((e) => <div key={e}>“{e}”</div>)}</div>
          {me.config.voiceProvider === 'fake' && (
            <details className="small" style={{ textAlign: 'left' }}>
              <summary>Developer: simulate speech (FAKE provider — not real recognition)</summary>
              <div className="row" style={{ marginTop: 8 }}><input value={fakeText} onChange={(e) => setFakeText(e.target.value)} placeholder="Room 101 mein 2 soap rakhe" /><button className="btn" onClick={sendFake}>Send</button></div>
            </details>
          )}
        </section>
      ) : <div className="banner info">Voice entry is not enabled. Use manual entry below.</div>}
      {query && <QueryResult q={query} />}
      <button className="btn lg block" onClick={() => onEdit({ action: 'PLACE_IN_ROOM', lines: [] })}>⌨ {t.orManual}</button>
      <Activity hotelId={hotelId} compact />
    </>
  );
}

function QueryResult({ q }: { q: any }) {
  return (
    <section className="card stack" aria-live="polite">
      <h2>Stock now</h2>
      <div className="small muted">“{q.transcript}”</div>
      <table><thead><tr><th>Item</th><th className="num">Store</th><th className="num">With staff</th><th className="num">In transit</th></tr></thead>
        <tbody>{(q.queryResult ?? []).map((r: any) => <tr key={r.productId}><td>{r.name}<div className="small muted">{r.hotelName}</div></td><td className="num">{r.store}</td><td className="num">{r.staffHeld}</td><td className="num">{r.inTransit}</td></tr>)}</tbody></table>
    </section>
  );
}

function Drafts() {
  const { me } = useMe();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Draft[]>(() => loadDrafts(me.id));
  const [msg, setMsg] = useState<string | null>(null);
  if (!drafts.length) return msg ? <div className="banner ok">{msg}</div> : null;
  const retry = async (d: Draft) => {
    try {
      await mutate(d.path, d.body, d.key); // same idempotency key: a request that did reach the server is not applied twice
      const rest = drafts.filter((x) => x.key !== d.key); saveDrafts(me.id, rest); setDrafts(rest); setMsg('✓ Draft submitted'); qc.invalidateQueries();
    } catch (e) {
      if (!(e instanceof NetworkError)) { setMsg(`Could not submit: ${errorText(e)}`); }
      else setMsg('Still offline. Nothing was saved.');
    }
  };
  const discard = (d: Draft) => { const rest = drafts.filter((x) => x.key !== d.key); saveDrafts(me.id, rest); setDrafts(rest); };
  return (
    <section className="card stack" style={{ borderColor: 'var(--warning)' }}>
      <h2>⏳ Not submitted ({drafts.length})</h2>
      {msg && <div className="small">{msg}</div>}
      {drafts.map((d) => (
        <div key={d.key} className="row spread"><span className="small">{d.label}</span>
          <span className="row"><button className="btn" onClick={() => retry(d)}>Retry</button><button className="link" onClick={() => discard(d)}>Discard</button></span></div>
      ))}
    </section>
  );
}

// ---------------- My stock ----------------
function MyStock({ t, hotelId, onEdit }: { t: ReturnType<typeof useT>; hotelId: string; onEdit: (d: Draft0) => void }) {
  const q = useQuery<any>({ queryKey: ['mystock', hotelId], queryFn: () => get(`/me/stock?hotelId=${hotelId}`) });
  if (q.isLoading) return <Loading />;
  const items = q.data?.items ?? [];
  return (
    <>
      <h1>{t.myStock}</h1>
      <ErrorBanner error={q.error} />
      {!items.length ? <div className="card muted">{t.noStockWithYou}</div> : (
        <div className="card stack">
          {items.map((i: any) => <div key={i.productId} className="row spread"><span className="row"><ProductIcon icon={i.icon} />{i.name}</span><b className="mono">{i.quantity} {i.unit}</b></div>)}
        </div>
      )}
      <div className="row">
        <button className="btn lg" style={{ flex: 1 }} disabled={!items.length} onClick={() => onEdit({ action: 'PLACE_IN_ROOM', lines: [{ productId: items[0]?.productId, quantity: 1, roomId: null, source: 'MY_STOCK' }] })}>{t.placedInRoom}</button>
        <button className="btn lg" style={{ flex: 1 }} disabled={!items.length} onClick={() => onEdit({ action: 'RETURN_TO_STORE', lines: items.map((i: any) => ({ productId: i.productId, quantity: i.quantity, roomId: null, source: 'MY_STOCK' })) })}>{t.returnToStore}</button>
      </div>
      <button className="btn primary lg block" onClick={() => onEdit({ action: 'CHECKOUT_TO_STAFF', lines: [] })}>{t.takeStock}</button>
    </>
  );
}

// ---------------- Transfers ----------------
function Transfers({ t, hotelId, onEdit }: { t: ReturnType<typeof useT>; hotelId: string; onEdit: (d: Draft0) => void }) {
  const { me } = useMe();
  const q = useQuery<any[]>({ queryKey: ['transfers', hotelId], queryFn: () => get(`/transfers?hotelId=${hotelId}`) });
  const incoming = (q.data ?? []).filter((x) => x.toHotel.id === hotelId && ['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(x.status));
  const outgoing = (q.data ?? []).filter((x) => x.fromHotel.id === hotelId).slice(-10).reverse();
  return (
    <>
      <h1>{t.transfers}</h1>
      <button className="btn primary lg block" onClick={() => onEdit({ action: 'TRANSFER_DISPATCH', lines: [] })}>🚚 {t.send}</button>
      <h2>{t.incoming}</h2>
      {q.isLoading ? <Loading /> : !incoming.length ? <div className="card muted">No stock on the way to this hotel.</div> : incoming.map((tr) => <Receive key={tr.id} tr={tr} t={t} isSender={tr.dispatchedBy.id === me.id} />)}
      {outgoing.length > 0 && <><h2>Sent from this hotel</h2>
        {outgoing.map((tr) => <div key={tr.id} className="card row spread"><div><b>{tr.refCode}</b> → {tr.toHotel.name}<div className="small muted">{tr.lines.map((l: any) => `${l.received}/${l.sent} ${l.name}`).join(', ')}</div></div><StatusBadge s={tr.status} /></div>)}</>}
    </>
  );
}

function Receive({ tr, t, isSender }: { tr: any; t: ReturnType<typeof useT>; isSender: boolean }) {
  const qc = useQueryClient();
  const remaining = (l: any) => l.sent - l.received - l.resolvedShort;
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(tr.lines.map((l: any) => [l.productId, remaining(l)])));
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [ok, setOk] = useState<string | null>(null);
  const short = tr.lines.reduce((s: number, l: any) => s + remaining(l) - (qty[l.productId] ?? 0), 0);
  const submit = async (final: boolean) => {
    setBusy(true); setError(null);
    try {
      const r = await mutate(`/transfers/${tr.id}/receipts`, { lines: tr.lines.map((l: any) => ({ productId: l.productId, receivedQuantity: qty[l.productId] ?? 0 })), final }, key);
      setOk(r.outstandingUnits ? `Received. ${r.outstandingUnits} still in transit${final ? ' — reported to manager' : ''}.` : 'All received.');
      setKey(crypto.randomUUID()); qc.invalidateQueries();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <div className="card stack">
      <div className="row spread"><b>{tr.refCode} · from {tr.fromHotel.name}</b><StatusBadge s={tr.status} /></div>
      <div className="small muted">Sent {fmtTime(tr.dispatchedAt)} by {tr.dispatchedBy.name}</div>
      {tr.lines.filter((l: any) => remaining(l) > 0).map((l: any) => (
        <div key={l.productId} className="row spread"><span>{l.name}<div className="small muted">{remaining(l)} {l.unit} on the way{l.received ? ` (${l.received} already received)` : ''}</div></span>
          <Stepper label={`Received ${l.name}`} value={qty[l.productId]} onChange={(n) => setQty({ ...qty, [l.productId]: Math.min(n, remaining(l)) })} /></div>
      ))}
      {short > 0 && <div className="banner warn small">{short} fewer than sent. They stay “in transit” until received or resolved by a manager.</div>}
      {ok && <div className="banner ok">✓ {ok}</div>}
      <ErrorBanner error={error} />
      {isSender ? <div className="small muted">You sent this transfer, so someone else at the receiving hotel must confirm it.</div> : (
        <div className="row">
          <button className="btn primary lg" style={{ flex: 2 }} disabled={busy} onClick={() => submit(false)}>{t.confirmReceived}</button>
          {short > 0 && <button className="btn lg" style={{ flex: 1 }} disabled={busy} onClick={() => submit(true)}>That's all that came</button>}
        </div>
      )}
    </div>
  );
}

// ---------------- Activity ----------------
export function Activity({ hotelId, compact, tz }: { hotelId: string; compact?: boolean; tz?: string }) {
  const q = useQuery<any>({ queryKey: ['activity', hotelId], queryFn: () => get(`/transactions?hotelId=${hotelId}&limit=${compact ? 5 : 30}`) });
  const [corr, setCorr] = useState<string | null>(null), [note, setNote] = useState(''), [sent, setSent] = useState<string | null>(null);
  const items = q.data?.items ?? [];
  const request = async (eventId: string) => { await api('POST', `/transactions/${eventId}/correction-requests`, { note }); setSent(eventId); setCorr(null); setNote(''); };
  return (
    <section className="stack">
      <h2>{compact ? 'Recent movements' : 'My activity'}</h2>
      {q.isLoading ? <Loading /> : !items.length ? <div className="card muted">Nothing recorded yet.</div> : items.map((e: any) => (
        <div key={e.eventId} className="card stack" style={{ gap: 4 }}>
          <div className="row spread"><b>{ACTION_LABEL[e.action] ?? e.action}</b><span className="badge ok">✓ Recorded</span></div>
          <div className="small">{e.lines.map((l: any) => `${l.quantity} ${l.name}${l.roomNumber ? ` → room ${l.roomNumber}` : ''}`).join(' · ')}</div>
          <div className="small muted">{fmtTime(e.createdAt, tz)} · {e.actor.name} · Ref <span className="mono">{e.eventId.slice(0, 8).toUpperCase()}</span>{e.viaVoice ? ' · 🎙' : ''}{e.reversedBy ? ' · corrected' : ''}</div>
          {!compact && !e.reversedBy && (sent === e.eventId ? <div className="small" style={{ color: 'var(--success)' }}>Correction requested</div> : corr === e.eventId ? (
            <div className="row"><input value={note} onChange={(x) => setNote(x.target.value)} placeholder="What is wrong?" /><button className="btn" disabled={note.trim().length < 3} onClick={() => request(e.eventId)}>Send</button></div>
          ) : <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setCorr(e.eventId)}>Request correction</button>)}
        </div>
      ))}
    </section>
  );
}
