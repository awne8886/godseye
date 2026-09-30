/**
 * MARKETS panel state chip (§0: never LIVE unless a live-observed quote is on screen).
 * - feed not live → its state (RECENT / STALE);
 * - every exchange session closed → CLOSED;
 * - any exchange-traded quote from an unofficial/delayed source (Yahoo v8 chart) → DELAYED;
 * - LIVE only when every exchange-traded quote comes from an official live source.
 * Crypto trades 24/7 on its own sources and does not make the equity board LIVE.
 * Owner: panels-alerts-markets-dossier-graph. Pure (tested).
 */
import type { ChipTone } from '@/components/hud/PanelChrome';
import type { MarketsResponse } from '@/lib/types';

export function marketsChip(d: Pick<MarketsResponse, 'meta' | 'sessions' | 'quotes'>): { text: string; tone: ChipTone } {
  if (d.meta.state !== 'live') return { text: d.meta.state.toUpperCase(), tone: 'warn' };
  if (d.sessions.length > 0 && d.sessions.every((s) => !s.open)) return { text: 'CLOSED', tone: 'idle' };
  const board = d.quotes.filter((q) => q.group !== 'crypto' && q.price !== null);
  if (board.length === 0 || board.some((q) => q.unofficial)) return { text: 'DELAYED', tone: 'warn' };
  return { text: 'LIVE', tone: 'live' };
}
