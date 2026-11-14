import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorText, get, loadDrafts, mutate, NetworkError, saveDrafts, type Draft } from '../api';
import { DICTS, LANG_CODES, LANG_NAMES, speak, type FlowKind, type Lang, type T } from '../i18n';
import { ACTION_LABEL, ErrorBanner, fmtTime, Loading, StatusBadge, Stepper, useMe } from '../ui/common';
import { IconArrived, IconBag, IconClock, IconHome, IconMic, IconReceive, IconRepeat, IconReturn, IconRoom, IconSend, IconStop, IconTake } from '../ui/icons';
import { hasSpeechRecognition, recognize, type Listener } from '../ui/speech';
import { emojiFor, Flow, loadLast, nativeName, type FlowState, type Product } from './Flow';

type Tab = 'home' | 'bag' | 'transfers' | 'history';
const START: Record<FlowKind, FlowState['step']> = { PLACE_IN_ROOM: 'room', CHECKOUT_TO_STAFF: 'items', RETURN_TO_STORE: 'items', SUPPLIER_RECEIPT: 'items', TRANSFER_DISPATCH: 'hotel' };
const ICON: Record<string, () => JSX.Element> = { PLACE_IN_ROOM: IconRoom, CHECKOUT_TO_STAFF: IconTake, RETURN_TO_STORE: IconReturn, SUPPLIER_RECEIPT: IconArrived, TRANSFER_DISPATCH: IconSend, RECEIVE: IconReceive, TRANSFER_RECEIPT: IconReceive, REVERSAL: IconReturn };

