/**
 * Live Alerts, markets, region dossier, entity graph and AI contracts.
 * Owner: panels-alerts-markets-dossier-graph.
 */
import { z } from 'zod';
import { Envelope, IsoTime, Lat, Lng, Providers } from './common';

export const Bloc = z.enum(['western', 'russian', 'regional', 'independent']);
export const AlertKind = z.enum(['rocket', 'event', 'news']);
export const PlacePrecision = z.enum(['settlement', 'region', 'country']);

export const AlertSourceRef = z.object({
  source: z.string(),
  sourceName: z.string(),
  lean: z.string(),
  bloc: Bloc,
  link: z.url(),
  publishedAt: IsoTime,
});

export const AlertItem = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  link: z.url(),
  /** Author publication time (Telegram <time datetime> or RSS pubDate); never back-dated. */
  publishedAt: IsoTime,
  source: z.string(),
  sourceName: z.string(),
  sourceKind: z.enum(['telegram', 'wire']),
  lean: z.string(),
  bloc: Bloc,
  breaking: z.boolean(),
  kind: AlertKind,
  media: z
    .object({ type: z.enum(['photo', 'video']), thumbnailUrl: z.url().nullable(), videoUrl: z.url().nullable(), durationS: z.number().nullable() })
    .nullable(),
  alsoReportedBy: z.array(AlertSourceRef),
  place: z
    .object({
      name: z.string(),
      lat: Lat,
      lng: Lng,
      precision: PlacePrecision,
      /** How the place was found, e.g. `nominatim`, `gazetteer`. */
      method: z.string(),
    })
    .nullable(),
  /** Keyword-count score 1–10 with the matched keywords (method is stated, never called "AI"). */
  risk: z.object({ score: z.number().int().min(1).max(10), method: z.literal('keyword-count'), keywords: z.array(z.string()) }),
});

export const NewsSourceStatus = z.object({
  handle: z.string(),
  name: z.string(),
  lean: z.string(),
  bloc: Bloc,
  kind: z.enum(['telegram', 'wire']),
  count: z.number().int().nonnegative(),
  latestAt: IsoTime.nullable(),
  ok: z.boolean(),
});

/** GET /api/news */
export const NewsResponse = Envelope.extend({
  items: z.array(AlertItem),
  sources: z.array(NewsSourceStatus),
});

export const Quote = z.object({
  symbol: z.string(),
  name: z.string(),
  group: z.enum(['indices', 'defense', 'energy', 'commodities', 'crypto', 'fx']),
  price: z.number().nullable(),
  changePct: z.number().nullable(),
  currency: z.string().nullable(),
  spark: z.array(z.number()),
  marketOpen: z.boolean().nullable(),
  observedAt: IsoTime.nullable(),
  source: z.string(),
  /** Unofficial upstreams (Yahoo v8 chart) are flagged in the UI. */
  unofficial: z.boolean(),
});

/** GET /api/markets */
export const MarketsResponse = Envelope.extend({
  quotes: z.array(Quote),
  breadth: z.object({ up: z.number().int(), down: z.number().int(), flat: z.number().int() }),
  scmAlerts: z.array(z.object({ chokepoint: z.string(), risk: z.string(), message: z.string() })),
});

