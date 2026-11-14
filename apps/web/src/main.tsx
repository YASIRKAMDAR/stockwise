import './ui/InstallApp';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ApiError } from './api';
import '@fontsource/hind-vadodara/400.css';
import '@fontsource/hind-vadodara/600.css';
import '@fontsource/hind-vadodara/700.css';
import '@fontsource/hind/400.css';
import '@fontsource/hind/600.css';
import '@fontsource/hind/700.css';
import './styles.css';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