export function StaffApp() {
  const { me, logout } = useMe();
  const hotelId = me.activeHotel!;
  const hotel = me.hotels.find((h) => h.id === hotelId)!;
  const [lang, setLang] = useState<Lang>(me.language);
  const t = DICTS[lang];
  const [tab, setTab] = useState<Tab>('home');
  const [flow, setFlow] = useState<FlowState | null>(null);
  const changeLang = (l: Lang) => { setLang(l); api('PATCH', '/me', { language: l }).catch(() => {}); };
  const start = (kind: FlowKind, extra: Partial<FlowState> = {}) => setFlow({ kind, step: START[kind], lines: [], ...extra });

  const nav: [Tab, () => JSX.Element, string][] = [['home', IconHome, t.home], ['bag', IconBag, t.myStock], ['transfers', IconSend, t.transfers], ['history', IconClock, t.activity]];
  return (
    <div className="app" lang={lang}>
      <header className="topbar">
        <div className="who"><b>{hotel.name}</b><div className="small muted">{me.displayName}</div></div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <label className="sr-only" htmlFor="lang">{t.language}</label>
          <select id="lang" value={lang} onChange={(e) => changeLang(e.target.value as Lang)}>
            {(Object.keys(LANG_NAMES) as Lang[]).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
          </select>
          <button className="link" onClick={logout}>{t.signOut}</button>
        </div>
      </header>
      <main className="content">
        {flow ? <Flow key={flow.kind + flow.step + (flow.proposalId ?? '')} init={flow} hotelId={hotelId} lang={lang} t={t} onExit={() => setFlow(null)} />
          : tab === 'home' ? <Home t={t} lang={lang} hotelId={hotelId} start={start} openReceive={() => setTab('transfers')} />
          : tab === 'bag' ? <MyBag t={t} lang={lang} hotelId={hotelId} start={start} />
          : tab === 'transfers' ? <Transfers t={t} hotelId={hotelId} start={start} />
          : <History t={t} hotelId={hotelId} tz={hotel.timezone} />}
      </main>
      <nav className="bottomnav" aria-label="Main"><div>
        {nav.map(([k, Ico, label]) => (
          <button key={k} aria-current={tab === k && !flow ? 'page' : undefined} onClick={() => { setFlow(null); setTab(k); }}><Ico />{label}</button>
        ))}
      </div></nav>
    </div>
  );
}

// ---------------- Home ----------------
function Home({ t, lang, hotelId, start, openReceive }: { t: T; lang: Lang; hotelId: string; start: (k: FlowKind, extra?: Partial<FlowState>) => void; openReceive: () => void }) {
  const { me } = useMe();
  const incoming = useQuery<any[]>({ queryKey: ['transfers', hotelId], queryFn: () => get(`/transfers?hotelId=${hotelId}`) });
  const nIncoming = (incoming.data ?? []).filter((x) => x.toHotel.id === hotelId && ['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(x.status)).length;
  const last = loadLast(me.id);
  const tiles: FlowKind[] = ['CHECKOUT_TO_STAFF', 'RETURN_TO_STORE', 'SUPPLIER_RECEIPT', 'TRANSFER_DISPATCH'];
  return (
    <>
      <Drafts t={t} />
      <Voice t={t} lang={lang} hotelId={hotelId} start={start} openReceive={openReceive} />
      <p className="small muted" style={{ textAlign: 'center', margin: '4px 0 -4px' }}>{t.orTap}</p>
      <div className="tiles">
        <button className="tile primary-tile" onClick={() => start('PLACE_IN_ROOM')}>
          <span className="ic"><IconRoom /></span>
          <span><span className="t" style={{ display: 'block' }}>{t.act.PLACE_IN_ROOM[0]}</span><span className="s">{t.act.PLACE_IN_ROOM[1]}</span></span>
        </button>
        {tiles.map((k) => { const Ico = ICON[k]; return (
          <button key={k} className="tile" onClick={() => start(k)}>
            <span className="ic"><Ico /></span>
            <span><span className="t" style={{ display: 'block' }}>{t.act[k][0]}</span><span className="s">{t.act[k][1]}</span></span>
          </button>); })}
        <button className="tile" onClick={openReceive}>
          {nIncoming > 0 && <span className="count">{nIncoming}</span>}
          <span className="ic"><IconReceive /></span>
          <span><span className="t" style={{ display: 'block' }}>{t.act.RECEIVE[0]}</span><span className="s">{t.act.RECEIVE[1]}</span></span>
        </button>
      </div>
      {last && last.lines.length > 0 && (
        <button className="btn block" onClick={() => start(last.kind, { targetHotelId: last.targetHotelId, lines: last.lines.map((l) => ({ ...l })) })}>
          <IconRepeat /> {t.sameAgain}: {t.act[last.kind][0]}
        </button>
      )}
      <Recent t={t} hotelId={hotelId} />
    </>
  );
}

type RecState = 'idle' | 'asking' | 'recording' | 'uploading';
function Voice({ t, lang, hotelId, start, openReceive }: { t: T; lang: Lang; hotelId: string; start: (k: FlowKind, extra?: Partial<FlowState>) => void; openReceive: () => void }) {
  const { me } = useMe();
  const [state, setState] = useState<RecState>('idle');
  const [secs, setSecs] = useState(0);
  const [msg, setMsg] = useState<{ tone: 'warn' | 'bad'; text: string } | null>(null);
  const [query, setQuery] = useState<any>(null);
  const [fakeText, setFakeText] = useState('');
  const [heard, setHeard] = useState('');
  const [nudge, setNudge] = useState(false);
  const fails = useRef(0);
  const ear = useRef<Listener | null>(null);
  const tapInstead = () => { ear.current?.abort(); start('PLACE_IN_ROOM'); };
  const failed = (text: string) => {
    fails.current += 1; setNudge(true);
    if (fails.current >= 2) { fails.current = 0; speak(t.twiceFailed, lang); tapInstead(); return; }
    setMsg({ tone: 'warn', text }); speak(text, lang);
  };
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const started = useRef(0);
  const max = me.config.voiceMaxSeconds;
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((x) => x.stop()); ear.current?.abort(); }, []);
  if (me.config.voiceProvider === 'disabled') return null;

  const handle = (p: any) => {
    setQuery(null); setMsg(null);
    if (p.status === 'QUERY_RESULT') {
      setQuery(p);
      const said = (p.queryResult ?? []).slice(0, 4).map((r: any) => `${r.name} ${r.store}`).join(', ');
      if (said) speak(said, lang);
      return;
    }
    if (p.action === 'TRANSFER_RECEIPT' || p.action === 'SHOW_TRANSFERS') { openReceive(); return; }
    if (p.status === 'NAVIGATE') { failed(t.voiceFailed); return; }
    if (p.action === 'UNKNOWN' || !p.lines.length) { failed(t.voiceFailed); return; }
    fails.current = 0;
    const room = p.lines.find((l: any) => l.roomId);
    start(p.action as FlowKind, {
      step: 'review', proposalId: p.proposalId, transcript: p.transcript, targetHotelId: p.targetHotelId,
      roomId: room?.roomId, roomNumber: room?.roomNumber,
      lines: p.lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, roomId: l.roomId, roomNumber: l.roomNumber, source: l.source, issues: l.issues, candidates: l.candidates, spoken: l.spokenProduct })),
    });
  };
  const send = async (blob: Blob, durationMs: number, name = 'speech') => {
    setState('uploading');
    const fd = new FormData();
    fd.append('hotelId', hotelId); fd.append('preferredLanguage', LANG_CODES[lang]); fd.append('durationMs', String(durationMs));
    fd.append('audio', blob, name);
    try { handle(await api('POST', '/voice/interpret', fd)); }
    catch (e) { setMsg({ tone: 'bad', text: e instanceof ApiError && e.status >= 500 ? t.voiceFailed : errorText(e) }); }
    finally { setState('idle'); }
  };
  // No audio model configured: let the phone's own speech recognition turn speech into text.
  const useBrowserEar = me.config.voiceProvider === 'fake' && hasSpeechRecognition();
  const beginBrowser = () => {
    setHeard(''); setState('recording'); started.current = Date.now(); setSecs(0);
    timer.current = window.setInterval(() => setSecs(Math.floor((Date.now() - started.current) / 1000)), 250);
    ear.current = recognize(lang, {
      onInterim: setHeard,
      onEnd: (text, err) => {
        ear.current = null; if (timer.current) clearInterval(timer.current);
        if (err === 'not-allowed' || err === 'service-not-allowed') { setState('idle'); setNudge(true); setMsg({ tone: 'warn', text: t.micDenied }); return; }
        if (!text) { setState('idle'); if (err && err !== 'aborted') failed(t.voiceFailed); return; }
        send(new Blob([text], { type: 'text/plain' }), Date.now() - started.current, 'speech.txt');
      },
    });
    if (!ear.current) { setState('idle'); setNudge(true); setMsg({ tone: 'warn', text: t.voiceUnavailable }); }
  };
  const begin = async () => {
    setMsg(null); setQuery(null); setHeard('');
    if (useBrowserEar) return beginBrowser();
    if (me.config.voiceProvider === 'fake') { setNudge(true); setMsg({ tone: 'warn', text: t.voiceUnavailable }); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setMsg({ tone: 'warn', text: t.micDenied }); return; }
    setState('asking');
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true } }); } catch { setState('idle'); setMsg({ tone: 'warn', text: t.micDenied }); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((x) => x.stop());
      if (timer.current) clearInterval(timer.current);
      const dur = Date.now() - started.current;
      if (dur < 600) { setState('idle'); return; }
      send(new Blob(chunks, { type: (r.mimeType || 'audio/webm').split(';')[0] }), dur);
    };
    rec.current = r; started.current = Date.now(); setSecs(0);
    r.start(); setState('recording');
    timer.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - started.current) / 1000);
      setSecs(s);
      if (s >= max && r.state === 'recording') r.stop();
    }, 250);
  };
  const stop = () => { if (ear.current) { ear.current.stop(); return; } if (rec.current?.state === 'recording') rec.current.stop(); };

  return (
    <section className="mic-wrap" aria-live="polite">
      <button className={`mic${state === 'recording' ? ' rec' : ''}`} onClick={state === 'recording' ? stop : begin} disabled={state === 'uploading' || state === 'asking'}
        aria-label={state === 'recording' ? 'Stop recording' : 'Start recording'}>
        {state === 'recording' ? <IconStop /> : <IconMic />}
      </button>
      <div className="mic-label">{state === 'recording' ? `${t.listening} ${secs}s` : state === 'uploading' ? t.understanding : t.tapToSpeak}</div>
      {heard && state !== 'idle' && <div className="heard">“{heard}”</div>}
      {state === 'idle' && !msg && <div className="small faint" style={{ textAlign: 'center' }}>{t.examples[0]}</div>}
      {msg && <div className={`banner ${msg.tone}`} role="alert" style={{ width: '100%' }}>{msg.text}</div>}
      {state !== 'recording' && <button className={`btn lg block tapinstead${nudge ? ' hi' : ''}`} onClick={tapInstead}>{t.tapInstead}</button>}
      {query && (
        <div className="panel" style={{ width: '100%' }}>
          <table><thead><tr><th>{' '}</th><th className="num">Store</th><th className="num">Staff</th></tr></thead>
            <tbody>{(query.queryResult ?? []).map((r: any) => <tr key={r.productId}><td>{r.name}</td><td className="num">{r.store}</td><td className="num">{r.staffHeld}</td></tr>)}</tbody></table>
        </div>
      )}
      {me.config.voiceProvider === 'fake' && (
        <details className="small" style={{ width: '100%' }}>
          <summary className="faint">Test mode: type instead of speaking</summary>
          <div className="row" style={{ marginTop: 8, flexWrap: 'nowrap' }}>
            <input value={fakeText} onChange={(e) => setFakeText(e.target.value)} placeholder="Room 101 mein 2 soap rakhe" />
            <button className="btn" onClick={() => send(new Blob([fakeText], { type: 'text/plain' }), 0, 'fixture.txt')}>Send</button>
          </div>
        </details>
      )}
    </section>
  );
}

