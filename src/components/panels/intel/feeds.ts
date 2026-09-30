/**
 * Server-side feeds for Live Alerts, markets, crypto, ticker, chain brief and supply chain.
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { defineFeed, type Feed, type FeedData, type ProviderRun } from '@/lib/feeds';
import { earthquakeFeed } from '@/features/hazards/server/usgs';
import type { MarketsResponse, Quote, TickerResponse } from '@/lib/types';
import { runNews, type NewsData } from './server/news';
import { runCrypto, type CryptoData } from './server/crypto';
import { runYahooQuotes } from './server/markets';
import { sessionsAt } from './server/sessions';
import { runChain, type ChainData } from './server/chain';
import { chokepointAlerts, runFromFeed, runScm, type ScmData } from './server/scm';

const MIN = 60_000;

export const NEWS_ATTRIBUTION = [
  { text: 'Public Telegram channel previews (t.me/s); each post links to its source and states the channel’s declared perspective', url: 'https://t.me/' },
  { text: 'Wire RSS: BBC, The Guardian, Al Jazeera, France 24, DW, NYT, Times of Israel, TASS, Anadolu, SCMP, CNA, Africanews (headlines link to the publisher)' },
];

export const newsFeed = defineFeed<NewsData>({
  key: 'news',
  ttlMs: 2 * MIN,
  kind: 'live',
  attribution: NEWS_ATTRIBUTION,
  note: 'Claims from partisan channels are shown with their declared stance; posts are not verified. Pins are keyword geoparsed (precision shown).',
  count: (d) => d.items.length,
  eager: true,
  retryAfterErrorMs: MIN,
  deadlineMs: 40_000,
  run: (ctx) => runNews(ctx),
});

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

export async function runMarkets(signal?: AbortSignal): Promise<FeedData<MarketsData>> {
  const [yahoo, crypto, scm] = await Promise.all([runYahooQuotes(signal), cryptoFeed.get(), chokepointAlerts()]);
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
  const quotes = [...yahoo.quotes, ...cryptoQuotes];
  const providers: Record<string, ProviderRun> = { yahoo: yahoo.run, crypto: runFromFeed(crypto.meta, cryptoQuotes.length, crypto.data !== null), maritime: scm.run };
  const newest = quotes.reduce<number | null>((m, q) => (q.observedAt ? Math.max(m ?? 0, Date.parse(q.observedAt)) : m), null);
  return { data: { quotes, breadth: breadthOf(quotes), scmAlerts: scm.alerts }, providers, observedAt: newest };
}

export const marketsFeed = defineFeed<MarketsData>({
  key: 'markets',
  ttlMs: 2 * MIN,
  kind: 'live',
  attribution: [
    { text: 'Quotes: Yahoo Finance chart endpoint (unofficial, delayed per exchange rules)', url: 'https://finance.yahoo.com/' },
    { text: 'Crypto: Binance / Coinbase / Kraken public tickers' },
  ],
  note: 'Exchange sessions are computed from regular trading hours in each exchange time zone; public holidays are not modelled.',
  count: (d) => d.quotes.length,
  eager: true,
  retryAfterErrorMs: MIN,
  deadlineMs: 40_000,
  run: (ctx) => runMarkets(ctx.signal),
});

/** Sessions are computed at response time (they change on the minute, not on the feed TTL). */
export const marketSessions = (now = Date.now()) => sessionsAt(now);

export interface TickerData {
  crypto: TickerResponse['crypto'];
  quakes: TickerResponse['quakes'];
}

export async function runTicker(): Promise<FeedData<TickerData>> {
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
  run: () => runTicker(),
});

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
  note: 'Sites are REFERENCE data; threat checks are distance rules (method stated per threat).',
  count: (d) => d.items.length,
  isEmpty: (d) => !d.hazardsChecked,
  retryAfterErrorMs: 2 * MIN,
  run: () => runScm(),
});

export const feeds: Feed<unknown>[] = [newsFeed, cryptoFeed, marketsFeed, tickerFeed, chainFeed, scmFeed] as Feed<unknown>[];
