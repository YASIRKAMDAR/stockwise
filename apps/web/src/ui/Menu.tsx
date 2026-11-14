import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconSignOut } from './icons';

export interface MenuItem { key: string; label: string; Icon: () => JSX.Element; current?: boolean; badge?: number; onClick: () => void }

/** ☰ menu in the top bar: the app's sections, extra controls (e.g. language), and Sign out at the bottom. */
export function BurgerMenu({ items, extra, onSignOut, signOutLabel = 'Sign out', who }: { items: MenuItem[]; extra?: ReactNode; onSignOut: () => void; signOutLabel?: string; who?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close); document.addEventListener('touchstart', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="burger" ref={box}>
      <button className="burger-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>
      </button>
      {open && (
        <div className="burger-panel" role="menu">
          {who && <div className="burger-who">{who}</div>}
          {items.map(({ key, label, Icon, current, badge, onClick }) => (
            <button key={key} role="menuitem" aria-current={current ? 'page' : undefined} onClick={() => { setOpen(false); onClick(); }}>
              <Icon /><span>{label}</span>{badge ? <span className="count">{badge}</span> : null}
            </button>
          ))}
          {extra && <div className="burger-extra">{extra}</div>}
          <button role="menuitem" className="signout" onClick={() => { setOpen(false); onSignOut(); }}><IconSignOut /><span>{signOutLabel}</span></button>
        </div>
      )}
    </div>
  );
}