function Drafts({ t }: { t: T }) {
  const { me } = useMe();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Draft[]>(() => loadDrafts(me.id));
  const [msg, setMsg] = useState<string | null>(null);
  if (!drafts.length) return msg ? <div className="banner ok">{msg}</div> : null;
  const retry = async (d: Draft) => {
    try {
      await mutate(d.path, d.body, d.key);
      const rest = drafts.filter((x) => x.key !== d.key); saveDrafts(me.id, rest); setDrafts(rest); setMsg(`✓ ${t.saved}`); qc.invalidateQueries();
    } catch (e) { setMsg(e instanceof NetworkError ? t.offlineSaved : errorText(e)); }
  };
  const discard = (d: Draft) => { const rest = drafts.filter((x) => x.key !== d.key); saveDrafts(me.id, rest); setDrafts(rest); };
  return (
    <section className="banner warn stack" style={{ gap: 8 }}>
      <b>{t.notSubmitted} ({drafts.length})</b>
      {msg && <span className="small">{msg}</span>}
      {drafts.map((d) => (
        <div key={d.key} className="row spread"><span className="small">{d.label}</span>
          <span className="row"><button className="btn" onClick={() => retry(d)}>{t.retry}</button><button className="link" onClick={() => discard(d)}>{t.discard}</button></span></div>
      ))}
    </section>
  );
}

