/**
 * Server-side feeds for Live Alerts, markets, crypto, ticker, chain brief and supply chain.
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { defineFeed, type Feed, type FeedData, type FeedResult, type ProviderRun } from '@/lib/feeds';
import { earthquakeFeed } from '@/features/hazards/server/usgs';
import type { MarketsResponse, Quote, TickerResponse } from '@/lib/types';
import { runNews, type NewsData } from './server/news';
import { runCrypto, type CryptoData } from './server/crypto';
import { SYMBOLS, runYahooQuotes } from './server/markets';
import { sessionsAt } from './server/sessions';
import { runChain, type ChainData } from './server/chain';
import { InputDown, chokepointAlerts, runFromFeed, runScm, type ScmData } from './server/scm';

const MIN = 60_000;

export const NEWS_ATTRIBUTION = [
  { text: 'Public Telegram channel previews (t.me/s); each post links to its source and states the channel’s declared perspective', url: 'https://t.me/' },
  { text: 'Wire RSS: BBC, The Guardian, Al Jazeera, France 24, DW, NYT, Times of Israel, TASS, Anadolu, SCMP, CNA, Africanews (headlines link to the publisher)' },
];

export const newsFeed = defineFeed<NewsData>({
  key: 'news',
  // Rebuild (merge, dedupe, geoparse) every 60 s from the per-source caches (Telegram 3 min, wire 2 min).
  ttlMs: MIN,
  pollMs: MIN,
  kind: 'live',
  attribution: NEWS_ATTRIBUTION,
  note: 'Claims from partisan channels are shown with their declared stance; posts are not verified. Pins are keyword geoparsed (precision shown).',
  count: (d) => d.items.length,
  eager: true,
  retryAfterErrorMs: MIN,
  deadlineMs: 40_000,
  run: (ctx) => runNews(ctx, Date.now(), recordAttempt('news')),
});

/**
 * /api/news: when every source is down the feed serves its last-good posts as STALE → OFFLINE; the
 * latest attempt's failures are overlaid on `providers` and on each source's `ok` flag.
 */
export async function getNews(now = Date.now()): Promise<FeedResult<NewsData>> {
  const r = withLatestAttempt('news', await newsFeed.get(), now);
  const a = attempts.get('news');
  if (!r.data || (r.meta.state !== 'stale' && r.meta.state !== 'offline') || !a) return r;
  if (r.meta.fetchedAt && a.at < Date.parse(r.meta.fetchedAt)) return r;
  const failed = new Set(Object.entries(a.providers).filter(([, p]) => !p.status.ok).map(([k]) => k.slice(k.indexOf(':') + 1)));
  return { ...r, data: { ...r.data, sources: r.data.sources.map((s) => (failed.has(s.handle) ? { ...s, ok: false } : s)) } };
}

export const cryptoFeed = defineFeed<CryptoData>({
  key: 'crypto',
  ttlMs: MIN,
  kind: 'live',
  attribution: [
    { text: 'Binance public market data (data-api.binance.vision)', url: 'https://developers.binance.com/docs/binance-spot-api-docs' },
    { text: 'Coinbase Exchange public ticker', url: 'https://docs.cdp.coinbase.com/exchange/' },
    { text: 'Kraken public ticker', url: 'https://docs.kraken.com/api/' },
    { text: 'CoinGecko (demo key only)', url: 'https://www.coingecko.com/en/api' },
  ],
  count: (d) => d.items.length,
  retryAfterErrorMs: 30_000,
  run: (ctx) => runCrypto(ctx),
});

export interface MarketsData {
  quotes: Quote[];
  breadth: MarketsResponse['breadth'];
  scmAlerts: MarketsResponse['scmAlerts'];
  /** When Yahoo last answered (ms epoch): the yahoo provider's age while it is failing. Not served. */
  yahooOkAt?: number | null;
}

export function breadthOf(quotes: readonly Quote[]): MarketsResponse['breadth'] {
  const b = { up: 0, down: 0, flat: 0 };
  for (const q of quotes) {
    if (q.changePct === null) continue;
    if (q.changePct > 0.005) b.up++;
    else if (q.changePct < -0.005) b.down++;
    else b.flat++;
  }
  return b;
}

/**
 * Latest attempt per derived/aggregate feed (in-process). When a run fails, the cache keeps the
 * last-good snapshot together with that snapshot's providers; `withLatestAttempt` overlays the
 * providers that failed on the latest attempt, so a STALE/OFFLINE response never reports a failing
 * input as ok.
 */
const attempts = new Map<string, { at: number; providers: Record<string, ProviderRun> }>();
const recordAttempt = (key: string) => (providers: Record<string, ProviderRun>) => {
  attempts.set(key, { at: Date.now(), providers });
};

