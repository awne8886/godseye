/**
 * Market quotes from Yahoo's v8 chart endpoint (keyless, UNOFFICIAL — flagged per quote and in the
 * UI) plus BTC/ETH/SOL from the crypto feed. Probed 2026-09-30: `/v8/finance/chart/%5EGSPC` 200 in
 * 0.36 s, no CORS (server-side only); `meta.regularMarketTime` is the quote's observation time and
 * `meta.currentTradingPeriod.regular` its session window.
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { runProvider, type FeedData, type ProviderRun } from '@/lib/feeds';
import { getJson } from './get-json';
import { providerBucket } from '@/lib/ratelimit';
import type { Candle, MarketRange, Quote } from '@/lib/types';

export interface SymbolDef {
  symbol: string;
  name: string;
  group: Quote['group'];
}

const s = (symbol: string, name: string, group: Quote['group']): SymbolDef => ({ symbol, name, group });

export const SYMBOLS: readonly SymbolDef[] = [
  s('^GSPC', 'S&P 500', 'indices'), s('^IXIC', 'Nasdaq Comp', 'indices'), s('^DJI', 'Dow Jones', 'indices'), s('^FTSE', 'FTSE 100', 'indices'),
  s('^GDAXI', 'DAX', 'indices'), s('^N225', 'Nikkei 225', 'indices'), s('^HSI', 'Hang Seng', 'indices'), s('^VIX', 'VIX', 'indices'),
  s('LMT', 'Lockheed Martin', 'defense'), s('RTX', 'RTX', 'defense'), s('NOC', 'Northrop Grumman', 'defense'), s('GD', 'General Dynamics', 'defense'),
  s('BA.L', 'BAE Systems', 'defense'), s('RHM.DE', 'Rheinmetall', 'defense'),
  s('CL=F', 'WTI Crude', 'energy'), s('BZ=F', 'Brent Crude', 'energy'), s('NG=F', 'Natural Gas', 'energy'),
  s('GC=F', 'Gold', 'commodities'), s('SI=F', 'Silver', 'commodities'), s('HG=F', 'Copper', 'commodities'), s('ZW=F', 'Wheat', 'commodities'),
  s('EURUSD=X', 'EUR/USD', 'fx'), s('GBPUSD=X', 'GBP/USD', 'fx'), s('USDJPY=X', 'USD/JPY', 'fx'), s('USDCNY=X', 'USD/CNY', 'fx'), s('DX-Y.NYB', 'US Dollar Index', 'fx'),
];

/** Symbols /api/markets/history accepts (the quote list plus Yahoo's crypto pairs). */
export const HISTORY_SYMBOLS: ReadonlySet<string> = new Set([...SYMBOLS.map((x) => x.symbol), 'BTC-USD', 'ETH-USD', 'SOL-USD']);

