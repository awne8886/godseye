/**
 * Display helpers for the PATHS panel. Pure; local times are shown with their UTC offset from the
 * server's LocalTime strings (never re-interpreted in the browser's zone). Client-safe.
 */
import { splitLocal } from '../lib/time';

export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}H ${String(m).padStart(2, '0')}M`;
}

export function fmtOffsetHours(h: number | null): string {
  if (h === null) return '—';
  const sign = h > 0 ? '+' : h < 0 ? '−' : '±';
  const abs = Math.abs(h);
  const whole = Math.floor(abs);
  const min = Math.round((abs - whole) * 60);
  return `${sign}${whole}${min ? `:${String(min).padStart(2, '0')}` : ''}H`;
}

/** `13:05 +01:00` from a LocalTime string. */
export function fmtLocal(iso: string | null | undefined): string {
  if (!iso) return '—';
  const { hhmm, offset } = splitLocal(iso);
  return `${hhmm} ${offset.replace(/^\+00:00$/, 'UTC')}`.trim();
}

/** `20:02Z` from an ISO UTC string. */
export function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]}Z` : '—';
}

export function fmtKm(km: number): string {
  return `${Math.round(km).toLocaleString('en-US')} KM`;
}

export function fmtNm(nm: number): string {
  return `${Math.round(nm).toLocaleString('en-US')} NM`;
}

export const FLT_TOKEN = { VFR: 'var(--flt-vfr)', MVFR: 'var(--flt-mvfr)', IFR: 'var(--flt-ifr)', LIFR: 'var(--flt-lifr)' } as const;

export const TWILIGHT_TOKEN = {
  day: 'var(--gold-light)',
  civil: 'var(--gold-dim)',
  nautical: 'var(--alert-blue)',
  astronomical: 'var(--cyan-dim)',
  night: 'var(--bg-tertiary)',
} as const;

/** Path types in legend order with what each one honestly means. */
export const PATH_TYPES = [
  { label: 'FILED', token: 'var(--map-route-filed)', meaning: 'A filed or sim-community plan with waypoints (keyed sources only).' },
  { label: 'TYPICAL', token: 'var(--text-secondary)', meaning: 'A typical flown routing. No keyless source provides one yet.' },
  { label: 'GREAT-CIRCLE ESTIMATE', token: 'var(--map-route-planned)', meaning: 'Shortest path over the Earth. Real flights deviate for winds, airways and airspace.' },
] as const;

/** Airport code shown to people: IATA, else ICAO, else ident. */
export const codeOf = (a: { iata: string | null; icao: string | null; ident: string }) => a.iata ?? a.icao ?? a.ident;
