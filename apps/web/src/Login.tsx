import { useState } from 'react';
import { api, errorText, getDevice } from './api';

export function Login({ onDone }: { onDone: () => void }) {
  const device = getDevice();
  const [mode, setMode] = useState<'pin' | 'password'>(device ? 'pin' : 'password');
  const [code, setCode] = useState(''), [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (mode === 'pin') await api('POST', '/auth/staff-login', { employeeCode: code.trim().toUpperCase(), pin: secret, deviceId: device!.deviceId, deviceSecret: device!.deviceSecret });
      else await api('POST', '/auth/login', { employeeCode: code.trim().toUpperCase(), password: secret });
      setSecret(''); onDone();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="app">
      <main className="content" style={{ justifyContent: 'center' }}>
        <div className="row" style={{ justifyContent: 'center' }}><img src="/icon.svg" alt="" width="56" height="56" /></div>
        <h1 style={{ textAlign: 'center' }}>Stockwise</h1>
        <div className="seg" role="group" aria-label="Sign-in type">
          <button aria-pressed={mode === 'pin'} onClick={() => setMode('pin')} type="button">Staff (PIN)</button>
          <button aria-pressed={mode === 'password'} onClick={() => setMode('password')} type="button">Manager / Owner</button>
        </div>
        {mode === 'pin' && !device ? (
          <div className="banner warn">This phone is not set up for staff yet. A manager must sign in here once and choose <b>Enroll this device for staff</b> in Settings.</div>
        ) : (
          <form className="card stack" onSubmit={submit}>
            {mode === 'pin' && <div className="small muted">Device: {device!.label}</div>}
            <label className="field">Employee code<input autoComplete="username" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} required /></label>
            <label className="field">{mode === 'pin' ? 'PIN' : 'Password'}
              <input type="password" inputMode={mode === 'pin' ? 'numeric' : undefined} autoComplete={mode === 'pin' ? 'off' : 'current-password'} value={secret} onChange={(e) => setSecret(e.target.value)} required />
            </label>
            {error ? <div className="banner bad" role="alert">{errorText(error)}</div> : null}
            <button className="btn primary lg block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        )}
      </main>
    </div>
  );
}