export function withLatestAttempt<T>(key: string, r: FeedResult<T>, now = Date.now()): FeedResult<T> {
  if (r.meta.state !== 'stale' && r.meta.state !== 'offline') return r;
  const a = attempts.get(key);
  if (!a || (r.meta.fetchedAt && a.at < Date.parse(r.meta.fetchedAt))) return r;
  const providers = { ...r.providers };
  for (const [name, run] of Object.entries(a.providers)) {
    if (run.status.ok) continue;
    providers[name] = { ...run.status, age_s: run.okAt ? Math.max(0, Math.round((now - run.okAt) / 1000)) : null };
  }
  return { ...r, providers };
}

/**
 * Every Yahoo symbol the latest run did not return keeps its previous quote, marked with
 * `lastGoodAt` (when Yahoo last answered for it): a failing upstream never empties the board.
 */
export function mergeYahoo(fresh: readonly Quote[], previous: MarketsData | null): Quote[] {
  const bySymbol = new Map(fresh.map((q) => [q.symbol, q]));
  const prevAt = previous?.yahooOkAt ? new Date(previous.yahooOkAt).toISOString() : null;
  const out: Quote[] = [];
  for (const def of SYMBOLS) {
    const f = bySymbol.get(def.symbol);
    if (f) {
      out.push(f);
      continue;
    }
    const p = previous?.quotes.find((q) => q.symbol === def.symbol && q.source === 'yahoo');
    if (!p) continue;
    const lastGoodAt = p.lastGoodAt ?? prevAt;
    // The session flag computed at the old fetch time says nothing about now.
    out.push({ ...p, marketOpen: null, ...(lastGoodAt ? { lastGoodAt } : {}) });
  }
  return out;
}

export async function runMarkets(
  ctx: { signal?: AbortSignal; previous?: MarketsData | null } = {},
  onAttempt?: (providers: Record<string, ProviderRun>) => void,
): Promise<FeedData<MarketsData>> {
  const [yahoo, crypto, scm] = await Promise.all([runYahooQuotes(ctx.signal), cryptoFeed.get(), chokepointAlerts()]);
  const previous = ctx.previous ?? null;
  const cryptoQuotes: Quote[] = (crypto.data?.items ?? []).map((c) => ({
    symbol: c.symbol,
    name: c.symbol === 'BTC' ? 'Bitcoin' : c.symbol === 'ETH' ? 'Ether' : 'Solana',
    group: 'crypto',
    price: c.priceUsd,
    changePct: c.changePct24h === null ? null : Math.round(c.changePct24h * 1000) / 1000,
    currency: 'USD',
    spark: [],
    marketOpen: true,
    observedAt: c.observedAt,
    source: c.source,
    unofficial: false,
  }));
  const yahooQuotes = mergeYahoo(yahoo.quotes, previous);
  const yahooOkAt = yahoo.run.okAt ?? previous?.yahooOkAt ?? null;
  // A failed Yahoo run keeps the time it last answered, so its age_s keeps growing.
  const yahooRun: ProviderRun = yahoo.run.status.ok ? yahoo.run : { status: yahoo.run.status, okAt: yahooOkAt };
  const quotes = [...yahooQuotes, ...cryptoQuotes];
  const providers: Record<string, ProviderRun> = { yahoo: yahooRun, crypto: runFromFeed(crypto.meta, cryptoQuotes.length, crypto.data !== null), maritime: scm.run };
  onAttempt?.(providers);
  // Nothing fresh at all: fail the run so the cache serves the last-good board as STALE, then OFFLINE.
  if (!yahooRun.status.ok && !providers.crypto!.status.ok) throw new InputDown('yahoo and crypto');
  const newest = quotes.reduce<number | null>((m, q) => (q.observedAt ? Math.max(m ?? 0, Date.parse(q.observedAt)) : m), null);
  return { data: { quotes, breadth: breadthOf(quotes), scmAlerts: scm.alerts, yahooOkAt }, providers, observedAt: newest };
}

export const marketsFeed = defineFeed<MarketsData>({
  key: 'markets',
  ttlMs: 2 * MIN,
  kind: 'live',
  attribution: [
    { text: 'Quotes: Yahoo Finance chart endpoint (unofficial, delayed per exchange rules)', url: 'https://finance.yahoo.com/' },
    { text: 'Crypto: Binance / Coinbase / Kraken public tickers' },
  ],
  note: 'Exchange sessions are computed from regular trading hours in each exchange time zone; 2026 full-day holidays are modelled for NYSE, Nasdaq, LSE, SSE and HKEX only (sessions[].holidaysModelled) — other holidays and half days are not modelled.',
  count: (d) => d.quotes.length,
  eager: true,
  retryAfterErrorMs: MIN,
  deadlineMs: 40_000,
  run: (ctx) => runMarkets(ctx, recordAttempt('markets')),
});

/** /api/markets: the feed result with the latest attempt's failed providers when it is stale/offline. */
export async function getMarkets(): Promise<FeedResult<MarketsData>> {
  return withLatestAttempt('markets', await marketsFeed.get());
}

/** Sessions are computed at response time (they change on the minute, not on the feed TTL). */
export const marketSessions = (now = Date.now()) => sessionsAt(now);

export interface TickerData {
  crypto: TickerResponse['crypto'];
  quakes: TickerResponse['quakes'];
}

