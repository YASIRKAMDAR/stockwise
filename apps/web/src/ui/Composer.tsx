import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconMic } from './icons';
import { fmtSecs, useHold } from './hold';

export interface ComposerVoice {
  available: boolean;          // false: mic shows but explains it can't be used here
  live: boolean;               // recording now
  startedAt: number;
  interim?: string;
  busy?: boolean;              // waiting for an answer
  waiting?: string;            // shown in the box after a few seconds of busy ("Still asking Google…")
  level?: number;              // 0–1 loudness while live, so staff can see they're being heard
  onStart: () => void; onSend: () => void; onCancel: () => void; onTap?: () => void; onUnavailable?: () => void;
}
export interface ComposerLabels { hold: string; slide: string; releaseCancel: string; send: string }

/** WhatsApp-style bar: type and the button becomes Send; leave it empty and it's a hold-to-talk mic. */
export function Composer({ placeholder, onText, voice, labels, feed, docked = true, draft, onDraft }: {
  placeholder: string; onText: (text: string) => void; voice: ComposerVoice; labels: ComposerLabels; feed?: ReactNode; docked?: boolean;
  /** Optional: the text box's content owned by the parent, so "Type it" / "Tap to correct" can fill it. */
  draft?: string; onDraft?: (text: string) => void;
}) {
  const [local, setLocal] = useState('');
  const text = draft ?? local;
  const setText = (v: string) => (onDraft ? onDraft(v) : setLocal(v));
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { if (draft && box.current && document.activeElement !== box.current) box.current.focus(); }, [draft]);
  const [, tick] = useState(0);
  const hold = useHold({
    onStart: () => (voice.available ? voice.onStart() : undefined),
    onSend: () => (voice.available ? voice.onSend() : voice.onUnavailable?.()),
    onCancel: () => (voice.available ? voice.onCancel() : undefined),
    onTap: () => (voice.available ? voice.onTap?.() : voice.onUnavailable?.()),
    disabled: voice.busy,
  });
  useEffect(() => { if (!voice.live) return; const id = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(id); }, [voice.live]);
  const submit = () => { const v = text.trim(); if (!v || voice.busy) return; setText(''); onText(v); };
  const typing = text.trim().length > 0 && !voice.live;
  return (
    <div className={`composer${docked ? ' docked' : ''}`} aria-live="polite">
      <div className="composer-inner">
        {feed && <div className="composer-feed">{feed}</div>}
        <div className="composer-bar">
          {voice.busy && voice.waiting ? (
            <div className="composer-listen wait"><span className="interim">{voice.waiting}</span></div>
          ) : voice.live ? (
            <div className={`composer-listen${hold.cancelArmed ? ' cancel' : ''}`}>
              <LevelMeter level={voice.level ?? 0} /> <b>{fmtSecs(Date.now() - voice.startedAt)}</b>
              <span className="interim">{hold.cancelArmed ? labels.releaseCancel : voice.interim ? `“${voice.interim}”` : labels.slide}</span>
            </div>
          ) : (
            <input ref={box} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={placeholder} aria-label={placeholder} enterKeyHint="send" disabled={voice.busy} />
          )}
          {typing ? (
            <button className="composer-btn send" onClick={submit} aria-label={labels.send} disabled={voice.busy}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20.5 21 12 3 3.5l2.6 7.2L14 12l-8.4 1.3z" fill="currentColor" /></svg>
            </button>
          ) : (
            <button type="button" {...hold.handlers} className={`composer-btn mic${voice.live ? ' rec' : ''}${hold.cancelArmed ? ' cancel' : ''}${voice.available ? '' : ' off'}`}
              aria-label={labels.hold} disabled={voice.busy}>
              {voice.busy ? <span className="spin" aria-hidden="true" /> : <IconMic />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Five bars that rise with the staff member's voice. */
export function LevelMeter({ level }: { level: number }) {
  return (
    <span className="levelmeter" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => <i key={i} className={level > i / 5 ? 'on' : ''} style={{ height: 8 + i * 3 }} />)}
    </span>
  );
}
