/** Ask-by-voice for managers and owners: answers stock questions and opens the right screen. Never changes stock. */
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { speak } from '../i18n';
import { useMe } from './common';
import { IconMic, IconSpeaker, IconStop } from './icons';

export type VoiceGo = 'SHOW_ALERTS' | 'SHOW_TRANSFERS' | 'SHOW_ROOM_USE' | 'SHOW_CHANGES' | 'START_COUNT';
const OPENING: Record<VoiceGo, string> = {
  SHOW_ALERTS: 'Here is what needs attention.', SHOW_TRANSFERS: 'Opening deliveries between hotels.', SHOW_ROOM_USE: 'Opening room use.',
  SHOW_CHANGES: 'Opening recent changes.', START_COUNT: 'Opening the weekly count.',
};

export function VoiceAsk({ hotelId, scopeAll, onGo }: { hotelId: string; scopeAll: boolean; onGo: (a: VoiceGo, targetHotelId: string | null) => void }) {
  const { me } = useMe();
  const [state, setState] = useState<'idle' | 'recording' | 'thinking'>('idle');
  const [answer, setAnswer] = useState<{ heard?: string; text: string; rows?: any[]; tone?: 'warn' } | null>(null);
  const [typed, setTyped] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  if (me.config.voiceProvider === 'disabled') return null;

  const respond = (p: any) => {
    if (p.status === 'QUERY_RESULT') {
      const rows = (p.queryResult ?? []) as any[];
      const byProduct = new Map<string, any[]>();
      rows.forEach((r) => byProduct.set(r.name, [...(byProduct.get(r.name) ?? []), r]));
      const text = [...byProduct.entries()].slice(0, 4).map(([n, rs]) => `${n}: ${rs.map((r) => `${r.store} at ${r.hotelName}`).join(', ')}`).join('. ') || 'No matching stock.';
      setAnswer({ heard: p.transcript, text, rows });
      speak(text, me.language);
    } else if (p.status === 'NAVIGATE') {
      setAnswer({ heard: p.transcript, text: OPENING[p.action as VoiceGo] });
      onGo(p.action, p.targetHotelId);
    } else if (['PLACE_IN_ROOM', 'CHECKOUT_TO_STAFF', 'RETURN_TO_STORE', 'SUPPLIER_RECEIPT', 'TRANSFER_DISPATCH'].includes(p.action)) {
      setAnswer({ heard: p.transcript, text: 'That sounds like recording stock. Staff record movements from their phones; you can see them under Changes.', tone: 'warn' });
    } else {
      setAnswer({ heard: p.transcript, text: p.clarificationQuestion ?? 'Sorry, I did not get that. Try “What is running low?”', tone: 'warn' });
    }
  };
  const send = async (blob: Blob, name: string, durationMs: number) => {
    setState('thinking');
    const fd = new FormData();
    fd.append('hotelId', hotelId); fd.append('durationMs', String(durationMs)); if (scopeAll) fd.append('scope', 'all');
    fd.append('audio', blob, name);
    try { respond(await api('POST', '/voice/interpret', fd)); } catch (e) { setAnswer({ text: errorText(e), tone: 'warn' }); } finally { setState('idle'); }
  };
  const start = async () => {
    setAnswer(null);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }); } catch { setAnswer({ text: 'The microphone is blocked. Allow it in the browser, or type your question.', tone: 'warn' }); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); if (timer.current) clearInterval(timer.current); const d = Date.now() - started.current; if (d < 600) { setState('idle'); return; } send(new Blob(chunks, { type: (r.mimeType || 'audio/webm').split(';')[0] }), 'ask', d); };
    rec.current = r; started.current = Date.now(); r.start(); setState('recording');
    timer.current = window.setInterval(() => { if (Date.now() - started.current > me.config.voiceMaxSeconds * 1000 && r.state === 'recording') r.stop(); }, 300);
  };
  const stop = () => rec.current?.state === 'recording' && rec.current.stop();

  return (
    <section className="ask" aria-live="polite">
      <div className="askbar">
        <button className={`askmic${state === 'recording' ? ' rec' : ''}`} onClick={state === 'recording' ? stop : start} disabled={state === 'thinking'} aria-label={state === 'recording' ? 'Stop' : 'Ask by voice'}>
          {state === 'recording' ? <IconStop /> : <IconMic />}
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{state === 'recording' ? 'Listening… tap to stop' : state === 'thinking' ? 'Finding the answer…' : 'Ask about your stock'}</div>
          <div className="small faint">“What is running low?” · “How much soap at Hotel 2?” · “Start the weekly count”</div>
        </div>
      </div>
      {me.config.voiceProvider === 'fake' && (
        <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (typed.trim()) send(new Blob([typed], { type: 'text/plain' }), 'ask.txt', 0); }}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Test mode: type a question" aria-label="Type a question" />
          <button className="btn">Ask</button>
        </form>
      )}
      {answer && (
        <div className={`answer${answer.tone ? ' warn' : ''}`}>
          {answer.heard && <div className="small faint">You asked: “{answer.heard}”</div>}
          <div className="row spread" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <div style={{ fontWeight: 600 }}>{answer.text}</div>
            {answer.rows && <button className="btn quiet" aria-label="Read aloud" onClick={() => speak(answer.text, me.language)}><IconSpeaker /></button>}
          </div>
          {answer.rows && answer.rows.length > 0 && (
            <table><thead><tr><th>Item</th><th>Hotel</th><th className="num">In store</th><th className="num">With staff</th></tr></thead>
              <tbody>{answer.rows.map((r: any) => <tr key={r.hotelId + r.productId}><td>{r.name}</td><td>{r.hotelName}</td><td className="num">{r.store}{r.low ? ' ▲' : ''}</td><td className="num">{r.staffHeld}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
    </section>
  );
}
