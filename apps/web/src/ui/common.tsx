import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { errorText } from '../api';

export interface Hotel { id: string; name: string; code: string; timezone: string; allowStoreToRoom: boolean; roles: string[] }
export interface Me {
  id: string; displayName: string; employeeCode: string; role: 'STAFF' | 'MANAGER' | 'OWNER'; authMethod: 'PIN' | 'PASSWORD'; language: 'en' | 'hi' | 'gu';
  hotels: Hotel[]; activeHotel: string | null; deviceId: string | null;
  config: { voiceProvider: string; voiceMaxSeconds: number; ownerPollSeconds: number };
}
export const MeCtx = createContext<{ me: Me; logout: () => void } | null>(null);
export const useMe = () => useContext(MeCtx)!;

const ICONS: Record<string, string> = { SOAP: '🧼', SHAMPOO: '🧴', COMB: '🪮', DENTAL_KIT: '🦷', TOOTHBRUSH: '🪥', TOOTHPASTE: '🦷' };
export const ProductIcon = ({ sku, icon }: { sku?: string; icon?: string | null }) => <span aria-hidden="true" style={{ fontSize: '1.4rem' }}>{icon || (sku && ICONS[sku]) || '📦'}</span>;

export function Stepper({ value, onChange, min = 0, label }: { value: number | null; onChange: (n: number) => void; min?: number; label: string }) {
  const v = value ?? 0;
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(min, v - 1))}>−</button>
      <input inputMode="numeric" aria-label={label} value={value ?? ''} onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); onChange(Number.isFinite(n) ? n : min); }} />
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(v + 1)}>+</button>
    </div>
  );
}

const STATUS: Record<string, [string, string, string]> = {
  IN_TRANSIT: ['warn', '⏳', 'On the way'], PARTIALLY_RECEIVED: ['warn', '◐', 'Part arrived'], RECEIVED: ['ok', '✓', 'Arrived'],
  DISCREPANCY: ['bad', '!', 'Short — check'], RESOLVED: ['neutral', '✓', 'Closed'], COMPLETED: ['ok', '✓', 'Counted this week'], DUE: ['warn', '⏳', 'Count due this week'],
  OVERDUE: ['bad', '!', 'Count overdue'], DRAFT: ['warn', '✎', 'Counting now'], SUBMITTED: ['ok', '✓', 'Signed off'], CANCELLED: ['neutral', '×', 'Cancelled'],
  HIGH: ['bad', '!', 'Urgent'], MEDIUM: ['warn', '▲', 'Soon'], LOW: ['neutral', '•', 'FYI'],
};
export const StatusBadge = ({ s }: { s: string }) => { const [c, i, l] = STATUS[s] ?? ['neutral', '•', s]; return <span className={`badge ${c}`}><span aria-hidden="true">{i}</span>{l}</span>; };

export const ACTION_LABEL: Record<string, string> = {
  SUPPLIER_RECEIPT: 'Stock arrived', CHECKOUT_TO_STAFF: 'Taken from store', PLACE_IN_ROOM: 'Put in room', RETURN_TO_STORE: 'Returned to store',
  TRANSFER_DISPATCH: 'Sent to another hotel', TRANSFER_RECEIPT: 'Arrived from another hotel', TRANSFER_RESOLUTION: 'Missing items written off', WASTE: 'Damaged / thrown away',
  STOCK_ADJUSTMENT: 'Count correction', OPENING_BALANCE: 'Starting stock', REVERSAL: 'Mistake undone',
};

export const fmtTime = (iso: string | Date | null | undefined, tz?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtClock = (iso: string | Date, tz?: string) => new Date(iso).toLocaleTimeString(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit' });

export const ErrorBanner = ({ error }: { error: unknown }) => (error ? <div className="banner bad" role="alert">{errorText(error)}</div> : null);
export const Loading = () => <div className="muted" role="status">Loading…</div>;

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal stack" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row spread"><h2>{title}</h2><button className="link" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

/** "Last updated" indicator with explicit stale state when refetch fails. */
export function Freshness({ asOf, isError, tz }: { asOf?: string; isError: boolean; tz?: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 10000); return () => clearInterval(t); }, []);
  if (!asOf) return null;
  return isError
    ? <span className="badge warn" role="status">Showing {fmtClock(asOf, tz)} — reconnecting…</span>
    : <span className="small faint" role="status">Live · updated {fmtClock(asOf, tz)}</span>;
}

/** Single-series horizontal bar list with hover values and accessible text. */
export function BarList({ rows, unit }: { rows: { label: string; value: number; sub?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars" role="list">
      {rows.map((r) => (
        <div className="bar-row" role="listitem" key={r.label} title={`${r.label}: ${r.value}${unit ? ' ' + unit : ''}`}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}{r.sub && <span className="muted small"> · {r.sub}</span>}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="mono" style={{ textAlign: 'right' }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function downloadUrl(path: string) {
  const a = document.createElement('a'); a.href = '/api/v1' + path; a.rel = 'noopener'; a.click();
}
