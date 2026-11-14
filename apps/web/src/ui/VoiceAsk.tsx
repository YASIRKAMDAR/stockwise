/** Ask-by-voice for managers and owners: answers stock questions and opens the right screen. Never changes stock. */
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { speak } from '../i18n';
import { useMe } from './common';
import { IconSpeaker } from './icons';
import { Composer } from './Composer';
import { hasSpeechRecognition, recognize, type Listener } from './speech';

export type VoiceGo = 'SHOW_ALERTS' | 'SHOW_TRANSFERS' | 'SHOW_ROOM_USE' | 'SHOW_CHANGES' | 'START_COUNT';
const OPENING: Record<VoiceGo, string> = {
  SHOW_ALERTS: 'Here is what needs attention.', SHOW_TRANSFERS: 'Opening deliveries between hotels.', SHOW_ROOM_USE: 'Opening room use.',
  SHOW_CHANGES: 'Opening recent changes.', START_COUNT: 'Opening the weekly count.',
};

export function VoiceAsk({ hotelId, scopeAll, onGo, docked = false }: { hotelId: string; scopeAll: boolean; onGo: (a: VoiceGo, targetHotelId: string | null) => void; docked?: boolean }) {
  const { me } = useMe();
  const [state, setState] = useState<'idle' | 'recording' | 'thinking'>('idle');
  const [answer, setAnswer] = useState<{ heard?: string; text: string; rows?: any[]; tone?: 'warn' } | null>(null);
  const [interim, setInterim] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const ear = useRef<Listener | null>(null);
  const want = useRef<'hold' | 'send' | 'cancel'>('hold');
  const started = useRef(0);
  useEffect(() => () => { rec.current?.stream.getTracks().forEach((t) => t.stop()); ear.current?.abort(); }, []);
  useEffect(() => { if (state !== 'recording') return; const id = setTimeout(() => finish('send'), me.config.voiceMaxSeconds * 1000); return () => clearTimeout(id); }, [state]);
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
  const browserEar = me.config.voiceProvider === 'fake' && hasSpeechRecognition();
  const canVoice = browserEar || (me.config.voiceProvider !== 'fake' && !!navigator.mediaDevices?.getUserMedia);
  const start = async () => {
    setAnswer(null); setInterim(''); want.current = 'hold';
    if (browserEar) {
      started.current = Date.now(); setState('recording');
      ear.current = recognize(me.language, { continuous: true, onInterim: setInterim, onEnd: (text, err) => {
        ear.current = null; setInterim('');
        if (err === 'not-allowed') { setState('idle'); setAnswer({ text: 'The microphone is blocked. Allow it in the browser, or type your question.', tone: 'warn' }); return; }
        if (want.current === 'cancel' || !text) { setState('idle'); return; }
        send(new Blob([text], { type: 'text/plain' }), 'ask.txt', Date.now() - started.current);
      } });
      if (!ear.current) setState('idle');
      return;
    }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }); } catch { setAnswer({ text: 'The microphone is blocked. Allow it in the browser, or type your question.', tone: 'warn' }); return; }
    if (want.current !== 'hold') { stream.getTracks().forEach((t) => t.stop()); setAnswer({ text: 'Keep holding the mic while you speak, then let go.', tone: 'warn' }); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); const d = Date.now() - started.current; if (want.current === 'cancel' || d < 600) { setState('idle'); return; } send(new Blob(chunks, { type: (r.mimeType || 'audio/webm').split(';')[0] }), 'ask', d); };
    rec.current = r; started.current = Date.now(); r.start(); setState('recording');
  };
  const finish = (how: 'send' | 'cancel') => {
    want.current = how;
    if (ear.current) { if (how === 'send') ear.current.stop(); else { ear.current.abort(); ear.current = null; setState('idle'); setInterim(''); } }
    if (rec.current?.state === 'recording') rec.current.stop();
  };

  const card = answer && (
    <div className={`bubble${answer.tone ? ' warn' : ''}`}>
      <div className="row spread" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          {answer.heard && <div className="small faint">You asked: “{answer.heard}”</div>}
          <div style={{ fontWeight: 600 }}>{answer.text}</div>
        </div>
        <span className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
          {answer.rows && <button className="btn quiet" aria-label="Read aloud" onClick={() => speak(answer.text, me.language)}><IconSpeaker /></button>}
          <button className="btn quiet" aria-label="Close answer" onClick={() => setAnswer(null)}>✕</button>
        </span>
      </div>
      {answer.rows && answer.rows.length > 0 && (
        <table><thead><tr><th>Item</th><th>Hotel</th><th className="num">In store</th><th className="num">With staff</th></tr></thead>
          <tbody>{answer.rows.map((r: any) => <tr key={r.hotelId + r.productId}><td>{r.name}</td><td>{r.hotelName}</td><td className="num">{r.store}{r.low ? ' ▲' : ''}</td><td className="num">{r.staffHeld}</td></tr>)}</tbody></table>
      )}
    </div>
  );
  return (
    <section className={docked ? undefined : 'ask'}>
      {!docked && <div style={{ fontWeight: 700, marginBottom: 6 }}>Ask about your stock <span className="small faint" style={{ fontWeight: 400 }}>· “What is running low?” · “How much soap at Hotel 2?”</span></div>}
      <Composer docked={docked} placeholder="Ask: what is running low?" feed={card}
        labels={{ hold: 'Hold to ask', slide: '◀ Slide to cancel', releaseCancel: 'Release to cancel', send: 'Ask' }}
        onText={(text) => { setAnswer(null); send(new Blob([text], { type: 'text/plain' }), 'ask.txt', 0); }}
        voice={{ available: canVoice, live: state === 'recording', startedAt: started.current, interim, busy: state === 'thinking',
          onStart: start, onSend: () => finish('send'), onCancel: () => finish('cancel'),
          onTap: () => setAnswer({ text: 'Hold the mic while you ask, then let go. Or type your question.', tone: 'warn' }),
          onUnavailable: () => setAnswer({ text: 'Voice isn’t available in this browser. Type your question instead.', tone: 'warn' }) }} />
    </section>
  );
}
