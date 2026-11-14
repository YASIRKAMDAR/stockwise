import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, get, mutate } from '../api';
import { downloadUrl, ErrorBanner, fmtTime, Loading, Modal, ProductIcon, StatusBadge, useMe } from '../ui/common';
import { speak, type Lang } from '../i18n';
import { hasSpeechRecognition, listenContinuously, parseCountSpeech, type Listener } from '../ui/speech';
import { Composer } from '../ui/Composer';

const REASONS: [string, string][] = [['COUNTING_ERROR', 'Earlier counting error'], ['DAMAGED', 'Damaged'], ['UNRECORDED_ISSUE', 'Taken but not recorded'], ['RECEIPT_OVERSIGHT', 'Delivery not recorded'], ['EXPIRED', 'Expired'], ['OTHER', 'Other']];

export function WeeklyCount({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  const status = useQuery<any[]>({ queryKey: ['count-status', hotelId], queryFn: () => get(`/counts/status?hotelId=${hotelId}`) });
  const st = status.data?.[0];
  const transfers = useQuery<any[]>({ queryKey: ['transfers', hotelId, 'OPEN'], queryFn: () => get(`/transfers?hotelId=${hotelId}&status=OPEN`) });
  const [countId, setCountId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setCountId(st?.draftCountId ?? null); }, [st?.draftCountId]);
  const start = async () => { setError(null); try { const c = await api('POST', '/counts', { hotelId }); setCountId(c.id); qc.invalidateQueries({ queryKey: ['count-status'] }); } catch (e) { setError(e); } };

  if (status.isLoading) return <Loading />;
  return (
    <>
      <div className="row spread"><h1>Weekly verification — {st?.hotelName}</h1>{st && <StatusBadge s={countId ? 'DRAFT' : st.state} />}</div>
      {!countId ? (
        <div className="card stack">
          <div className="grid">
            <div className="kpi"><span className="l">Last verified</span><span>{st?.lastSubmittedAt ? fmtTime(st.lastSubmittedAt) : 'Never'}</span></div>
            <div className="kpi"><span className="l">Unresolved transfers</span><span>{(transfers.data ?? []).length}</span></div>
          </div>
          <p className="small muted">Counts the storeroom only. Stock with staff and in transit is shown separately and is not counted. Quantities are snapshotted when you start; if stock moves while you count, you'll be asked to recount those items.</p>
          <ErrorBanner error={error} />
          <button className="btn primary lg" onClick={start}>Start physical count</button>
        </div>
      ) : <CountEntry id={countId} onDone={() => { setCountId(null); qc.invalidateQueries(); }} />}
    </>
  );
}