export interface YahooChart {
  chart: {
    result:
      | {
          meta: {
            currency?: string;
            symbol?: string;
            regularMarketPrice?: number;
            regularMarketTime?: number;
            regularMarketChangePercent?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            currentTradingPeriod?: { regular?: { start: number; end: number } };
          };
          timestamp?: number[];
          indicators: { quote: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
        }[]
      | null;
    error: { code: string; description: string } | null;
  };
}

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const yahooLimiter = () => providerBucket('yahoo', 2, 4);

/** Downsample to ≤ n points by stride (keeps the last point). */
export function downsample(v: number[], n = 48): number[] {
  if (v.length <= n) return v;
  const step = v.length / n;
  const out: number[] = [];
  for (let i = 0; i < n - 1; i++) out.push(v[Math.floor(i * step)]!);
  out.push(v[v.length - 1]!);
  return out;
}

export function quoteFromChart(def: SymbolDef, body: YahooChart, now = Date.now()): Quote | null {
  const r = body.chart.result?.[0];
  if (!r) return null;
  const m = r.meta;
  const price = typeof m.regularMarketPrice === 'number' ? m.regularMarketPrice : null;
  if (price === null) return null;
  const prev = m.chartPreviousClose ?? m.previousClose ?? null;
  const changePct = typeof m.regularMarketChangePercent === 'number' ? m.regularMarketChangePercent : prev ? ((price - prev) / prev) * 100 : null;
  const closes = (r.indicators.quote[0]?.close ?? []).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const reg = m.currentTradingPeriod?.regular;
  const nowS = now / 1000;
  return {
    symbol: def.symbol,
    name: def.name,
    group: def.group,
    price,
    changePct: changePct === null ? null : Math.round(changePct * 1000) / 1000,
    currency: m.currency ?? null,
    spark: downsample(closes),
    marketOpen: reg ? nowS >= reg.start && nowS < reg.end : null,
    observedAt: typeof m.regularMarketTime === 'number' ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    source: 'yahoo',
    unofficial: true,
  };
}

export async function fetchQuote(def: SymbolDef, signal?: AbortSignal): Promise<Quote | null> {
  const r = await getJson<YahooChart>(`${YAHOO}${encodeURIComponent(def.symbol)}?range=1d&interval=15m`, { timeoutMs: 8000, retries: 1, signal, limiter: yahooLimiter() });
  return quoteFromChart(def, r.data);
}

/** All Yahoo quotes as ONE provider (`yahoo`): count = instruments answered. */
export async function runYahooQuotes(signal?: AbortSignal): Promise<{ quotes: Quote[]; run: ProviderRun }> {
  const { result, run } = await runProvider(
    async () => {
      const settled = await Promise.allSettled(SYMBOLS.map((d) => fetchQuote(d, signal)));
      const quotes = settled.flatMap((x) => (x.status === 'fulfilled' && x.value ? [x.value] : []));
      if (!quotes.length) {
        const firstErr = settled.find((x) => x.status === 'rejected');
        if (firstErr && firstErr.status === 'rejected') throw firstErr.reason;
      }
      return quotes;
    },
    (q) => q.length,
  );
  return { quotes: result ?? [], run };
}

export const RANGE_PARAMS: Record<MarketRange, { range: string; interval: string }> = {
  '1m': { range: '1d', interval: '1m' },
  '15m': { range: '5d', interval: '15m' },
  '24H': { range: '1d', interval: '5m' },
  '1W': { range: '5d', interval: '60m' },
  '1M': { range: '1mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1wk' },
};

export function candlesFromChart(body: YahooChart): { candles: Candle[]; currency: string | null } {
  const r = body.chart.result?.[0];
  if (!r) return { candles: [], currency: null };
  const q = r.indicators.quote[0] ?? {};
  const candles: Candle[] = [];
  (r.timestamp ?? []).forEach((t, i) => {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if ([o, h, l, c].every((x) => typeof x === 'number' && Number.isFinite(x))) {
      const v = q.volume?.[i];
      candles.push({ time: t, open: o!, high: h!, low: l!, close: c!, volume: typeof v === 'number' ? v : null });
    }
  });
  return { candles, currency: r.meta.currency ?? null };
}

export interface HistoryData {
  symbol: string;
  range: MarketRange;
  interval: string;
  currency: string | null;
  candles: Candle[];
}

export async function runHistory(symbol: string, range: MarketRange, signal?: AbortSignal): Promise<FeedData<HistoryData>> {
  const p = RANGE_PARAMS[range];
  const { result, run } = await runProvider(
    async () => {
      const r = await getJson<YahooChart>(`${YAHOO}${encodeURIComponent(symbol)}?range=${p.range}&interval=${p.interval}`, { timeoutMs: 10_000, retries: 1, signal, limiter: yahooLimiter() });
      return candlesFromChart(r.data);
    },
    (x) => x.candles.length,
  );
  const candles = result?.candles ?? [];
  const last = candles.at(-1);
  return { data: { symbol, range, interval: p.interval, currency: result?.currency ?? null, candles }, providers: { yahoo: run }, observedAt: last ? last.time * 1000 : null };
}
