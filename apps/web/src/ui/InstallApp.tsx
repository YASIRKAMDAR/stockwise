import { useEffect, useState } from 'react';

/** "Install the app" — Chrome/Edge/Android show the native install prompt; iPhone gets the two-step instruction.
 * Hidden when already running as an installed app (home-screen web app or the Android app). */
type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as PromptEvent; listeners.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });
}
export const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true || document.referrer.startsWith('android-app://');
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function InstallApp() {
  const [, force] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => { const f = () => force((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  if (done || isInstalled()) return null;
  if (deferred) return (
    <button type="button" className="btn block install" onClick={async () => { const e = deferred!; await e.prompt(); const r = await e.userChoice; if (r.outcome === 'accepted') { deferred = null; setDone(true); } }}>
      <img src="/icons/icon-192.png" alt="" width="24" height="24" /> Install the app on this phone
    </button>
  );
  if (isIOS()) return <p className="small muted install-hint">To install on iPhone: tap <b>Share</b> <span aria-hidden="true">⎋</span> then <b>Add to Home Screen</b>.</p>;
  return null;
}