function CountEntry({ id, onDone }: { id: string; onDone: () => void }) {
  const q = useQuery<any>({ queryKey: ['count', id], queryFn: () => get(`/counts/${id}`), refetchInterval: 20000 });
  const [local, setLocal] = useState<Record<string, { physicalQty: number | null; reason: string | null }>>({});
  const [saving, setSaving] = useState(false), [error, setError] = useState<unknown>(null), [confirm, setConfirm] = useState(false), [done, setDone] = useState<any>(null);
  const keyRef = useRef(crypto.randomUUID());
  const localRef = useRef(local); localRef.current = local;
  const [heardAt, setHeardAt] = useState<Record<string, number>>({});
  const products = useQuery<any[]>({ queryKey: ['products'], queryFn: () => get('/products') });
  const qc = useQueryClient();
  useEffect(() => {
    if (!q.data) return;
    setLocal((cur) => {
      const next = { ...cur };
      for (const l of q.data.lines) if (!(l.productId in next) || next[l.productId].physicalQty === null) next[l.productId] = { physicalQty: l.physicalQty, reason: l.reason };
      return next;
    });
  }, [q.data]);
  if (q.isLoading || !q.data) return <Loading />;
  const c = q.data;
  const lines = c.lines.map((l: any) => ({ ...l, ...local[l.productId] }));
  const varianceOf = (l: any) => (l.physicalQty == null ? null : l.physicalQty - l.expectedQty);
  const uncounted = lines.filter((l: any) => l.physicalQty == null).length;
  const needReason = lines.filter((l: any) => varianceOf(l) && !l.reason).length;

  const save = async (productId: string, patch: Partial<{ physicalQty: number | null; reason: string | null }>) => {
    const merged = { ...local[productId], ...patch };
    setLocal({ ...local, [productId]: merged });
    setSaving(true);
    try { await api('PATCH', `/counts/${id}/lines`, { lines: [{ productId, physicalQty: merged.physicalQty, reason: merged.reason }] }); } catch (e) { setError(e); } finally { setSaving(false); }
  };
  // Voice fills in the counted number; it never signs off. Each heard item is saved as a draft line.
  const fromVoice = async (items: { productId: string; qty: number }[]) => {
    const stamp = Date.now();
    setLocal((cur) => { const next = { ...cur }; for (const it of items) next[it.productId] = { ...next[it.productId], physicalQty: it.qty }; return next; });
    setHeardAt((h) => { const n = { ...h }; for (const it of items) n[it.productId] = stamp; return n; });
    setSaving(true);
    try { await api('PATCH', `/counts/${id}/lines`, { lines: items.map((it) => ({ productId: it.productId, physicalQty: it.qty, reason: localRef.current[it.productId]?.reason ?? null })) }); }
    catch (e) { setError(e); } finally { setSaving(false); }
  };
  const refresh = async () => { const r = await api('POST', `/counts/${id}/refresh`, {}); for (const p of r.refreshedProducts) setLocal((x) => ({ ...x, [p]: { physicalQty: null, reason: null } })); qc.invalidateQueries({ queryKey: ['count', id] }); setError(null); };
  const submit = async () => {
    setError(null);
    try { setDone(await mutate(`/counts/${id}/submit`, {}, keyRef.current)); setConfirm(false); }
    catch (e) { setError(e); setConfirm(false); if (e instanceof ApiError && e.code === 'STALE_COUNT_SNAPSHOT') { keyRef.current = crypto.randomUUID(); q.refetch(); } }
  };
  if (done) return (
    <div className="card stack"><div className="banner ok">✓ Count signed off</div>
      <p>{done.deltas.filter((d: any) => d.delta).length} adjustment(s) posted{done.adjustmentEventId ? <> as transaction <span className="mono">{done.adjustmentEventId.slice(0, 8).toUpperCase()}</span></> : ''}.</p>
      <button className="btn primary" onClick={onDone}>Done</button></div>
  );
  return (
    <>
      <div className="small muted">Started {fmtTime(c.startedAt)} · {lines.length - uncounted}/{lines.length} counted {saving && '· saving…'}</div>
      {c.changedCount > 0 && <div className="banner warn row spread">{c.changedCount} item(s) changed since this count started. Refresh before finishing. <button className="btn" onClick={refresh}>Refresh changed items</button></div>}
      <ErrorBanner error={error} />
      <VoiceCount lines={lines} aliases={products.data ?? []} onItems={fromVoice} />
      <div className="card table-wrap">
        <table className="count-table">
          <thead><tr><th>Product</th><th className="num">System</th><th className="num">Physical</th><th className="num">Difference</th><th>Reason</th><th className="num">Not counted: with staff / in transit</th></tr></thead>
          <tbody>{lines.map((l: any) => { const v = varianceOf(l); return (
            <tr key={l.productId} className={heardAt[l.productId] && Date.now() - heardAt[l.productId] < 4000 ? 'justheard' : undefined} style={l.changedSinceSnapshot ? { background: 'var(--warning-bg)' } : undefined}>
              <td className="count-name"><span className="row"><ProductIcon sku={l.sku} icon={l.icon} />{l.name}{heardAt[l.productId] ? <span className="small muted" title="Filled by voice" aria-label="Filled by voice"> 🎙</span> : null}</span>{l.changedSinceSnapshot && <div className="small" style={{ color: 'var(--warning)' }}>▲ changed — recount</div>}</td>
              <td className="num" data-label="System">{l.expectedQty}</td>
              <td className="num" data-label="Physical"><input aria-label={`Physical ${l.name}`} inputMode="numeric" style={{ width: 90, textAlign: 'right' }} value={l.physicalQty ?? ''}
                onChange={(e) => setLocal({ ...local, [l.productId]: { ...local[l.productId], physicalQty: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0) } })}
                onBlur={() => save(l.productId, {})} /></td>
              <td className="num" data-label="Difference" style={{ color: v ? 'var(--danger)' : v === 0 ? 'var(--success)' : undefined, fontWeight: 700 }}>{v == null ? '—' : v > 0 ? `+${v}` : v === 0 ? '0 ✓' : v}</td>
              <td data-label={v ? 'Reason' : undefined}>{v ? <select aria-label={`Reason ${l.name}`} value={l.reason ?? ''} onChange={(e) => save(l.productId, { reason: e.target.value || null })} style={!l.reason ? { borderColor: 'var(--danger)' } : undefined}>
                <option value="">Reason required…</option>{REASONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select> : null}</td>
              <td className="num small muted" data-label="Not counted: staff / transit">{l.staffHeld} / {l.inTransit}</td>
            </tr>); })}</tbody>
        </table>
      </div>
      <div className="row">
        <button className="btn primary lg" disabled={uncounted > 0 || needReason > 0 || c.changedCount > 0} onClick={() => setConfirm(true)}>Submit count</button>
        <button className="btn" onClick={async () => { if (confirm || window.confirm('Cancel this count? Entered quantities will be discarded.')) { await api('POST', `/counts/${id}/cancel`, {}); onDone(); } }}>Cancel count</button>
        {(uncounted > 0 || needReason > 0) && <span className="small muted">{uncounted ? `${uncounted} not counted. ` : ''}{needReason ? `${needReason} need a reason.` : ''}</span>}
      </div>
      {confirm && (
        <Modal title="Sign off count" onClose={() => setConfirm(false)}>
          {lines.filter((l: any) => varianceOf(l)).length === 0 ? <p>No differences. The count will be signed off with no adjustments.</p> : (
            <table><thead><tr><th>Product</th><th className="num">Adjustment</th><th>Reason</th></tr></thead>
              <tbody>{lines.filter((l: any) => varianceOf(l)).map((l: any) => <tr key={l.productId}><td>{l.name}</td><td className="num">{varianceOf(l)! > 0 ? '+' : ''}{varianceOf(l)}</td><td>{REASONS.find((r) => r[0] === l.reason)?.[1]}</td></tr>)}</tbody></table>
          )}
          <p className="small muted">Adjustments are posted as new audit records. Existing history is never changed.</p>
          <button className="btn primary" onClick={submit}>Sign off</button>
        </Modal>
      )}
    </>
  );
}

