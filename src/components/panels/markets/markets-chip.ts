/**
 * MARKETS panel state chip (§0: never LIVE unless a live-observed quote is on screen).
 * - feed not live → its state (RECENT / STALE / OFFLINE);
 * - the Yahoo provider failed → SOURCE OFFLINE with the time it last answered (the board shows the
 *   last-good quotes, each with its own observation time) — never DELAYED;
 * - every exchange session closed → CLOSED;
 * - any exchange-traded quote from an unofficial/delayed source (Yahoo v8 chart) → DELAYED;
 * - LIVE only when every exchange-traded quote comes from an official live source.
 * Crypto trades 24/7 on its own sources and does not make the equity board LIVE.
 * Owner: panels-alerts-markets-dossier-graph. Pure (tested).
 */
import type { ChipTone } from '@/components/hud/PanelChrome';
import type { MarketsResponse } from '@/lib/types';

type ChipInput = Pick<MarketsResponse, 'meta' | 'sessions' | 'quotes'> & Partial<Pick<MarketsResponse, 'providers'>>;

/** "HH:MM UTC" on the same UTC day as `now`, else "YYYY-MM-DD HH:MM UTC". */
export function utcLabel(iso: string, now = Date.now()): string {
  const sameDay = iso.slice(0, 10) === new Date(now).toISOString().slice(0, 10);
  return `${sameDay ? iso.slice(11, 16) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`} UTC`;
}

/** When the exchange-quote source last answered: the newest `lastGoodAt` of the kept Yahoo quotes. */
export function yahooLastGood(quotes: MarketsResponse['quotes']): string | null {
  let best: string | null = null;
  for (const q of quotes) if (q.source === 'yahoo' && q.lastGoodAt && (!best || Date.parse(q.lastGoodAt) > Date.parse(best))) best = q.lastGoodAt;
  return best;
}

export function marketsChip(d: ChipInput, now = Date.now()): { text: string; tone: ChipTone; title?: string } {
  if (d.meta.state !== 'live') return { text: d.meta.state.toUpperCase(), tone: 'warn' };
  const y = d.providers?.yahoo;
  if (y && !y.ok && !y.skipped) {
    const at = yahooLastGood(d.quotes);
    const label = at ? utcLabel(at, now) : null;
    return {
      text: label ? `SOURCE OFFLINE · ${label.replace(' UTC', 'Z')}` : 'SOURCE OFFLINE',
      tone: 'error',
      title: `Yahoo chart endpoint offline (${y.error ?? 'error'})${label ? ` — last good ${label}` : ' — no exchange quotes yet'}`,
    };
  }
  if (d.sessions.length > 0 && d.sessions.every((s) => !s.open)) return { text: 'CLOSED', tone: 'idle' };
  const board = d.quotes.filter((q) => q.group !== 'crypto' && q.price !== null);
  if (board.length === 0 || board.some((q) => q.unofficial)) return { text: 'DELAYED', tone: 'warn' };
  return { text: 'LIVE', tone: 'live' };
}