// ---------------- Recent / History ----------------
function Recent({ t, hotelId }: { t: T; hotelId: string }) {
  const q = useQuery<any>({ queryKey: ['activity', hotelId, 5], queryFn: () => get(`/transactions?hotelId=${hotelId}&limit=5`) });
  const items = q.data?.items ?? [];
  return (
    <section className="panel">
      <h2 style={{ marginBottom: 4 }}>{t.recent}</h2>
      {q.isLoading ? <Loading /> : !items.length ? <p className="muted small">{t.noRecent}</p> : <EventList items={items} t={t} />}
    </section>
  );
}

function EventList({ items, t, tz, onCorrect }: { items: any[]; t: T; tz?: string; onCorrect?: (id: string) => void }) {
  return (
    <div className="recent">
      {items.map((e) => { const Ico = ICON[e.action] ?? IconClock; const label = (t.act[e.action]?.[0]) ?? ACTION_LABEL[e.action] ?? e.action; return (
        <div key={e.eventId} className="item">
          <span className="dot"><Ico /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{label}{e.reversedBy && <span className="badge neutral" style={{ marginLeft: 6 }}>undone</span>}</div>
            <div className="small muted">{e.lines.map((l: any) => `${l.quantity} ${l.name}${l.roomNumber ? ` · ${t.room} ${l.roomNumber}` : ''}`).join(', ')}</div>
            {onCorrect && !e.reversedBy && <button className="link small" style={{ padding: 0, minHeight: 28 }} onClick={() => onCorrect(e.eventId)}>Report a mistake</button>}
          </div>
          <span className="small faint" style={{ textAlign: 'right' }}>{fmtTime(e.createdAt, tz)}</span>
        </div>); })}
    </div>
  );
}