type Heard = { id: number; ok: boolean; text: string };
const LANG_LABEL: [Lang, string][] = [['en', 'EN'], ['hi', 'हि'], ['gu', 'ગુ']];
function VoiceCount({ lines, aliases, onItems }: { lines: any[]; aliases: any[]; onItems: (items: { productId: string; qty: number }[]) => void }) {
  const { me } = useMe();
  const [lang, setLang] = useState<Lang>(me.language);
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState('');
  const [log, setLog] = useState<Heard[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const ear = useRef<Listener | null>(null);
  const seq = useRef(0);
  const onItemsRef = useRef(onItems); onItemsRef.current = onItems;
  const catalog = lines.map((l) => ({ productId: l.productId, name: l.name, sku: l.sku, aliases: (aliases.find((p) => p.id === l.productId)?.aliases ?? []).map((a: any) => a.alias) }));
  const catRef = useRef(catalog); catRef.current = catalog;
  useEffect(() => () => ear.current?.abort(), []);
  const add = (h: Omit<Heard, 'id'>) => setLog((x) => [{ ...h, id: ++seq.current }, ...x].slice(0, 6));
  const phrase = (text: string, spoken = true) => {
    const r = parseCountSpeech(text, catRef.current);
    if (r.items.length) {
      onItemsRef.current(r.items);
      r.items.forEach((it) => add({ ok: true, text: `${it.name} → ${it.qty}` }));
      if (spoken) speak(r.items.map((it) => `${it.name} ${it.qty}`).join(', '), lang);
    }
    r.productsWithoutNumber.forEach((n) => add({ ok: false, text: `${n}: say the number too` }));
    if (!r.items.length && !r.productsWithoutNumber.length && text) add({ ok: false, text: `“${text}” — not understood` });
  };
  const startedAt = useRef(0);
  const start = () => {
    setProblem(null); setInterim(''); startedAt.current = Date.now();
    ear.current = listenContinuously(lang, {
      onPhrase: (t) => phrase(t), onInterim: setInterim,
      onStop: (err) => { setOn(false); setInterim(''); ear.current = null; if (err) setProblem('The microphone is blocked. Allow it in the browser and try again, or type the numbers below.'); },
    });
    setOn(!!ear.current);
    if (!ear.current) setProblem('Voice counting isn’t available in this browser. Use Chrome, or type the numbers below.');
  };
  const stop = () => { ear.current?.stop(); setOn(false); };
  const supported = hasSpeechRecognition();
  const left = lines.filter((l) => l.physicalQty == null).map((l) => l.name);
  return (
    <>
      <section className="card stack" style={{ gap: 8 }}>
        <div className="row spread" style={{ alignItems: 'center' }}>
          <b>Count by voice or typing</b>
          <div className="seg" role="group" aria-label="Voice language" style={{ width: 'auto', display: 'inline-flex' }}>
            {LANG_LABEL.map(([l, label]) => <button key={l} aria-pressed={lang === l} disabled={on} onClick={() => setLang(l)}>{label}</button>)}
          </div>
        </div>
        <div className="small muted">Hold the mic at the bottom and say items and numbers, like “Soap 180, shampoo 110”, or type them. Numbers fill in below; you still check and submit.</div>
        {left.length > 0 && left.length < lines.length && <div className="small"><b>Still to count:</b> {left.join(', ')}</div>}
        {left.length === 0 && <div className="small" style={{ color: 'var(--mint)', fontWeight: 700 }}>✓ Everything counted. Check the differences below, then submit.</div>}
      </section>
      <Composer docked placeholder="Type: soap 180, shampoo 110"
        labels={{ hold: 'Hold to count by voice', slide: '◀ Slide to cancel', releaseCancel: 'Release to cancel', send: 'Fill in' }}
        feed={(log.length > 0 || problem) ? <div className="chips-feed">{problem && <span className="miss">{problem}</span>}{log.slice(0, 3).map((h) => <span key={h.id} className={h.ok ? 'ok' : 'miss'}>{h.ok ? '✓' : '?'} {h.text}</span>)}</div> : undefined}
        onText={(text) => phrase(text, false)}
        voice={{ available: supported, live: on, startedAt: startedAt.current, interim,
          onStart: start, onSend: stop, onCancel: () => { ear.current?.abort(); ear.current = null; setOn(false); setInterim(''); },
          onTap: () => setProblem('Keep holding the mic while you speak, then let go.'),
          onUnavailable: () => setProblem('Voice counting works in Chrome. Type the numbers instead.') }} />
    </>
  );
}

export function CountHistory({ hotel }: { hotel: string }) {
  const q = useQuery<any[]>({ queryKey: ['counts', hotel], queryFn: () => get(`/counts?hotelId=${hotel}`) });
  const st = useQuery<any>({ queryKey: ['verifications', hotel], queryFn: () => get(`/dashboard/verifications?hotelId=${hotel}`) });
  const [detail, setDetail] = useState<string | null>(null);
  return (
    <>
      <div className="row spread"><h1>Verification history</h1><button className="btn" onClick={() => downloadUrl(`/reports/counts.csv?hotelId=${hotel}`)}>Export CSV</button></div>
      <div className="grid">{(st.data?.status ?? []).map((s: any) => (
        <div key={s.hotelId} className="card stack" style={{ gap: 4 }}><b>{s.hotelName}</b><StatusBadge s={s.state} /><span className="small muted">Last: {s.lastSubmittedAt ? fmtTime(s.lastSubmittedAt) : 'never'}</span></div>))}</div>
      {q.isLoading ? <Loading /> : !q.data?.length ? <div className="card muted">No counts yet.</div> : (
        <div className="card table-wrap"><table>
          <thead><tr><th>Started</th><th>Hotel</th><th>Status</th><th>Signed off by</th><th className="num">Items differing</th><th className="num">Units differing</th><th className="num">Net</th><th></th></tr></thead>
          <tbody>{q.data.map((c) => <tr key={c.id}><td>{fmtTime(c.startedAt)}</td><td>{c.hotelName}</td><td><StatusBadge s={c.status} /></td><td>{c.submittedByName ?? '—'}</td>
            <td className="num">{c.itemsWithVariance}</td><td className="num">{c.absVarianceUnits}</td><td className="num">{c.netVarianceUnits}</td><td><button className="link" onClick={() => setDetail(c.id)}>Details</button></td></tr>)}</tbody>
        </table></div>
      )}
      {detail && <CountDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function CountDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<any>({ queryKey: ['count', id], queryFn: () => get(`/counts/${id}`) });
  return (
    <Modal title="Count record" onClose={onClose}>
      {!q.data ? <Loading /> : (<>
        <div className="small">Started {fmtTime(q.data.startedAt)} · Signed off {fmtTime(q.data.submittedAt)} · <StatusBadge s={q.data.status} /></div>
        {q.data.adjustmentEventIds.length > 0 && <div className="small">Adjustment transaction(s): {q.data.adjustmentEventIds.map((e: string) => <span key={e} className="mono">{e.slice(0, 8).toUpperCase()} </span>)}</div>}
        <table><thead><tr><th>Product</th><th className="num">Expected</th><th className="num">Physical</th><th className="num">Diff</th><th>Reason</th></tr></thead>
          <tbody>{q.data.lines.map((l: any) => <tr key={l.productId}><td>{l.name}</td><td className="num">{l.expectedQty}</td><td className="num">{l.physicalQty ?? '—'}</td><td className="num">{l.variance ?? '—'}</td><td className="small">{l.reason ?? ''}</td></tr>)}</tbody></table>
        <button className="btn" onClick={() => window.print()}>Print</button>
      </>)}
    </Modal>
  );
}
