import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorText, get, loadDrafts, mutate, newKey, NetworkError, saveDrafts } from '../api';
import { speak, type FlowKind, type Lang, type T } from '../i18n';
import { Modal, Stepper, useMe } from '../ui/common';
import { IconBack, IconCheck, IconMic, IconSpeaker } from '../ui/icons';
import { useHold } from '../ui/hold';
import { chime, hasSpeechRecognition, recognize, yesNo, type Listener } from '../ui/speech';

export interface Product { id: string; sku: string; name: string; unit: string; icon: string | null; active: boolean; aliases: { locale: string; alias: string }[] }
export interface Room { id: string; roomNumber: string; active: boolean }
export interface Line {
  productId: string | null; quantity: number | null;
  roomId?: string | null; roomNumber?: string | null;
  source?: 'STORE' | 'MY_STOCK' | null;
  issues?: string[]; candidates?: { productId: string; name: string }[]; spoken?: string;
}
export interface FlowState {
  kind: FlowKind;
  step: 'hotel' | 'room' | 'items' | 'review' | 'done';
  roomId?: string | null; roomNumber?: string | null;
  targetHotelId?: string | null;
  lines: Line[];
  proposalId?: string; transcript?: string;
  ref?: string;
}

const EMOJI: Record<string, string> = { SOAP: '🧼', SHAMPOO: '🧴', COMB: '🪮', DENTAL_KIT: '🦷', TOOTHBRUSH: '🪥', TOOTHPASTE: '🦷' };
export const emojiFor = (p?: { sku: string; icon?: string | null } | null) => (p && (p.icon || EMOJI[p.sku])) || '📦';
/** Name in the staff member's own script, from the product's spoken aliases. */
export function nativeName(p: Product | undefined, lang: Lang) {
  if (!p || lang === 'en') return null;
  const re = lang === 'gu' ? /[઀-૿]/ : /[ऀ-ॿ]/;
  return p.aliases.find((a) => re.test(a.alias))?.alias ?? null;
}

const recentRoomsKey = (u: string) => `sw_rooms_${u}`;
const lastKey = (u: string) => `sw_last_${u}`;
function readJSON<X>(k: string, d: X): X { try { return JSON.parse(localStorage.getItem(k) ?? '') ?? d; } catch { return d; } }
function writeJSON(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
export const loadLast = (u: string) => readJSON<{ kind: FlowKind; lines: { productId: string; quantity: number }[]; targetHotelId?: string | null } | null>(lastKey(u), null);

export function useFlowData(hotelId: string) {
  const products = useQuery<Product[]>({ queryKey: ['products'], queryFn: () => get('/products') });
  const rooms = useQuery<Room[]>({ queryKey: ['rooms', hotelId], queryFn: () => get(`/hotels/${hotelId}/rooms`) });
  const stock = useQuery<any>({ queryKey: ['stock', hotelId], queryFn: () => get(`/hotels/${hotelId}/stock`) });
  const bag = useQuery<any>({ queryKey: ['mystock', hotelId], queryFn: () => get(`/me/stock?hotelId=${hotelId}`) });
  const dests = useQuery<{ id: string; name: string; code: string }[]>({ queryKey: ['destinations'], queryFn: () => get('/hotels/destinations') });
  return {
    products: (products.data ?? []).filter((p) => p.active),
    rooms: (rooms.data ?? []).filter((r) => r.active),
    storeQty: (pid: string | null) => stock.data?.items.find((i: any) => i.productId === pid)?.store ?? 0,
    bagQty: (pid: string | null) => bag.data?.items.find((i: any) => i.productId === pid)?.quantity ?? 0,
    dests: dests.data ?? [],
    loading: products.isLoading || rooms.isLoading,
  };
}

function Head({ title, onBack, step, total }: { title: string; onBack: () => void; step: number; total: number }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="flowhead">
        <button className="back" onClick={onBack} aria-label="Back"><IconBack /></button>
        <div className="steps" style={{ flex: 1 }} aria-label={`Step ${step} of ${total}`}>
          {Array.from({ length: total }, (_, i) => <span key={i} className={i + 1 < step ? 'past' : i + 1 === step ? 'on' : ''} />)}
        </div>
      </div>
      <h1 className="question">{title}</h1>
    </div>
  );
}