function History({ t, hotelId, tz }: { t: T; hotelId: string; tz?: string }) {
  const q = useQuery<any>({ queryKey: ['activity', hotelId, 30], queryFn: () => get(`/transactions?hotelId=${hotelId}&limit=30`) });
  const [corr, setCorr] = useState<string | null>(null), [note, setNote] = useState(''), [sent, setSent] = useState(false);
  const send = async () => { await api('POST', `/transactions/${corr}/correction-requests`, { note }); setSent(true); setCorr(null); setNote(''); };
  return (
    <>
      <h1>{t.activity}</h1>
      {sent && <div className="banner ok">Your manager will check it.</div>}
      {corr && (
        <div className="panel stack">
          <label className="field">What is wrong?<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. it was room 204, not 203" /></label>
          <div className="row"><button className="btn primary" disabled={note.trim().length < 3} onClick={send}>Send to manager</button><button className="link" onClick={() => setCorr(null)}>{t.cancel}</button></div>
        </div>
      )}
      <section className="panel">{q.isLoading ? <Loading /> : !(q.data?.items ?? []).length ? <p className="muted">{t.noRecent}</p> : <EventList items={q.data.items} t={t} tz={tz} onCorrect={(id) => { setCorr(id); setSent(false); }} />}</section>
    </>
  );
}

// ---------------- My bag ----------------
function MyBag({ t, lang, hotelId, start }: { t: T; lang: Lang; hotelId: string; start: (k: FlowKind, extra?: Partial<FlowState>) => void }) {
  const q = useQuery<any>({ queryKey: ['mystock', hotelId], queryFn: () => get(`/me/stock?hotelId=${hotelId}`) });
  const products = useQuery<Product[]>({ queryKey: ['products'], queryFn: () => get('/products') });
  if (q.isLoading) return <Loading />;
  const items = q.data?.items ?? [];
  const p = (id: string) => products.data?.find((x) => x.id === id);
  return (
    <>
      <h1>{t.myStock}</h1>
      <ErrorBanner error={q.error} />
      {!items.length ? (
        <div className="panel empty-state"><b>{t.nothingCarried}</b>{t.nothingCarriedHint}
          <div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => start('CHECKOUT_TO_STAFF')}><IconTake /> {t.act.CHECKOUT_TO_STAFF[0]}</button></div>
        </div>
      ) : (
        <>
          <div className="ptiles">
            {items.map((i: any) => (
              <div key={i.productId} className="ptile" style={{ minHeight: 112 }}>
                <span className="emoji" aria-hidden="true">{emojiFor(p(i.productId) ?? { sku: '', icon: i.icon })}</span>
                <span className="name">{i.name}</span>
                {nativeName(p(i.productId), lang) && <span className="native" lang={lang}>{nativeName(p(i.productId), lang)}</span>}
                <span className="qtybadge">{i.quantity}</span>
              </div>
            ))}
          </div>
          <div className="stack">
            <button className="btn primary lg block" onClick={() => start('PLACE_IN_ROOM')}><IconRoom /> {t.act.PLACE_IN_ROOM[0]}</button>
            <button className="btn lg block" onClick={() => start('RETURN_TO_STORE', { step: 'review', lines: items.map((i: any) => ({ productId: i.productId, quantity: i.quantity })) })}><IconReturn /> {t.act.RETURN_TO_STORE[0]}</button>
          </div>
        </>
      )}
    </>
  );
}

