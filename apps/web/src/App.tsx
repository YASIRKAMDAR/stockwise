import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, clearLocalUserData, get } from './api';
import { Login } from './Login';
import { MeCtx, type Me, Loading } from './ui/common';
import { StaffApp } from './staff/StaffApp';
import { AdminApp } from './owner/AdminApp';

export function App() {
  const qc = useQueryClient();
  const me = useQuery<Me>({ queryKey: ['me'], queryFn: () => get('/me'), retry: (n, e) => !(e instanceof ApiError) && n < 2 });
  const logout = async () => {
    await api('POST', '/auth/logout', {}).catch(() => {});
    clearLocalUserData();
    // Full reload drops all in-memory query data; no intermediate render of the login form.
    location.replace('/');
  };
  if (me.isLoading) return <div className="app"><div className="content"><Loading /></div></div>;
  if (me.error instanceof ApiError && me.error.status === 401) return <Login onDone={() => qc.invalidateQueries({ queryKey: ['me'] })} />;
  if (me.error) return <div className="app"><div className="content"><div className="banner bad">Cannot reach Stockwise. Check your connection.</div><button className="btn" onClick={() => me.refetch()}>Retry</button></div></div>;
  const m = me.data!;
  return (
    <MeCtx.Provider value={{ me: m, logout }}>
      {m.authMethod === 'PIN' ? <StaffApp /> : <AdminApp />}
    </MeCtx.Provider>
  );
}
