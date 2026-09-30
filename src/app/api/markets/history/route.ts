/**
 * GET /api/markets/history?symbol=GC%3DF&range=1M — OHLC candles for one allow-listed symbol
 * (Yahoo chart endpoint, unofficial). Owner: panels-alerts-markets-dossier-graph.
 */
import { z } from 'zod';
import { HISTORY_SYMBOLS, runHistory, type HistoryData } from '@/components/panels/intel/server/markets';
import { lookup } from '@/components/panels/intel/server/lookup';
import { feedJson, parseQuery, withRoute } from '@/lib/respond';
import { MarketRange } from '@/lib/schemas/intel';

export const dynamic = 'force-dynamic';

const Query = z.object({
  symbol: z
    .string()
    .min(1)
    .max(20)
    .refine((s) => HISTORY_SYMBOLS.has(s), 'symbol is not on the allow-list'),
  range: MarketRange.default('1M'),
});

export const GET = withRoute('/api/markets/history', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const { symbol, range } = q.data;
  const r = await lookup<HistoryData>(`markets-history:${symbol}:${range}`, {
    feed: 'markets-history',
    ttlMs: range === '1m' || range === '15m' || range === '24H' ? 60_000 : 15 * 60_000,
    attribution: [{ text: 'Yahoo Finance chart endpoint (unofficial, delayed per exchange rules)', url: 'https://finance.yahoo.com/' }],
    isEmpty: (d) => d.candles.length === 0,
    run: (signal) => runHistory(symbol, range, signal),
  });
  return feedJson(req, r, (d) => ({ symbol: d.symbol, range: d.range, interval: d.interval, currency: d.currency, candles: d.candles }));
});