// ---------- Room keypad ----------
export function RoomPad({ rooms, value, onChange, t, userId }: { rooms: Room[]; value: string; onChange: (v: string) => void; t: T; userId: string }) {
  const recent = readJSON<string[]>(recentRoomsKey(userId), []).filter((r) => rooms.some((x) => x.roomNumber === r)).slice(0, 4);
  const matches = value ? rooms.filter((r) => r.roomNumber.startsWith(value)).slice(0, 8) : [];
  const exact = rooms.find((r) => r.roomNumber === value);
  const press = (k: string) => onChange(k === '⌫' ? value.slice(0, -1) : k === 'C' ? '' : (value + k).slice(0, 6));
  return (
    <div className="stack">
      <div className={`roomdisplay${value ? '' : ' empty'}`} aria-live="polite">{value || t.typeRoom}</div>
      {value && !exact && !matches.length && <div className="banner warn small">{t.room} {value}: ?</div>}
      {!!(value ? matches : recent).length && (
        <div className="stack" style={{ gap: 6 }}>
          {!value && <span className="small muted">{t.recentRooms}</span>}
          <div className="chips">
            {(value ? matches.map((m) => m.roomNumber) : recent).map((r) => (
              <button key={r} className="chip" aria-pressed={r === value} onClick={() => onChange(r)}>{r}</button>
            ))}
          </div>
        </div>
      )}
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
          <button key={k} onClick={() => press(k)} aria-label={k === '⌫' ? 'Delete' : k === 'C' ? 'Clear' : k}>{k}</button>
        ))}
      </div>
    </div>
  );
}

