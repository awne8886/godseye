/**
 * BTC/ETH/SOL spot prices, keyless first: Binance public data API → Coinbase Exchange → Kraken;
 * CoinGecko only with the `coingecko_demo` key (keyless CoinGecko 429s on shared egress, 2026-09-30).
 * A later provider only fills symbols the earlier ones did not answer. Each quote keeps its own
 * provider and observation time (Binance `closeTime`, Coinbase `time`, CoinGecko `last_updated_at`;
 * Kraken's ticker carries no timestamp, so its observedAt is null rather than invented).
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { runProvider, skippedProvider, type FeedData, type ProviderRun } from '@/lib/feeds';
import { hasCapability } from '@/lib/capabilities';
import { getJson } from './get-json';
import { providerBucket } from '@/lib/ratelimit';

export const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL'] as const;
export type CryptoSymbol = (typeof CRYPTO_SYMBOLS)[number];

export interface CryptoQuote {
  symbol: CryptoSymbol;
  priceUsd: number;
  changePct24h: number | null;
  source: string;
  observedAt: string | null;
}

export interface CryptoData {
  items: CryptoQuote[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const iso = (ms: number | null) => (ms !== null && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  closeTime: number;
}

export function parseBinance(rows: BinanceTicker[]): CryptoQuote[] {
  const out: CryptoQuote[] = [];
  for (const r of rows) {
    const sym = CRYPTO_SYMBOLS.find((s) => r.symbol === `${s}USDT`);
    const price = num(r.lastPrice);
    if (!sym || price === null) continue;
    out.push({ symbol: sym, priceUsd: price, changePct24h: num(r.priceChangePercent), source: 'binance', observedAt: iso(num(r.closeTime)) });
  }
  return out;
}

export function parseCoinbase(sym: CryptoSymbol, ticker: { price?: string; time?: string }, stats: { open?: string } | null): CryptoQuote | null {
  const price = num(ticker.price);
  if (price === null) return null;
  const open = stats ? num(stats.open) : null;
  const t = ticker.time ? Date.parse(ticker.time) : NaN;
  return { symbol: sym, priceUsd: price, changePct24h: open ? ((price - open) / open) * 100 : null, source: 'coinbase', observedAt: Number.isFinite(t) ? new Date(t).toISOString() : null };
}

const KRAKEN_PAIRS: Record<string, CryptoSymbol> = { XXBTZUSD: 'BTC', XBTUSD: 'BTC', XETHZUSD: 'ETH', ETHUSD: 'ETH', SOLUSD: 'SOL' };

export function parseKraken(body: { error?: string[]; result?: Record<string, { c?: string[]; o?: string }> }): CryptoQuote[] {
  const out: CryptoQuote[] = [];
  for (const [pair, t] of Object.entries(body.result ?? {})) {
    const sym = KRAKEN_PAIRS[pair];
    const price = num(t.c?.[0]);
    if (!sym || price === null) continue;
    const open = num(t.o);
    // 24 h change vs today's opening price (Kraken `o`); Kraken gives no quote timestamp.
    out.push({ symbol: sym, priceUsd: price, changePct24h: open ? ((price - open) / open) * 100 : null, source: 'kraken', observedAt: null });
  }
  return out;
}

const CG_IDS: Record<string, CryptoSymbol> = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL' };

export function parseCoinGecko(body: Record<string, { usd?: number; usd_24h_change?: number; last_updated_at?: number }>): CryptoQuote[] {
  const out: CryptoQuote[] = [];
  for (const [id, v] of Object.entries(body)) {
    const sym = CG_IDS[id];
    if (!sym || typeof v.usd !== 'number') continue;
    out.push({ symbol: sym, priceUsd: v.usd, changePct24h: num(v.usd_24h_change), source: 'coingecko', observedAt: v.last_updated_at ? iso(v.last_updated_at * 1000) : null });
  }
  return out;
}

type Fetcher = (missing: CryptoSymbol[], signal?: AbortSignal) => Promise<CryptoQuote[]>;

const PROVIDERS: { name: string; fetch: Fetcher; gate?: () => ProviderRun | null }[] = [
  {
    name: 'binance',
    fetch: async (missing, signal) => {
      const symbols = JSON.stringify(missing.map((s) => `${s}USDT`));
      const r = await getJson<BinanceTicker[]>(`https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`, { timeoutMs: 8000, signal, limiter: providerBucket('binance', 5, 5) });
      return parseBinance(r.data);
    },
  },
  {
    name: 'coinbase',
    fetch: async (missing, signal) => {
      const out: CryptoQuote[] = [];
      for (const s of missing) {
        const base = `https://api.exchange.coinbase.com/products/${s}-USD`;
        const t = await getJson<{ price?: string; time?: string }>(`${base}/ticker`, { timeoutMs: 8000, signal, limiter: providerBucket('coinbase', 3, 3) });
        const st = await getJson<{ open?: string }>(`${base}/stats`, { timeoutMs: 8000, signal, limiter: providerBucket('coinbase', 3, 3) }).catch(() => null);
        const q = parseCoinbase(s, t.data, st?.data ?? null);
        if (q) out.push(q);
      }
      return out;
    },
  },
  {
    name: 'kraken',
    fetch: async (missing, signal) => {
      const pairs = missing.map((s) => (s === 'BTC' ? 'XBTUSD' : `${s}USD`)).join(',');
      const r = await getJson<Parameters<typeof parseKraken>[0]>(`https://api.kraken.com/0/public/Ticker?pair=${pairs}`, { timeoutMs: 8000, signal, limiter: providerBucket('kraken', 1, 2) });
      return parseKraken(r.data);
    },
  },
  {
    name: 'coingecko',
    gate: () => (hasCapability('coingecko_demo') ? null : skippedProvider('not-configured')),
    fetch: async (missing, signal) => {
      const ids = Object.entries(CG_IDS)
        .filter(([, s]) => missing.includes(s))
        .map(([id]) => id)
        .join(',');
      const r = await getJson<Parameters<typeof parseCoinGecko>[0]>(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`, {
        timeoutMs: 8000,
        signal,
        headers: { 'x-cg-demo-api-key': process.env.COINGECKO_DEMO_KEY ?? '' },
        limiter: providerBucket('coingecko', 0.5, 1),
      });
      return parseCoinGecko(r.data);
    },
  },
];

/** Provider fallback in order; stops once every symbol has a quote. */
export async function runCrypto(ctx: { signal?: AbortSignal } = {}): Promise<FeedData<CryptoData>> {
  const providers: Record<string, ProviderRun> = {};
  const got = new Map<CryptoSymbol, CryptoQuote>();
  for (const p of PROVIDERS) {
    const missing = CRYPTO_SYMBOLS.filter((s) => !got.has(s));
    if (!missing.length) break;
    const skipped = p.gate?.();
    if (skipped) {
      providers[p.name] = skipped;
      continue;
    }
    const { result, run } = await runProvider(() => p.fetch(missing, ctx.signal), (r) => r.filter((q) => missing.includes(q.symbol)).length);
    providers[p.name] = run;
    for (const q of result ?? []) if (missing.includes(q.symbol) && !got.has(q.symbol)) got.set(q.symbol, q);
  }
  const items = CRYPTO_SYMBOLS.map((s) => got.get(s)).filter((q): q is CryptoQuote => !!q);
  const newest = items.reduce<number | null>((m, q) => (q.observedAt ? Math.max(m ?? 0, Date.parse(q.observedAt)) : m), null);
  return { data: { items }, providers, observedAt: newest };
}
