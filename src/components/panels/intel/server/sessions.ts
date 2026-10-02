/**
 * Exchange trading sessions (SESSION OPEN/CLOSED) from each exchange's regular hours in its own
 * IANA time zone, so daylight-saving shifts are handled by Intl, not by fixed offsets. Full-day
 * closures are modelled only where a calendar was sourced (HOLIDAYS below, 2026); every other
 * exchange/year reports `holidaysModelled: false` and the panel says so. Half days are not modelled.
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

/**
 * Full-day closures in each exchange's local calendar. Sources (retrieved 2026-09-30):
 * NYSE/Nasdaq — nyse.com/markets/hours-calendars (2026 column); LSE — gov.uk/bank-holidays.json
 * (England and Wales; LSE closes on these); SSE — Shanghai Futures Exchange circular 2025-12-17
 * "Trading Schedule during National Holidays for Year 2026" (the mainland exchanges share the State
 * Council calendar); HKEX — the HKSAR general-holiday calendar published by the 1823 contact centre,
 * https://www.1823.gov.hk/common/ical/en.json (retrieved 2026-10-01, re-checked 2026-10-02): the HKEX
 * securities market closes on every general holiday that falls on a weekday (the 14 below; Apr 4,
 * Sep 26 and Dec 26 fall on Saturdays). Half-day sessions (Lunar New Year's Eve, Christmas Eve, New
 * Year's Eve: morning session only) and weather closures (typhoon signal 8, black rainstorm) are NOT
 * modelled; on those days the panel shows the full regular session.
 */
const US_2026 = ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'];
export const HOLIDAYS: Readonly<Record<string, { years: readonly number[]; dates: ReadonlySet<string> }>> = {
  NYSE: { years: [2026], dates: new Set(US_2026) },
  NASDAQ: { years: [2026], dates: new Set(US_2026) },
  LSE: { years: [2026], dates: new Set(['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28']) },
  SSE: {
    years: [2026],
    dates: new Set([
      ...range('2026-01-01', 3),
      ...range('2026-02-15', 9),
      ...range('2026-04-04', 3),
      ...range('2026-05-01', 5),
      ...range('2026-06-19', 3),
      ...range('2026-09-25', 3),
      ...range('2026-10-01', 7),
    ]),
  },
  HKEX: {
    years: [2026],
    dates: new Set(['2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19', '2026-04-03', '2026-04-06', '2026-04-07', '2026-05-01', '2026-05-25', '2026-06-19', '2026-07-01', '2026-10-01', '2026-10-19', '2026-12-25']),
  },
};

function range(start: string, days: number): string[] {
  const t = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(t + i * 86_400_000).toISOString().slice(0, 10));
}

/** True when a sourced holiday calendar covers this exchange for the local year at `ms`. */
export function holidaysModelled(ex: ExchangeHours, ms: number): boolean {
  const h = HOLIDAYS[ex.exchange];
  return !!h && h.years.includes(Number(localClock(ms, ex.tz).date.slice(0, 4)));
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };

/** Local weekday (0 = Sunday), minute-of-day and date (YYYY-MM-DD) at `ms` in time zone `tz`. */
export function localClock(ms: number, tz: string): { weekday: number; minute: number; date: string } {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    FORMATTERS.set(tz, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { weekday: WEEKDAY[get('weekday')] ?? 0, minute: Number(get('hour')) * 60 + Number(get('minute')), date: `${get('year')}-${get('month')}-${get('day')}` };
}

export function isOpen(ex: ExchangeHours, ms: number): boolean {
  const { weekday, minute, date } = localClock(ms, ex.tz);
  if (weekday === 0 || weekday === 6) return false;
  if (HOLIDAYS[ex.exchange]?.dates.has(date)) return false;
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
  for (let i = 0; i < 4 * 24 * 16; i++, t += QUARTER) {
    if (isOpen(ex, t) !== open) return t;
  }
  return null;
}

export function sessionsAt(ms: number): MarketSession[] {
  return EXCHANGES.map((ex) => {
    const next = nextChange(ex, ms);
    return { exchange: ex.exchange, name: ex.name, tz: ex.tz, open: isOpen(ex, ms), nextChangeAt: next === null ? null : new Date(next).toISOString(), holidaysModelled: holidaysModelled(ex, ms) };
  });
}