// ---------- Product tiles ----------
function ProductTiles({ kind, lang, t, cart, setCart, data, single }: {
  kind: FlowKind; lang: Lang; t: T; cart: Record<string, number>; setCart: (c: Record<string, number>) => void; data: ReturnType<typeof useFlowData>; single?: (id: string) => void;
}) {
  const haveText = (p: Product) => {
    if (kind === 'SUPPLIER_RECEIPT') return null;
    if (kind === 'RETURN_TO_STORE') return { n: data.bagQty(p.id), txt: t.youHave(data.bagQty(p.id)) };
    if (kind === 'PLACE_IN_ROOM') { const b = data.bagQty(p.id); return b ? { n: b, txt: t.youHave(b) } : { n: data.storeQty(p.id), txt: t.inStore(data.storeQty(p.id)) }; }
    return { n: data.storeQty(p.id), txt: t.inStore(data.storeQty(p.id)) };
  };
  return (
    <div className="ptiles">
      {data.products.map((p) => {
        const q = cart[p.id] ?? 0;
        const have = haveText(p);
        return (
          <div key={p.id} style={{ position: 'relative' }}>
            <button className={`ptile${q ? ' picked' : ''}`} style={{ width: '100%' }}
              onClick={() => (single ? single(p.id) : setCart({ ...cart, [p.id]: q + 1 }))}
              aria-label={`${p.name}${q ? `, ${q} added` : ''}`}>
              <span className="emoji" aria-hidden="true">{emojiFor(p)}</span>
              <span className="name">{p.name}</span>
              {nativeName(p, lang) && <span className="native" lang={lang}>{nativeName(p, lang)}</span>}
              {have && <span className={`have${have.n ? '' : ' none'}`}>{have.txt}</span>}
              {q > 0 && <span className="qtybadge">{q}</span>}
            </button>
            {q > 0 && !single && (
              <button className="minus" aria-label={`One less ${p.name}`} onClick={() => { const c = { ...cart }; q <= 1 ? delete c[p.id] : (c[p.id] = q - 1); setCart(c); }}>−</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- The flow ----------
export function Flow({ init, hotelId, lang, t, onExit }: { init: FlowState; hotelId: string; lang: Lang; t: T; onExit: () => void }) {
  const { me } = useMe();
  const qc = useQueryClient();
  const data = useFlowData(hotelId);
  const hotel = me.hotels.find((h) => h.id === hotelId)!;
  const [s, setS] = useState<FlowState>(init);
  const [cart, setCart] = useState<Record<string, number>>(() => Object.fromEntries(init.lines.filter((l) => l.productId).map((l) => [l.productId!, l.quantity ?? 1])));
  const [roomInput, setRoomInput] = useState(init.roomNumber ?? '');
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [picker, setPicker] = useState<number | null>(null);
  const [roomFor, setRoomFor] = useState<number | null>(null);
  const [roomEdit, setRoomEdit] = useState('');

  const steps: FlowState['step'][] = s.kind === 'PLACE_IN_ROOM' ? ['room', 'items', 'review'] : s.kind === 'TRANSFER_DISPATCH' ? ['hotel', 'items', 'review'] : ['items', 'review'];
  const stepNo = steps.indexOf(s.step) + 1;
  const prod = (id: string | null) => data.products.find((p) => p.id === id);
  const go = (step: FlowState['step']) => { setError(null); setS((x) => ({ ...x, step })); };
  const back = () => { const i = steps.indexOf(s.step); if (i <= 0 || init.step === 'review') onExit(); else go(steps[i - 1]); };

  const defaultSource = (pid: string, qty: number): Line['source'] =>
    data.bagQty(pid) >= qty ? 'MY_STOCK' : hotel.allowStoreToRoom && data.storeQty(pid) >= qty ? 'STORE' : null;

  const toReview = () => {
    const lines: Line[] = Object.entries(cart).map(([pid, q]) => ({
      productId: pid, quantity: q, roomId: s.roomId, roomNumber: s.roomNumber,
      source: s.kind === 'PLACE_IN_ROOM' ? defaultSource(pid, q) : undefined,
    }));
    setS((x) => ({ ...x, lines, step: 'review' }));
  };
  const setLine = (i: number, patch: Partial<Line>) => setS((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch, issues: (l.issues ?? []).filter((iss) => !clears(iss, patch)) } : l)) }));

  const srcOf = (l: Line): 'STORE' | 'MY_STOCK' | null =>
    s.kind === 'PLACE_IN_ROOM' ? l.source ?? null : s.kind === 'RETURN_TO_STORE' ? 'MY_STOCK' : s.kind === 'SUPPLIER_RECEIPT' ? null : 'STORE';
  const shortages = useMemo(() => {
    const need = new Map<string, number>();
    for (const l of s.lines) { const src = srcOf(l); if (src && l.productId && l.quantity) need.set(`${src}|${l.productId}`, (need.get(`${src}|${l.productId}`) ?? 0) + l.quantity); }
    const out = new Map<string, number>();
    for (const [k, q] of need) { const [src, p] = k.split('|'); const a = src === 'STORE' ? data.storeQty(p) : data.bagQty(p); if (q > a) out.set(k, a); }
    return out;
  }, [s.lines, s.kind, data]);

  const total = s.lines.reduce((n, l) => n + (l.quantity ?? 0), 0);
  const destName = data.dests.find((d) => d.id === s.targetHotelId)?.name;
  const rooms = [...new Set(s.lines.filter((l) => l.roomId).map((l) => l.roomNumber).filter(Boolean))];
  const sentence = t.summary(s.kind, total, rooms.length > 1 ? rooms.join(', ') : rooms[0] ?? undefined, destName);
  const blocked = !s.lines.length || s.lines.some((l) => !l.productId || !l.quantity || (s.kind === 'PLACE_IN_ROOM' && (!l.roomId || !l.source)))
    || (s.kind === 'TRANSFER_DISPATCH' && (!s.targetHotelId || s.targetHotelId === hotelId)) || shortages.size > 0;

  const listen = () => speak(`${sentence}. ${s.lines.map((l) => `${l.quantity} ${nativeName(prod(l.productId), lang) ?? prod(l.productId)?.name ?? ''}`).join(', ')}`, lang);

  const confirm = async () => {
    setBusy(true); setError(null);
    const path = s.kind === 'TRANSFER_DISPATCH' ? '/transfers' : '/transactions';
    const body = s.kind === 'TRANSFER_DISPATCH'
      ? { fromHotelId: hotelId, toHotelId: s.targetHotelId, lines: s.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })), proposalId: s.proposalId }
      : { action: s.kind, hotelId, proposalId: s.proposalId,
          lines: s.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, ...(s.kind === 'PLACE_IN_ROOM' ? { roomId: l.roomId, source: l.source } : {}) })) };
    try {
      const r = await mutate(path, body, key);
      writeJSON(lastKey(me.id), { kind: s.kind, targetHotelId: s.targetHotelId, lines: s.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) });
      if (s.kind === 'PLACE_IN_ROOM') {
        const prev = readJSON<string[]>(recentRoomsKey(me.id), []);
        writeJSON(recentRoomsKey(me.id), [...rooms as string[], ...prev.filter((x) => !rooms.includes(x))].slice(0, 6));
      }
      setS((x) => ({ ...x, step: 'done', ref: r.refCode ?? r.eventId.slice(0, 6).toUpperCase() }));
      qc.invalidateQueries();
    } catch (e) {
      if (e instanceof NetworkError) {
        const drafts = loadDrafts(me.id).filter((d) => d.key !== key);
        drafts.push({ key, path, body, label: sentence, createdAt: new Date().toISOString() });
        saveDrafts(me.id, drafts);
      }
      if (e instanceof ApiError && e.status === 409) { qc.invalidateQueries({ queryKey: ['stock'] }); qc.invalidateQueries({ queryKey: ['mystock'] }); }
      setError(e);
    } finally { setBusy(false); }
  };

  // Voice-first: read the check screen aloud once. Staff then hold the mic and say yes / no (or tap).
  const fromVoice = !!s.proposalId;
  const asked = useRef(false);
  const ear = useRef<Listener | null>(null);
  const [hearing, setHearing] = useState(false);
  const confirmRef = useRef(confirm); confirmRef.current = confirm;
  useEffect(() => {
    if (s.step !== 'review' || !fromVoice || blocked || asked.current || data.loading) return;
    asked.current = true; listen();
  }, [s.step, fromVoice, blocked, data.loading]);
  useEffect(() => () => ear.current?.abort(), []);
  const stopHearing = () => { ear.current?.abort(); ear.current = null; setHearing(false); };
  const yn = useRef<'send' | 'cancel'>('send');
  const holdYes = useHold({
    onStart: () => {
      try { speechSynthesis.cancel(); } catch { /* none */ }
      yn.current = 'send'; setHearing(true);
      ear.current = recognize(lang, { continuous: true, onEnd: (text) => {
        setHearing(false); ear.current = null;
        if (yn.current === 'cancel') return;
        const a = yesNo(text);
        if (a === 'yes') confirmRef.current(); else if (a === 'no') onExit();
      } });
      if (!ear.current) setHearing(false);
    },
    onSend: () => { yn.current = 'send'; ear.current?.stop(); },
    onCancel: () => { yn.current = 'cancel'; stopHearing(); },
  });

  // Done: chime, and after a voice entry go back to the mic on its own.
  useEffect(() => {
    if (s.step !== 'done') return;
    chime();
    if (!fromVoice) return;
    const id = setTimeout(onExit, 3500);
    return () => clearTimeout(id);
  }, [s.step]);

  if (data.loading) return <div className="muted">…</div>;

  // ----- Done -----
  if (s.step === 'done') return (
    <div className="done" role="status">
      <div className="tick"><IconCheck /></div>
      <h1>{t.saved}</h1>
      <p className="summary-sentence">{sentence}</p>
      <p className="small muted">{t.reference} <span className="ref">{s.ref}</span></p>
      {fromVoice && <><div className="homebar" aria-hidden="true"><i /></div><p className="small muted">{t.backHome}</p></>}
      <div className="stack" style={{ width: '100%', marginTop: 8 }}>
        <button className="btn primary lg block" onClick={() => { setCart({}); setRoomInput(''); setS({ kind: s.kind, step: steps[0], lines: [] }); }}>{t.doAnother}</button>
        <button className="btn lg block" onClick={onExit}>{t.goHome}</button>
      </div>
    </div>
  );

  // ----- Hotel -----
  if (s.step === 'hotel') return (
    <div className="stack">
      <Head title={t.whichHotel} onBack={back} step={stepNo} total={steps.length} />
      <div className="tiles">
        {data.dests.filter((d) => d.id !== hotelId).map((d) => (
          <button key={d.id} className="tile" onClick={() => setS((x) => ({ ...x, targetHotelId: d.id, step: 'items' }))}>
            <span className="ic" style={{ fontWeight: 700 }}>{d.code}</span>
            <span className="t">{d.name}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // ----- Room -----
  if (s.step === 'room') {
    const exact = data.rooms.find((r) => r.roomNumber === roomInput);
    return (
      <div className="stack">
        <Head title={t.whichRoom} onBack={back} step={stepNo} total={steps.length} />
        <RoomPad rooms={data.rooms} value={roomInput} onChange={setRoomInput} t={t} userId={me.id} />
        <div className="actionbar"><div>
          <button className="btn primary lg block" disabled={!exact} onClick={() => setS((x) => ({ ...x, roomId: exact!.id, roomNumber: exact!.roomNumber, step: 'items' }))}>
            {exact ? `${t.next}: ${t.room} ${exact.roomNumber}` : t.next}
          </button>
        </div></div>
      </div>
    );
  }

  // ----- Items -----
  if (s.step === 'items') {
    const count = Object.values(cart).reduce((a, b) => a + b, 0);
    return (
      <div className="stack">
        <Head title={t.q[s.kind]} onBack={back} step={stepNo} total={steps.length} />
        {s.kind === 'PLACE_IN_ROOM' && <div className="chips"><span className="chip" aria-pressed="true">{t.room} {s.roomNumber}</span></div>}
        {s.kind === 'TRANSFER_DISPATCH' && <div className="chips"><span className="chip" aria-pressed="true">→ {destName}</span></div>}
        <p className="small muted">{t.tapItems}</p>
        <ProductTiles kind={s.kind} lang={lang} t={t} cart={cart} setCart={setCart} data={data} />
        <div className="actionbar"><div>
          <button className="btn primary lg block" disabled={!count} onClick={toReview}>{t.next}{count ? ` · ${count}` : ''}</button>
        </div></div>
      </div>
    );
  }

  // ----- Review -----
  return (
    <div className="stack">
      <Head title={t.review} onBack={() => { stopHearing(); back(); }} step={stepNo} total={steps.length} />
      {s.kind === 'PLACE_IN_ROOM' && rooms.length === 1 && <div className="bigroom" aria-label={`${t.room} ${rooms[0]}`}><span aria-hidden="true">🚪</span><b>{rooms[0]}</b></div>}
      <div className="panel stack" style={{ gap: 8 }}>
        <div className="row spread" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <p className="summary-sentence">{sentence}</p>
          <button className="btn quiet" onClick={listen} aria-label={t.listen}><IconSpeaker /></button>
        </div>
        {s.transcript && <p className="small muted">{t.heard}: “{s.transcript}”</p>}
        {s.kind === 'TRANSFER_DISPATCH' && !s.targetHotelId && (
          <div className="chips">{data.dests.filter((d) => d.id !== hotelId).map((d) => <button key={d.id} className="chip" onClick={() => setS((x) => ({ ...x, targetHotelId: d.id }))}>{d.name}</button>)}</div>
        )}
      </div>
      {s.lines.map((l, i) => {
        const p = prod(l.productId);
        const src = srcOf(l);
        const short = src && l.productId ? shortages.get(`${src}|${l.productId}`) : undefined;
        const flagged = (l.issues ?? []).length > 0 || short !== undefined || (s.kind === 'PLACE_IN_ROOM' && (!l.source || !l.roomId)) || !l.productId;
        return (
          <div key={i} className={`rline${flagged ? ' flag' : ''}`}>
            <span className="emoji" aria-hidden="true">{emojiFor(p)}</span>
            <div style={{ minWidth: 0 }}>
              {p ? <div className="what">{p.name}{nativeName(p, lang) && <span className="native muted" lang={lang} style={{ fontWeight: 500 }}> · {nativeName(p, lang)}</span>}</div>
                : <button className="btn" onClick={() => setPicker(i)}>{t.chooseItem}{l.spoken ? ` (“${l.spoken}”)` : ''}</button>}
              {s.kind === 'PLACE_IN_ROOM' && (
                <button className="link" style={{ padding: 0, minHeight: 32 }} onClick={() => { setRoomFor(i); setRoomEdit(l.roomNumber ?? ''); }}>
                  {l.roomId ? `${t.room} ${l.roomNumber}` : `${t.whichRoom}`}
                </button>
              )}
            </div>
            <Stepper label={p?.name ?? 'Quantity'} value={l.quantity} min={1} onChange={(n) => setLine(i, { quantity: n })} />
            {s.kind === 'PLACE_IN_ROOM' && l.productId && (
              <div className="seg" role="group" aria-label={t.chooseFrom} style={{ gridColumn: '1 / -1' }}>
                <button aria-pressed={l.source === 'MY_STOCK'} onClick={() => setLine(i, { source: 'MY_STOCK' })}>{t.fromBag} ({data.bagQty(l.productId)})</button>
                {hotel.allowStoreToRoom && <button aria-pressed={l.source === 'STORE'} onClick={() => setLine(i, { source: 'STORE' })}>{t.fromStore} ({data.storeQty(l.productId)})</button>}
              </div>
            )}
            {short !== undefined && <span className="issue" style={{ color: 'var(--brick)' }}>{t.notEnough(short)}</span>}
            {s.kind === 'PLACE_IN_ROOM' && l.productId && !l.source && short === undefined && <span className="issue">{t.chooseFrom}</span>}
            {(l.issues ?? []).includes('CHECK_QUANTITY') && <span className="issue">{t.pleaseCheck}</span>}
            {(l.issues ?? []).includes('UNKNOWN_ROOM') && <span className="issue">{t.roomNotFound(l.roomNumber ?? '?')}</span>}
            {s.lines.length > 1 && <button className="link" style={{ gridColumn: '1 / -1', justifySelf: 'start', padding: 0, minHeight: 28 }} onClick={() => setS((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))}>{t.remove}</button>}
          </div>
        );
      })}
      {error ? <div className="banner bad" role="alert">{error instanceof NetworkError ? t.offlineSaved : errorText(error)}</div> : null}
      <div style={{ height: 8 }} />
      <div className="actionbar"><div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        {fromVoice && !blocked && hasSpeechRecognition() && <p className={`small ${hearing ? '' : 'muted'}`} style={{ textAlign: 'center', margin: '0 0 6px' }}>{hearing ? <><span className="recdot" /> {t.hearingYesNo}</> : t.holdYesNo}</p>}
        <div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
          {fromVoice && !blocked && hasSpeechRecognition() && <button type="button" {...holdYes.handlers} className={`holdmic${hearing ? ' rec' : ''}`} aria-label={t.holdYesNo}><IconMic /></button>}
          {fromVoice && <button className="btn lg" style={{ flex: '0 0 22%' }} aria-label={t.cancel} onClick={() => { stopHearing(); onExit(); }}>✕</button>}
          <button className="btn go lg block" disabled={busy || blocked} onClick={() => { stopHearing(); confirm(); }}><IconCheck /> {busy ? '…' : t.confirm}</button>
        </div>
        </div>
      </div></div>

      {picker !== null && (
        <Modal title={t.chooseItem} onClose={() => setPicker(null)}>
          <ProductTiles kind={s.kind} lang={lang} t={t} cart={{}} setCart={() => {}} data={data}
            single={(id) => { setLine(picker, { productId: id, candidates: undefined, source: s.kind === 'PLACE_IN_ROOM' ? defaultSource(id, s.lines[picker].quantity ?? 1) : undefined }); setPicker(null); }} />
        </Modal>
      )}
      {roomFor !== null && (
        <Modal title={t.whichRoom} onClose={() => setRoomFor(null)}>
          <RoomPad rooms={data.rooms} value={roomEdit} onChange={setRoomEdit} t={t} userId={me.id} />
          <button className="btn primary lg block" disabled={!data.rooms.find((r) => r.roomNumber === roomEdit)}
            onClick={() => { const r = data.rooms.find((x) => x.roomNumber === roomEdit)!; setLine(roomFor, { roomId: r.id, roomNumber: r.roomNumber }); setRoomFor(null); }}>{t.confirm}</button>
        </Modal>
      )}
    </div>
  );
}

function clears(issue: string, patch: Partial<Line>) {
  if ('productId' in patch) return issue === 'UNKNOWN_PRODUCT' || issue === 'AMBIGUOUS_PRODUCT';
  if ('quantity' in patch) return issue === 'MISSING_QUANTITY' || issue === 'CHECK_QUANTITY';
  if ('roomId' in patch) return issue === 'MISSING_ROOM' || issue === 'UNKNOWN_ROOM';
  if ('source' in patch) return issue === 'CHOOSE_SOURCE';
  return false;
}