// ---------------- Transfers ----------------
function Transfers({ t, hotelId, start }: { t: T; hotelId: string; start: (k: FlowKind) => void }) {
  const { me } = useMe();
  const q = useQuery<any[]>({ queryKey: ['transfers', hotelId], queryFn: () => get(`/transfers?hotelId=${hotelId}`) });
  const incoming = (q.data ?? []).filter((x) => x.toHotel.id === hotelId && ['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(x.status));
  const outgoing = (q.data ?? []).filter((x) => x.fromHotel.id === hotelId).slice(-8).reverse();
  return (
    <>
      <h1>{t.transfers}</h1>
      <h2>{t.incoming}</h2>
      {q.isLoading ? <Loading /> : !incoming.length ? <div className="panel empty-state">{t.nothingIncoming}</div> : incoming.map((tr) => <Receive key={tr.id} tr={tr} t={t} isSender={tr.dispatchedBy.id === me.id} />)}
      <button className="btn lg block" onClick={() => start('TRANSFER_DISPATCH')}><IconSend /> {t.act.TRANSFER_DISPATCH[0]}</button>
      {outgoing.length > 0 && <>
        <h2>{t.sent}</h2>
        <section className="panel"><div className="recent">
          {outgoing.map((tr) => (
            <div key={tr.id} className="item">
              <span className="dot"><IconSend /></span>
              <div><div style={{ fontWeight: 600 }}>→ {tr.toHotel.name}</div><div className="small muted">{tr.lines.map((l: any) => `${l.sent} ${l.name}`).join(', ')}</div></div>
              <StatusBadge s={tr.status} />
            </div>))}
        </div></section>
      </>}
    </>
  );
}

function Receive({ tr, t, isSender }: { tr: any; t: T; isSender: boolean }) {
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
      setOk(r.outstandingUnits ? `${r.outstandingUnits} still on the way${final ? ' — your manager has been told' : ''}.` : t.saved);
      setKey(crypto.randomUUID()); qc.invalidateQueries();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <div className="panel stack">
      <div className="row spread"><b>From {tr.fromHotel.name}</b><StatusBadge s={tr.status} /></div>
      <div className="small muted">{tr.refCode} · sent {fmtTime(tr.dispatchedAt)} by {tr.dispatchedBy.name}</div>
      {tr.lines.filter((l: any) => remaining(l) > 0).map((l: any) => (
        <div key={l.productId} className="row spread" style={{ flexWrap: 'nowrap' }}>
          <span><b>{l.name}</b><div className="small muted">{remaining(l)} sent</div></span>
          <Stepper label={`Received ${l.name}`} value={qty[l.productId]} onChange={(n) => setQty({ ...qty, [l.productId]: Math.min(n, remaining(l)) })} />
        </div>
      ))}
      {short > 0 && <div className="banner warn small">{short} fewer than sent. They stay “on the way” until they arrive or a manager closes it.</div>}
      {ok && <div className="banner ok">✓ {ok}</div>}
      <ErrorBanner error={error} />
      {isSender ? <p className="small muted">You sent this, so someone else at this hotel must confirm it.</p> : (
        <div className="stack">
          <button className="btn go lg block" disabled={busy} onClick={() => submit(false)}>{t.confirmReceived}</button>
          {short > 0 && <button className="btn block" disabled={busy} onClick={() => submit(true)}>{t.allCame}</button>}
        </div>
      )}
    </div>
  );
}