/**
 * Ticker rows from the crypto and earthquake feeds. Its state follows its inputs: when neither is
 * fresh the run fails, so the cache serves the last-good rows as STALE → OFFLINE (never LIVE on
 * last-good inputs); with one input down the other stays live and `providers` names the failure.
 */
export async function runTicker(onAttempt?: (providers: Record<string, ProviderRun>) => void): Promise<FeedData<TickerData>> {
  const [crypto, quakes] = await Promise.all([cryptoFeed.get(), earthquakeFeed().get()]);
  const c = (crypto.data?.items ?? []).map((q) => ({ symbol: q.symbol, price: q.priceUsd, changePct: q.changePct24h, source: q.source, observedAt: q.observedAt }));
  const qs = (quakes.data?.items ?? [])
    .filter((q) => q.magnitude >= 4 && q.observedAt)
    .sort((a, b) => Date.parse(b.observedAt!) - Date.parse(a.observedAt!))
    .slice(0, 5)
    .map((q) => ({ id: q.id, magnitude: q.magnitude, place: q.place, depthKm: q.depthKm, url: q.url, observedAt: q.observedAt! }));
  const providers: Record<string, ProviderRun> = {
    crypto: runFromFeed(crypto.meta, c.length, crypto.data !== null),
    // "No M4+ in 2.5 days" would be a truthful empty list, so usgs is ok whenever the feed has data.
    usgs: runFromFeed(quakes.meta, qs.length, quakes.data !== null),
  };
  onAttempt?.(providers);
  if (!providers.crypto!.status.ok && !providers.usgs!.status.ok) throw new InputDown('crypto and usgs');
  const times = [...c.map((x) => x.observedAt), ...qs.map((x) => x.observedAt)].filter((x): x is string => !!x).map(Date.parse);
  return { data: { crypto: c, quakes: qs }, providers, observedAt: times.length ? Math.max(...times) : null };
}

export const tickerFeed = defineFeed<TickerData>({
  key: 'ticker',
  ttlMs: MIN,
  kind: 'live',
  attribution: [
    { text: 'Crypto: Binance / Coinbase / Kraken public tickers' },
    { text: 'Earthquakes: U.S. Geological Survey (M4.0+ from the 2.5_day summary)', url: 'https://earthquake.usgs.gov/earthquakes/feed/', licence: 'Public domain' },
  ],
  count: (d) => d.crypto.length + d.quakes.length,
  isEmpty: (d) => d.crypto.length === 0 && d.quakes.length === 0,
  retryAfterErrorMs: 30_000,
  run: () => runTicker(recordAttempt('ticker')),
});

/** /api/ticker: the feed result with the latest attempt's failed inputs when it is stale/offline. */
export async function getTicker(): Promise<FeedResult<TickerData>> {
  return withLatestAttempt('ticker', await tickerFeed.get());
}

export const chainFeed = defineFeed<ChainData>({
  key: 'chain-daily',
  ttlMs: 30 * MIN,
  kind: 'live',
  attribution: [
    { text: 'Exploits: DefiLlama hacks dataset', url: 'https://defillama.com/hacks' },
    { text: 'CVEs: NIST National Vulnerability Database', url: 'https://nvd.nist.gov/', licence: 'Public domain (US Government)' },
    { text: 'Sanctioned wallets: OpenSanctions API (keyed)', url: 'https://www.opensanctions.org/', licence: 'CC BY-NC 4.0 / commercial licence' },
  ],
  count: (d) => d.exploits.length + d.cves.length + d.sanctionedWallets.length,
  isEmpty: (d) => d.degraded.includes('defillama') && d.degraded.includes('nvd'),
  retryAfterErrorMs: 5 * MIN,
  deadlineMs: 45_000,
  run: (ctx) => runChain(ctx),
});

export const scmFeed = defineFeed<ScmData>({
  key: 'scm-suppliers',
  ttlMs: 15 * MIN,
  kind: 'mixed',
  attribution: [
    { text: 'Supplier sites: GODSEYE reference list (public company filings; city-level coordinates)' },
    { text: 'Hazards: USGS earthquakes and the GODSEYE weather feed', url: 'https://earthquake.usgs.gov/earthquakes/feed/', licence: 'Public domain' },
  ],
  note: 'Sites are REFERENCE data; threat checks are distance rules (method stated per threat). Checks run only on fresh USGS data: while the quake feed is stale or offline the last-good checks are served as STALE/OFFLINE with their time.',
  count: (d) => d.items.length,
  isEmpty: (d) => !d.hazardsChecked,
  retryAfterErrorMs: 2 * MIN,
  run: () => runScm(recordAttempt('scm-suppliers')),
});

/** /api/scm-suppliers: the feed result with the latest attempt's failed inputs when it is stale/offline. */
export async function getScm(): Promise<FeedResult<ScmData>> {
  return withLatestAttempt('scm-suppliers', await scmFeed.get());
}

export const feeds: Feed<unknown>[] = [newsFeed, cryptoFeed, marketsFeed, tickerFeed, chainFeed, scmFeed] as Feed<unknown>[];