export const Candle = z.object({
  time: z.number().int(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nullable(),
});

export const MarketRange = z.enum(['1m', '15m', '24H', '1W', '1M', '6M', '1Y']);

export const MarketHistoryResponse = Envelope.extend({
  symbol: z.string(),
  range: MarketRange,
  interval: z.string(),
  currency: z.string().nullable(),
  candles: z.array(Candle),
});

/** GET /api/ticker — status-bar marquee (server-side so browsers never call CoinGecko/USGS). */
export const TickerResponse = Envelope.extend({
  crypto: z.array(z.object({ symbol: z.string(), price: z.number(), changePct: z.number().nullable() })),
  quakes: z.array(z.object({ id: z.string(), magnitude: z.number(), place: z.string().nullable(), observedAt: IsoTime })),
});

export const RegionDossierResponse = z.object({
  lat: Lat,
  lng: Lng,
  location: z.object({ displayName: z.string(), countryCode: z.string().nullable(), attribution: z.string() }).nullable(),
  country: z
    .object({
      name: z.string(),
      iso2: z.string().nullable(),
      capital: z.string().nullable(),
      population: z.number().nullable(),
      areaKm2: z.number().nullable(),
      languages: z.array(z.string()),
      region: z.string().nullable(),
      headOfState: z.object({ name: z.string(), position: z.string() }).nullable(),
      wikidataId: z.string().nullable(),
    })
    .nullable(),
  brief: z.object({ title: z.string(), extract: z.string(), thumbnailUrl: z.url().nullable(), url: z.url() }).nullable(),
  /** Live layers aggregated within 150 km of the point. */
  nearby: z.object({
    radiusKm: z.literal(150),
    counts: z.record(z.string(), z.number().int().nonnegative()),
    highlights: z.array(z.object({ layer: z.string(), id: z.string(), title: z.string(), distanceKm: z.number(), observedAt: IsoTime.nullable() })),
  }),
  weather: z
    .object({ temperatureC: z.number().nullable(), windKmh: z.number().nullable(), code: z.number().nullable(), observedAt: IsoTime.nullable() })
    .nullable(),
  providers: Providers,
  timestamp: IsoTime,
});

export const GraphNodeType = z.enum(['aircraft', 'vessel', 'company', 'person', 'ip', 'asn', 'country', 'sanction']);

export const EntityGraphResponse = z.object({
  root: z.string(),
  nodes: z.array(z.object({ id: z.string(), type: GraphNodeType, label: z.string(), source: z.string(), url: z.url().nullable() })),
  links: z.array(z.object({ source: z.string(), target: z.string(), relation: z.string(), provenance: z.string() })),
  providers: Providers,
  timestamp: IsoTime,
});

/** AI responses always say who generated them: a model, or the deterministic heuristic analyst. */
export const AiGeneratedBy = z.enum(['claude', 'gemini', 'ollama', 'analyst']);

export const AiCitation = z.object({ feed: z.string(), id: z.string(), label: z.string() });

export const AiOverviewResponse = z.object({
  generatedBy: AiGeneratedBy,
  model: z.string().nullable(),
  text: z.string(),
  citations: z.array(AiCitation),
  timestamp: IsoTime,
});

/** GET /api/crypto */
export const CryptoResponse = Envelope.extend({
  items: z.array(z.object({ symbol: z.enum(['BTC', 'ETH', 'SOL']), priceUsd: z.number(), changePct24h: z.number().nullable(), source: z.string(), observedAt: IsoTime.nullable() })),
});

/** GET /api/chain/daily */
export const ChainBriefResponse = Envelope.extend({
  windowDays: z.number().int().min(1).max(120),
  exploits: z.array(z.object({ name: z.string(), date: z.string(), amountUsd: z.number().nullable(), chain: z.string().nullable(), technique: z.string().nullable(), source: z.string() })),
  cves: z.array(z.object({ id: z.string(), cvss: z.number().nullable(), summary: z.string(), published: z.string() })),
  sanctionedWallets: z.array(z.object({ address: z.string(), chain: z.string(), entity: z.string() })),
  degraded: z.array(z.string()),
});

/** GET /api/scm-suppliers */
export const ScmSuppliersResponse = Envelope.extend({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      city: z.string(),
      country: z.string(),
      lat: Lat,
      lng: Lng,
      category: z.enum(['Semiconductor', 'Electronics', 'Automotive', 'Battery']),
      riskLevel: z.enum(['NORMAL', 'HIGH', 'CRITICAL']),
      threats: z.array(z.object({ label: z.string(), distanceKm: z.number(), method: z.string(), observedAt: IsoTime.nullable() })),
    }),
  ),
});
