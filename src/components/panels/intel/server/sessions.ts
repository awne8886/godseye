/**
 * Exchange trading sessions (SESSION OPEN/CLOSED) from each exchange's regular hours in its own
 * IANA time zone, so daylight-saving shifts are handled by Intl, not by fixed offsets. Public
 * holidays and half days are NOT modelled (stated in the markets feed note).
 * Owner: panels-alerts-markets-dossier-graph. Isomorphic (pure).
 */
import type { MarketSession } from '@/lib/types';

export interface ExchangeHours {
  exchange: string;
  name: string;
  tz: string;
  /** Local [open, close] minute-of-day ranges on Monday–Friday (lunch breaks split the day). */
  ranges: readonly (readonly [number, number])[];
}

const hm = (h: number, m = 0) => h * 60 + m;

export const EXCHANGES: readonly ExchangeHours[] = [
  { exchange: 'NYSE', name: 'New York Stock Exchange', tz: 'America/New_York', ranges: [[hm(9, 30), hm(16)]] },
  { exchange: 'NASDAQ', name: 'Nasdaq', tz: 'America/New_York', ranges: [[hm(9, 30), hm(16)]] },
  { exchange: 'TSX', name: 'Toronto Stock Exchange', tz: 'America/Toronto', ranges: [[hm(9, 30), hm(16)]] },
  { exchange: 'B3', name: 'B3 São Paulo', tz: 'America/Sao_Paulo', ranges: [[hm(10), hm(17)]] },
  { exchange: 'LSE', name: 'London Stock Exchange', tz: 'Europe/London', ranges: [[hm(8), hm(16, 30)]] },
  { exchange: 'XETRA', name: 'Deutsche Börse Xetra', tz: 'Europe/Berlin', ranges: [[hm(9), hm(17, 30)]] },
  { exchange: 'EURONEXT', name: 'Euronext Paris', tz: 'Europe/Paris', ranges: [[hm(9), hm(17, 30)]] },
  { exchange: 'NSE', name: 'National Stock Exchange of India', tz: 'Asia/Kolkata', ranges: [[hm(9, 15), hm(15, 30)]] },
  { exchange: 'SSE', name: 'Shanghai Stock Exchange', tz: 'Asia/Shanghai', ranges: [[hm(9, 30), hm(11, 30)], [hm(13), hm(15)]] },
  { exchange: 'HKEX', name: 'Hong Kong Exchanges', tz: 'Asia/Hong_Kong', ranges: [[hm(9, 30), hm(12)], [hm(13), hm(16)]] },
  { exchange: 'TSE', name: 'Tokyo Stock Exchange', tz: 'Asia/Tokyo', ranges: [[hm(9), hm(11, 30)], [hm(12, 30), hm(15, 30)]] },
  { exchange: 'ASX', name: 'Australian Securities Exchange', tz: 'Australia/Sydney', ranges: [[hm(10), hm(16)]] },
];

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };

/** Local weekday (0 = Sunday) and minute-of-day at `ms` in time zone `tz`. */
export function localClock(ms: number, tz: string): { weekday: number; minute: number } {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    FORMATTERS.set(tz, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { weekday: WEEKDAY[get('weekday')] ?? 0, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function isOpen(ex: ExchangeHours, ms: number): boolean {
  const { weekday, minute } = localClock(ms, ex.tz);
  if (weekday === 0 || weekday === 6) return false;
  return ex.ranges.some(([a, b]) => minute >= a && minute < b);
}

const QUARTER = 15 * 60_000;

/**
 * Next open/close transition. Every listed boundary is on a local quarter hour and every zone
 * here is offset by a multiple of 15 min, so stepping UTC quarter hours finds it exactly.
 */
export function nextChange(ex: ExchangeHours, ms: number): number | null {
  const open = isOpen(ex, ms);
  let t = Math.floor(ms / QUARTER) * QUARTER + QUARTER;
  for (let i = 0; i < 4 * 24 * 8; i++, t += QUARTER) {
    if (isOpen(ex, t) !== open) return t;
  }
  return null;
}

export function sessionsAt(ms: number): MarketSession[] {
  return EXCHANGES.map((ex) => {
    const next = nextChange(ex, ms);
    return { exchange: ex.exchange, name: ex.name, tz: ex.tz, open: isOpen(ex, ms), nextChangeAt: next === null ? null : new Date(next).toISOString() };
  });
}
