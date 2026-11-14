import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** WhatsApp-style press-and-hold: hold to record, release to send, slide left to cancel.
 * A quick tap (under ~0.35s) cancels and calls onTap so the screen can say "hold to talk".
 * Keyboard: hold Space/Enter, Escape cancels. */
export function useHold(o: { onStart: () => void; onSend: () => void; onCancel: () => void; onTap?: () => void; disabled?: boolean }) {
  const cb = useRef(o); cb.current = o;
  const [holding, setHolding] = useState(false);
  const [cancelArmed, setArmed] = useState(false);
  const [since, setSince] = useState(0);
  const st = useRef({ x: 0, t: 0, active: false, cancel: false });
  const begin = (x: number) => {
    st.current = { x, t: Date.now(), active: true, cancel: false };
    setHolding(true); setArmed(false); setSince(Date.now());
    try { navigator.vibrate?.(15); } catch { /* not supported */ }
    cb.current.onStart();
  };
  const end = (send: boolean) => {
    const s = st.current; if (!s.active) return;
    s.active = false; setHolding(false); setArmed(false);
    if (Date.now() - s.t < 350) { cb.current.onCancel(); cb.current.onTap?.(); return; }
    if (send && !s.cancel) cb.current.onSend(); else cb.current.onCancel();
  };
  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (o.disabled || e.button > 0) return;
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      begin(e.clientX);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = st.current; if (!s.active) return;
      const c = e.clientX - s.x < -70;
      if (c !== s.cancel) { s.cancel = c; setArmed(c); try { if (c) navigator.vibrate?.(10); } catch { /* ignore */ } }
    },
    onPointerUp: () => end(true),
    onPointerCancel: () => end(false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !st.current.active && !o.disabled) { e.preventDefault(); begin(0); }
      else if (e.key === 'Escape' && st.current.active) { st.current.cancel = true; end(false); }
    },
    onKeyUp: (e: KeyboardEvent<HTMLElement>) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); end(true); } },
  };
  return { handlers, holding, cancelArmed, since };
}

export const fmtSecs = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
