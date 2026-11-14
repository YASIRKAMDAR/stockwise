import { useState } from 'react';
import { api, errorText, getDevice } from './api';
import { InstallApp } from './ui/InstallApp';

export function Login({ onDone }: { onDone: () => void }) {
  const device = getDevice();
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [code, setCode] = useState(''), [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (mode === 'pin') await api('POST', '/auth/staff-login', { employeeCode: code.trim().toUpperCase(), pin: secret, ...(device ? { deviceId: device.deviceId, deviceSecret: device.deviceSecret } : {}) });
      else await api('POST', '/auth/login', { employeeCode: code.trim().toUpperCase(), password: secret });
      setSecret(''); onDone();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <main className="box">
        <div className="mark"><img src="/icons/icon-192.png" alt="" width="52" height="52" /><div><h1>Stockwise</h1><p>Hotel amenities, counted right.</p></div></div>
        <div className="seg" role="group" aria-label="Sign-in type">
          <button aria-pressed={mode === 'pin'} onClick={() => setMode('pin')} type="button">Staff</button>
          <button aria-pressed={mode === 'password'} onClick={() => setMode('password')} type="button">Manager / Owner</button>
        </div>
        {(
          <form className="stack" onSubmit={submit}>
            <label className="field">{mode === 'pin' ? 'Your code' : 'Employee code'}<input autoComplete="username" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} required /></label>
            <label className="field">{mode === 'pin' ? 'Passcode' : 'Password'}
              <input type="password" inputMode={mode === 'pin' ? 'numeric' : undefined} autoComplete={mode === 'pin' ? 'off' : 'current-password'} value={secret} onChange={(e) => setSecret(e.target.value)} required />
            </label>
            {error ? <div className="banner bad" role="alert">{errorText(error)}</div> : null}
            <button className="btn primary lg block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        )}
        <InstallApp />
      </main>
    </div>
  );
}
