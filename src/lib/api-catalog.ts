/**
 * Typed catalogue of every GODSEYE endpoint. Drives /docs (try-it on every GET), docs/API.md
 * (tools/gen-api-docs.ts), the Privacy page (upstreams that receive user input) and the
 * route-existence test. The code is the inventory: a route without an entry here, or an
 * entry without a route, fails CI.
 * Owner: lead. Builders request edits (params, TTL, upstreams) in their report.
 */
import type { CapabilityId } from './capabilities';
import type { BuilderAgent } from './layer-registry';

export type ApiGroup =
  | 'system'
  | 'aviation'
  | 'space'
  | 'hazards'
  | 'surveillance'
  | 'maritime'
  | 'threats'
  | 'network'
  | 'intel'
  | 'markets'
  | 'ai'
  | 'osint'
  | 'geo'
  | 'flight-paths';

export interface ApiParam {
  name: string;
  in: 'query' | 'path' | 'body' | 'header';
  type: 'string' | 'number' | 'boolean' | 'enum' | 'json';
  required: boolean;
  description: string;
  example?: string;
  enum?: readonly string[];
}

export interface ApiEndpoint {
  method: 'GET' | 'POST';
  path: string;
  group: ApiGroup;
  summary: string;
  params: readonly ApiParam[];
  /** s-maxage in seconds for GET JSON (stale-while-revalidate = 2×); null for streams/POST. */
  ttlSeconds: number | null;
  /** `sse` = text/event-stream; `text` = streamed text (AI chat). */
  stream?: 'sse' | 'text';
  /** Response schema export name in src/lib/schemas. */
  responseSchema: string;
  /** Upstream hostnames this endpoint calls (Privacy page + security review). */
  upstreams: readonly string[];
  /** True when user-supplied input (query, coordinates, identifiers) is forwarded upstream. */
  forwardsUserInput: boolean;
  capability?: CapabilityId;
  /** Per-IP limit on this route (default applies when omitted). `bucket` shares a limit across routes. */
  rateLimit?: { limit: number; windowS: number; bucket?: string; failClosed?: boolean };
  /** Old paths kept as aliases (OSIRIS misnamed routes). */
  aliases?: readonly string[];
  /** Example query string for the docs "Send request" button. */
  example?: string;
  /** Present in OSIRIS at the same path. */
  osiris: boolean;
  owner: BuilderAgent | 'lead' | 'panels-recon';
}

const q = (name: string, type: ApiParam['type'], required: boolean, description: string, example?: string, en?: readonly string[]): ApiParam => ({
  name, in: 'query', type, required, description, example, enum: en,
});
const p = (name: string, description: string, example?: string): ApiParam => ({ name, in: 'path', type: 'string', required: true, description, example });
const body = (description: string, example?: string): ApiParam => ({ name: 'body', in: 'body', type: 'json', required: true, description, example });

/** One shared 5/min bucket for every AI route, denied if the limiter store is down. */
const AI_LIMIT = { limit: 5, windowS: 60, bucket: 'ai', failClosed: true } as const;
const aiKeyHeader: ApiParam = { name: 'x-ai-key', in: 'header', type: 'string', required: false, description: 'Optional user-supplied provider key; used for this request only, never stored or logged.' };
const OSINT_LIMIT = { limit: 20, windowS: 60 } as const;

export const API_CATALOG = [
  // ── system ─────────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/health', group: 'system', summary: 'Capability flags, per-feed/per-upstream status and geocoder queue stats', params: [], ttlSeconds: 10, responseSchema: 'HealthResponse', upstreams: [], forwardsUserInput: false, osiris: true, owner: 'lead' },
  { method: 'GET', path: '/api/stats', group: 'system', summary: 'Entity counts per feed (counts only)', params: [], ttlSeconds: 30, responseSchema: 'StatsResponse', upstreams: [], forwardsUserInput: false, osiris: true, owner: 'lead' },

  // ── aviation ───────────────────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/flights', group: 'aviation', summary: 'Live aircraft (columnar), classified into commercial/private/jet/military',
    params: [q('bucket', 'enum', false, 'Comma list of buckets to include', 'military', ['commercial', 'private', 'jet', 'military']), q('bbox', 'string', false, 'west,south,east,north filter', '-10,35,30,60')],
    ttlSeconds: 15, responseSchema: 'FlightsResponse', upstreams: ['api.adsb.lol', 're-api.adsb.lol', 'opensky-network.org', 'auth.opensky-network.org', 'opendata.adsb.fi'],
    forwardsUserInput: false, example: '?bucket=military', osiris: true, owner: 'layers-aviation',
  },
  { method: 'GET', path: '/api/flights/stream', group: 'aviation', summary: 'SSE aircraft deltas (snapshot, update, status, heartbeat)', params: [], ttlSeconds: null, stream: 'sse', responseSchema: 'FlightsResponse', upstreams: [], forwardsUserInput: false, osiris: false, owner: 'layers-aviation' },
  {
    method: 'GET', path: '/api/aircraft', group: 'aviation', summary: 'Aircraft identity + current-leg flown track',
    params: [q('icao24', 'string', true, 'ICAO 24-bit hex', '4ca2b3')], ttlSeconds: 120, responseSchema: 'AircraftDetailResponse',
    upstreams: ['adsb.lol', 'api.adsbdb.com'], forwardsUserInput: true, example: '?icao24=4ca2b3', osiris: true, owner: 'layers-aviation',
  },
  {
    method: 'GET', path: '/api/flight-route', group: 'aviation', summary: 'Callsign → origin/destination with observed-track corroboration',
    params: [q('callsign', 'string', true, 'ICAO callsign', 'BAW117'), q('icao24', 'string', false, 'hex for trace corroboration'), q('lat', 'number', false, 'current latitude'), q('lng', 'number', false, 'current longitude'), q('speed', 'number', false, 'ground speed kt')],
    ttlSeconds: 600, responseSchema: 'FlightRouteResponse', upstreams: ['vrs-standing-data.adsb.lol', 'api.adsbdb.com', 'hexdb.io'], forwardsUserInput: true, example: '?callsign=BAW117', osiris: true, owner: 'layers-aviation',
  },

  // ── space ──────────────────────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/satellites', group: 'space', summary: 'CelesTrak OMM catalogue (columnar) with mission colours and categories',
    params: [q('category', 'enum', false, 'Restrict to one category', 'navigation', ['comms', 'military', 'navigation', 'earth_obs', 'science', 'other'])],
    ttlSeconds: 7200, responseSchema: 'SatellitesResponse', upstreams: ['celestrak.org', 'db.satnogs.org'], forwardsUserInput: false, example: '?category=navigation', osiris: true, owner: 'layers-space',
  },
  {
    method: 'GET', path: '/api/satellites/orbit', group: 'space', summary: 'Orbit track ±½ period around t, split at the antimeridian',
    params: [q('id', 'number', true, 'NORAD catalogue number', '25544'), q('t', 'number', false, 'Epoch ms the markers were propagated for')],
    ttlSeconds: 600, responseSchema: 'OrbitResponse', upstreams: [], forwardsUserInput: false, example: '?id=25544', osiris: true, owner: 'layers-space',
  },
  { method: 'GET', path: '/api/space-weather', group: 'space', summary: 'NOAA SWPC Kp, scales, X-ray flux, solar wind (rtsw_wind_1m + rtsw_mag_1m), alerts', params: [], ttlSeconds: 300, responseSchema: 'SpaceWeatherResponse', upstreams: ['services.swpc.noaa.gov'], forwardsUserInput: false, osiris: true, owner: 'layers-space' },
  { method: 'GET', path: '/api/iss', group: 'space', summary: 'ISS position (wheretheiss.at)', params: [], ttlSeconds: 5, responseSchema: 'IssResponse', upstreams: ['api.wheretheiss.at'], forwardsUserInput: false, osiris: false, owner: 'layers-space' },

  // ── hazards ────────────────────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/earthquakes', group: 'hazards', summary: 'USGS earthquakes',
    params: [q('feed', 'enum', false, 'USGS summary feed', '2.5_day', ['all_hour', 'all_day', '2.5_day', '4.5_day', '4.5_week', 'significant_week'])],
    ttlSeconds: 60, responseSchema: 'EarthquakesResponse', upstreams: ['earthquake.usgs.gov'], forwardsUserInput: false, example: '?feed=4.5_day', osiris: true, owner: 'layers-hazards',
  },
  { method: 'GET', path: '/api/fires', group: 'hazards', summary: 'NASA FIRMS VIIRS/MODIS 24 h fire pixels sampled by FRP/confidence', params: [], ttlSeconds: 900, responseSchema: 'FiresResponse', upstreams: ['firms.modaps.eosdis.nasa.gov', 'eonet.gsfc.nasa.gov'], forwardsUserInput: false, osiris: true, owner: 'layers-hazards' },
  { method: 'GET', path: '/api/weather', group: 'hazards', summary: 'Severe weather/natural events: EONET, NWS, GDACS, NHC, GVP', params: [], ttlSeconds: 300, responseSchema: 'WeatherResponse', upstreams: ['eonet.gsfc.nasa.gov', 'api.weather.gov', 'www.gdacs.org', 'www.nhc.noaa.gov', 'mapservices.weather.noaa.gov', 'volcano.si.edu'], forwardsUserInput: false, osiris: true, owner: 'layers-hazards' },
  {
    method: 'GET', path: '/api/air-quality', group: 'hazards', summary: 'PM2.5 / US AQI (Open-Meteo keyless; OpenAQ/WAQI keyed)',
    params: [q('bbox', 'string', false, 'west,south,east,north', '-10,35,30,60')], ttlSeconds: 900, responseSchema: 'AirQualityResponse',
    upstreams: ['air-quality-api.open-meteo.com', 'api.openaq.org', 'api.waqi.info'], forwardsUserInput: false, osiris: true, owner: 'layers-hazards',
  },
  {
    method: 'GET', path: '/api/gps-interference', group: 'hazards', summary: 'GPS interference H3 cells (gpsjam daily + live NACp binning)',
    params: [q('date', 'string', false, 'YYYY-MM-DD (default: latest available)')], ttlSeconds: 3600, responseSchema: 'GpsInterferenceResponse', upstreams: ['gpsjam.org'], forwardsUserInput: false, osiris: false, owner: 'layers-hazards',
  },
  {
    method: 'GET', path: '/api/sentinel', group: 'hazards', summary: 'Recent Sentinel-2 scenes around a point (CDSE STAC)',
    params: [q('lat', 'number', true, 'latitude', '48.85'), q('lng', 'number', true, 'longitude', '2.35'), q('radiusKm', 'number', false, 'search radius km (≤ 100)', '25'), q('days', 'number', false, 'look-back days (≤ 30)', '10')],
    ttlSeconds: 300, responseSchema: 'SentinelResponse', upstreams: ['stac.dataspace.copernicus.eu'], forwardsUserInput: true, example: '?lat=48.85&lng=2.35', osiris: true, owner: 'layers-hazards',
  },
  { method: 'GET', path: '/api/weather-radar', group: 'hazards', summary: 'RainViewer past radar frames (z ≤ 7)', params: [], ttlSeconds: 300, responseSchema: 'RadarFramesResponse', upstreams: ['api.rainviewer.com'], forwardsUserInput: false, osiris: false, owner: 'layers-hazards' },

  // ── surveillance ───────────────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/cctv', group: 'surveillance', summary: 'Public camera catalogue by region (columnar, < 4 MB per response)',
    params: [
      q('region', 'string', false, 'Comma list of region keys (one region per response keeps it < 4 MB)', 'uk'),
      q('lat', 'number', false, 'pick regions around a point'),
      q('lng', 'number', false, 'pick regions around a point'),
    ],
    ttlSeconds: 1800, responseSchema: 'CctvResponse',
    upstreams: ['api.tfl.gov.uk', 'cwwp2.dot.ca.gov', 'caltrans-gis.dot.ca.gov', 'wsdot.wa.gov', 'its.txdot.gov', 'tdcctv.data.one.gov.hk', 'api.data.gov.sg', 'tie.digitraffic.fi', 'api.trafikinfo.trafikverket.se', '(other public camera operators per the provider registry)'],
    forwardsUserInput: false, example: '?region=us-west', osiris: true, owner: 'layers-surveillance',
  },
  { method: 'GET', path: '/api/cctv/providers', group: 'surveillance', summary: 'Camera provider registry rows (operator, licence, attribution, terms)', params: [], ttlSeconds: 3600, responseSchema: 'CameraProvidersResponse', upstreams: [], forwardsUserInput: false, osiris: false, owner: 'layers-surveillance' },
  { method: 'GET', path: '/api/cctv/proxy', group: 'surveillance', summary: 'Stills-only frame proxy (exact-prefix allow-list, no storage)', params: [q('id', 'string', true, 'Camera id from the catalogue', 'hktd-H429F')], ttlSeconds: 5, responseSchema: 'image/*', upstreams: ['(camera operators, allow-listed)'], forwardsUserInput: false, osiris: true, owner: 'layers-surveillance' },
  { method: 'GET', path: '/api/cctv/resolve', group: 'surveillance', summary: 'Resolve a camera to its playable stream', params: [q('id', 'string', true, 'Camera id')], ttlSeconds: 300, responseSchema: 'CameraResolveResponse', upstreams: ['(camera operators, allow-listed)'], forwardsUserInput: false, osiris: true, owner: 'layers-surveillance' },
  { method: 'GET', path: '/api/cctv/stream-status', group: 'surveillance', summary: 'Probe whether a camera stream is online', params: [q('id', 'string', true, 'Camera id')], ttlSeconds: 60, responseSchema: 'StreamStatusResponse', upstreams: ['(camera operators, allow-listed)'], forwardsUserInput: false, osiris: true, owner: 'layers-surveillance' },
  { method: 'GET', path: '/api/cctv/texas/snapshot', group: 'surveillance', summary: 'TxDOT camera snapshot (stills)', params: [q('id', 'string', true, 'TxDOT camera id')], ttlSeconds: 60, responseSchema: 'image/*', upstreams: ['its.txdot.gov'], forwardsUserInput: false, osiris: true, owner: 'layers-surveillance' },
  { method: 'GET', path: '/api/live-news', group: 'surveillance', summary: '24/7 news channels (official YouTube embeds, runtime live check)', params: [], ttlSeconds: 3600, responseSchema: 'LiveNewsResponse', upstreams: ['www.youtube.com'], forwardsUserInput: false, osiris: true, owner: 'layers-surveillance' },

  // ── maritime ───────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/maritime', group: 'maritime', summary: 'Ports + chokepoints (reference) and AIS vessels (keyed relay)', params: [q('bbox', 'string', false, 'w,s,e,n vessel filter')], ttlSeconds: 5, responseSchema: 'MaritimeResponse', upstreams: ['stream.aisstream.io'], forwardsUserInput: false, osiris: true, owner: 'layers-threats-network' },

  // ── threats ────────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/infrastructure', group: 'threats', summary: 'Nuclear facilities (Wikidata + curated), with seismic/conflict context flags', params: [], ttlSeconds: 86400, responseSchema: 'InfrastructureResponse', upstreams: ['query.wikidata.org', 'earthquake.usgs.gov'], forwardsUserInput: false, osiris: true, owner: 'layers-threats-network' },
  { method: 'GET', path: '/api/gdacs', group: 'threats', summary: 'GDACS disaster alerts (Global Incidents layer)', params: [], ttlSeconds: 600, responseSchema: 'GdacsResponse', upstreams: ['www.gdacs.org'], forwardsUserInput: false, aliases: ['/api/gdelt'], osiris: true, owner: 'layers-threats-network' },
  {
    method: 'GET', path: '/api/gdelt-events', group: 'threats', summary: 'GDELT 2.0 15-minute export events (geocoded, CAMEO QuadClass)',
    params: [q('limit', 'number', false, 'max events (≤ 2000)', '600'), q('quad', 'string', false, 'Comma list of QuadClass 1–4', '3,4')], ttlSeconds: 900, responseSchema: 'GdeltEventsResponse',
    upstreams: ['data.gdeltproject.org'], forwardsUserInput: false, example: '?limit=200&quad=4', osiris: true, owner: 'layers-threats-network',
  },
  { method: 'GET', path: '/api/conflicts', group: 'threats', summary: 'Conflict zones (REFERENCE polygons) with live event counts from GDELT/alerts', params: [], ttlSeconds: 900, responseSchema: 'ConflictsResponse', upstreams: ['data.gdeltproject.org'], forwardsUserInput: false, osiris: true, owner: 'layers-threats-network' },
  { method: 'GET', path: '/api/frontlines', group: 'threats', summary: 'DeepStateMap frontlines (non-commercial, attributed)', params: [], ttlSeconds: 3600, responseSchema: 'FrontlinesResponse', upstreams: ['deepstatemap.live'], forwardsUserInput: false, capability: 'deepstate', osiris: true, owner: 'layers-threats-network' },
  { method: 'GET', path: '/api/country-risk', group: 'threats', summary: 'Country risk (INFORM + World Bank WGI) with method', params: [], ttlSeconds: 86400, responseSchema: 'CountryRiskResponse', upstreams: ['drmkc.jrc.ec.europa.eu', 'api.worldbank.org'], forwardsUserInput: false, osiris: true, owner: 'layers-threats-network' },

  // ── network ────────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/malware', group: 'network', summary: 'URLhaus malware hosts (geolocated IPs, precision labelled)', params: [], ttlSeconds: 60, responseSchema: 'MalwareResponse', upstreams: ['urlhaus.abuse.ch', 'ip-api.com'], forwardsUserInput: false, capability: 'nc_sources', osiris: true, owner: 'layers-threats-network' },
  { method: 'GET', path: '/api/malware/stream', group: 'network', summary: 'SSE malware detections (snapshot, detections, status, heartbeat)', params: [], ttlSeconds: null, stream: 'sse', responseSchema: 'MalwareResponse', upstreams: [], forwardsUserInput: false, capability: 'nc_sources', osiris: true, owner: 'layers-threats-network' },
  { method: 'GET', path: '/api/cyber-attacks', group: 'network', summary: 'Feodo Tracker botnet C2 indicators', params: [], ttlSeconds: 300, responseSchema: 'C2Response', upstreams: ['feodotracker.abuse.ch', 'ip-api.com'], forwardsUserInput: false, capability: 'nc_sources', osiris: true, owner: 'layers-threats-network' },
  { method: 'GET', path: '/api/threatfox', group: 'network', summary: 'ThreatFox recent IOCs (list; IP IOCs geolocated as INDICATOR points)', params: [], ttlSeconds: 600, responseSchema: 'ThreatFoxResponse', upstreams: ['threatfox.abuse.ch', 'ip-api.com'], forwardsUserInput: false, capability: 'nc_sources', osiris: false, owner: 'layers-threats-network' },
  { method: 'GET', path: '/api/cyber-threats', group: 'network', summary: 'CISA Known Exploited Vulnerabilities', params: [], ttlSeconds: 3600, responseSchema: 'KevResponse', upstreams: ['www.cisa.gov', 'services.nvd.nist.gov'], forwardsUserInput: false, osiris: true, owner: 'layers-threats-network' },
  { method: 'GET', path: '/api/outages', group: 'network', summary: 'Internet outages: IODA (keyless) + Cloudflare Radar (keyed)', params: [], ttlSeconds: 300, responseSchema: 'OutagesResponse', upstreams: ['api.ioda.inetintel.cc.gatech.edu', 'api.cloudflare.com'], forwardsUserInput: false, aliases: ['/api/radar'], osiris: true, owner: 'layers-threats-network' },
  {
    method: 'GET', path: '/api/cloudflare-radar', group: 'network', summary: 'Cloudflare Radar outages + L3 attack origins',
    params: [q('probe', 'boolean', false, '1 = only report whether configured')], ttlSeconds: 300, responseSchema: 'AttackOriginsResponse', upstreams: ['api.cloudflare.com'], forwardsUserInput: false, capability: 'cloudflare', osiris: true, owner: 'layers-threats-network',
  },
  { method: 'GET', path: '/api/cables', group: 'network', summary: 'Submarine cables + landing points (TeleGeography, CC BY-NC-SA, bundled)', params: [], ttlSeconds: 86400, responseSchema: 'CablesResponse', upstreams: [], forwardsUserInput: false, capability: 'nc_sources', osiris: false, owner: 'layers-threats-network' },
  { method: 'POST', path: '/api/sdk/ingest', group: 'network', summary: 'GODSEYE SDK entity ingest (Bearer SDK_INGEST_KEY; fail-closed)', params: [body('SDK entity batch')], ttlSeconds: null, responseSchema: 'SdkIngestResponse', upstreams: [], forwardsUserInput: false, capability: 'sdk', osiris: true, owner: 'layers-threats-network' },
  { method: 'GET', path: '/api/sdk/stream', group: 'network', summary: 'SSE stream of SDK entities', params: [], ttlSeconds: null, stream: 'sse', responseSchema: 'SdkEntity', upstreams: [], forwardsUserInput: false, capability: 'sdk', osiris: true, owner: 'layers-threats-network' },

  // ── intel / markets ────────────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/news', group: 'intel', summary: 'Live Alerts: Telegram previews + wire RSS, deduped, geoparsed',
    params: [q('kind', 'enum', false, 'filter by alert kind', 'rocket', ['rocket', 'event', 'news']), q('bloc', 'enum', false, 'filter by bloc', 'western', ['western', 'russian', 'regional', 'independent'])],
    ttlSeconds: 60, responseSchema: 'NewsResponse',
    upstreams: ['t.me', 'feeds.bbci.co.uk', 'www.theguardian.com', 'www.aljazeera.com', 'www.france24.com', 'rss.dw.com', 'rss.nytimes.com', 'www.timesofisrael.com', 'tass.com', 'www.aa.com.tr', 'www.scmp.com', 'www.channelnewsasia.com', 'www.africanews.com', 'nominatim.openstreetmap.org'],
    forwardsUserInput: false, osiris: true, owner: 'panels-alerts-markets-dossier-graph',
  },
  { method: 'GET', path: '/api/markets', group: 'markets', summary: 'Indices, defense, energy, commodities, crypto, FX quotes + breadth', params: [], ttlSeconds: 60, responseSchema: 'MarketsResponse', upstreams: ['query1.finance.yahoo.com', 'api.coingecko.com', 'data-api.binance.vision', 'api.exchange.coinbase.com', 'api.kraken.com'], forwardsUserInput: false, osiris: true, owner: 'panels-alerts-markets-dossier-graph' },
  {
    method: 'GET', path: '/api/markets/history', group: 'markets', summary: 'OHLC candles for one symbol',
    params: [q('symbol', 'string', true, 'Ticker (allow-listed)', 'GC=F'), q('range', 'enum', false, 'Range (case-sensitive)', '1M', ['1m', '15m', '24H', '1W', '1M', '6M', '1Y'])],
    ttlSeconds: 60, responseSchema: 'MarketHistoryResponse', upstreams: ['query1.finance.yahoo.com'], forwardsUserInput: true, example: '?symbol=GC%3DF&range=1M', osiris: true, owner: 'panels-alerts-markets-dossier-graph',
  },
  { method: 'GET', path: '/api/crypto', group: 'markets', summary: 'BTC/ETH/SOL spot prices (Binance → Coinbase → Kraken; CoinGecko only with a demo key)', params: [], ttlSeconds: 60, responseSchema: 'CryptoResponse', upstreams: ['data-api.binance.vision', 'api.exchange.coinbase.com', 'api.kraken.com', 'api.coingecko.com'], forwardsUserInput: false, osiris: true, owner: 'panels-alerts-markets-dossier-graph' },
  { method: 'GET', path: '/api/chain/daily', group: 'markets', summary: 'Daily chain brief: exploits, crypto CVEs, sanctioned wallets', params: [q('days', 'number', false, 'window 1–120', '30')], ttlSeconds: 1800, responseSchema: 'ChainBriefResponse', upstreams: ['api.llama.fi', 'services.nvd.nist.gov', 'api.opensanctions.org'], forwardsUserInput: false, osiris: true, owner: 'panels-alerts-markets-dossier-graph' },
  { method: 'GET', path: '/api/ticker', group: 'markets', summary: 'Status-bar ticker (BTC/ETH/SOL + five latest M4.0+ quakes from USGS 2.5_day), server-side', params: [], ttlSeconds: 60, responseSchema: 'TickerResponse', upstreams: ['data-api.binance.vision', 'api.exchange.coinbase.com', 'api.kraken.com', 'earthquake.usgs.gov'], forwardsUserInput: false, osiris: false, owner: 'panels-alerts-markets-dossier-graph' },
  { method: 'GET', path: '/api/scm-suppliers', group: 'markets', summary: 'Supply-chain sites with hazard proximity checks (method stated)', params: [], ttlSeconds: 900, responseSchema: 'ScmSuppliersResponse', upstreams: ['earthquake.usgs.gov'], forwardsUserInput: false, osiris: true, owner: 'panels-alerts-markets-dossier-graph' },
  {
    method: 'GET', path: '/api/region-dossier', group: 'intel', summary: 'Region Dossier: reverse geocode, Wikipedia, Wikidata facts, head of state, live layers within 150 km, weather',
    params: [q('lat', 'number', true, 'latitude', '50.45'), q('lng', 'number', true, 'longitude', '30.52')], ttlSeconds: 300, responseSchema: 'RegionDossierResponse',
    upstreams: ['photon.komoot.io', 'nominatim.openstreetmap.org', 'en.wikipedia.org', 'www.wikidata.org', 'query.wikidata.org', 'api.open-meteo.com'], forwardsUserInput: true, example: '?lat=50.45&lng=30.52', osiris: true, owner: 'panels-alerts-markets-dossier-graph',
  },
  {
    method: 'GET', path: '/api/entity/expand', group: 'intel', summary: 'Entity Graph expansion (Wikidata + OpenSanctions + RIPEstat)',
    params: [q('type', 'enum', true, 'node type', 'company', ['aircraft', 'vessel', 'company', 'person', 'ip', 'asn', 'country']), q('id', 'string', true, 'identifier', 'Q95')],
    ttlSeconds: 86400, responseSchema: 'EntityGraphResponse', upstreams: ['query.wikidata.org', 'www.wikidata.org', 'api.opensanctions.org', 'stat.ripe.net'], forwardsUserInput: true, example: '?type=company&id=Q95', osiris: true, owner: 'panels-alerts-markets-dossier-graph',
  },

  // ── ai ─────────────────────────────────────────────────────────────────────────
  { method: 'POST', path: '/api/ai/overview', group: 'ai', summary: 'One-click overview (Claude when keyed, heuristic ANALYST otherwise)', params: [body('{scope, feeds}'), aiKeyHeader], ttlSeconds: null, responseSchema: 'AiOverviewResponse', upstreams: ['api.anthropic.com', 'generativelanguage.googleapis.com', '(OLLAMA_URL)'], forwardsUserInput: true, rateLimit: AI_LIMIT, osiris: true, owner: 'panels-alerts-markets-dossier-graph' },
  { method: 'POST', path: '/api/ai/analyze', group: 'ai', summary: 'Region/selection analysis citing feed rows', params: [body('{lat, lng, selection}'), aiKeyHeader], ttlSeconds: null, responseSchema: 'AiOverviewResponse', upstreams: ['api.anthropic.com', 'generativelanguage.googleapis.com', '(OLLAMA_URL)'], forwardsUserInput: true, rateLimit: AI_LIMIT, osiris: true, owner: 'panels-alerts-markets-dossier-graph' },
  { method: 'POST', path: '/api/ai/briefing', group: 'ai', summary: 'Daily briefing (BLUF / PIRs / forecast)', params: [body('{horizon}'), aiKeyHeader], ttlSeconds: null, responseSchema: 'AiOverviewResponse', upstreams: ['api.anthropic.com', 'generativelanguage.googleapis.com', '(OLLAMA_URL)'], forwardsUserInput: true, rateLimit: AI_LIMIT, osiris: true, owner: 'panels-alerts-markets-dossier-graph' },
  { method: 'POST', path: '/api/ai/chat', group: 'ai', summary: 'Analyst chat over current feeds, streamed as NDJSON (meta → delta → done)', params: [body('{messages}'), aiKeyHeader], ttlSeconds: null, stream: 'text', responseSchema: 'AiOverviewResponse', upstreams: ['api.anthropic.com', 'generativelanguage.googleapis.com', '(OLLAMA_URL)'], forwardsUserInput: true, rateLimit: AI_LIMIT, osiris: false, owner: 'panels-alerts-markets-dossier-graph' },

  // ── osint (infrastructure only, passive) ───────────────────────────────────────
  { method: 'GET', path: '/api/osint/dns', group: 'osint', summary: 'DNS records via DNS-over-HTTPS', params: [q('domain', 'string', true, 'domain', 'example.com'), q('type', 'enum', false, 'record type', 'A', ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'CAA'])], ttlSeconds: 300, responseSchema: 'OsintResponse', upstreams: ['dns.google'], forwardsUserInput: true, rateLimit: OSINT_LIMIT, example: '?domain=example.com', osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/whois', group: 'osint', summary: 'RDAP registration data', params: [q('domain', 'string', true, 'domain', 'example.com')], ttlSeconds: 3600, responseSchema: 'OsintResponse', upstreams: ['rdap.org'], forwardsUserInput: true, rateLimit: OSINT_LIMIT, example: '?domain=example.com', osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/headers', group: 'osint', summary: 'Security headers grade for a public URL (SSRF-guarded, proxied through this server)', params: [q('url', 'string', true, 'https URL', 'https://example.com')], ttlSeconds: 300, responseSchema: 'OsintResponse', upstreams: ['(user-supplied public host)'], forwardsUserInput: true, rateLimit: OSINT_LIMIT, example: '?url=https%3A%2F%2Fexample.com', osiris: false, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/certs', group: 'osint', summary: 'Certificate transparency + subdomains', params: [q('domain', 'string', true, 'domain', 'example.com')], ttlSeconds: 3600, responseSchema: 'OsintResponse', upstreams: ['crt.sh'], forwardsUserInput: true, rateLimit: OSINT_LIMIT, example: '?domain=example.com', osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/ip', group: 'osint', summary: 'IP intel: geolocation, ASN, hosting/proxy flags, OFAC cross-check', params: [q('ip', 'string', true, 'public IPv4/IPv6', '8.8.8.8')], ttlSeconds: 3600, responseSchema: 'OsintResponse', upstreams: ['ipwho.is', 'ip-api.com', 'stat.ripe.net', 'free.freeipapi.com'], forwardsUserInput: true, rateLimit: OSINT_LIMIT, example: '?ip=8.8.8.8', osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/bgp', group: 'osint', summary: 'BGP/ASN: prefixes, peers, holder (RIPEstat)', params: [q('query', 'string', true, 'IP or ASN', 'AS15169')], ttlSeconds: 3600, responseSchema: 'OsintResponse', upstreams: ['stat.ripe.net'], forwardsUserInput: true, rateLimit: OSINT_LIMIT, example: '?query=AS15169', osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/shodan', group: 'osint', summary: 'Shodan InternetDB (ports, CPEs, vulns; non-commercial)', params: [q('ip', 'string', true, 'public IP', '1.1.1.1')], ttlSeconds: 3600, responseSchema: 'OsintResponse', upstreams: ['internetdb.shodan.io'], forwardsUserInput: true, capability: 'nc_sources', rateLimit: OSINT_LIMIT, example: '?ip=1.1.1.1', osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/sweep', group: 'osint', summary: 'Passive network sweep of a small public prefix via InternetDB (no packets sent to targets)', params: [q('ip', 'string', true, 'public IPv4', '1.1.1.0'), q('cidr', 'number', false, 'prefix length 28–32', '30')], ttlSeconds: 3600, responseSchema: 'OsintResponse', upstreams: ['internetdb.shodan.io', 'ipwho.is'], forwardsUserInput: true, capability: 'nc_sources', rateLimit: { limit: 5, windowS: 60 }, osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/mac', group: 'osint', summary: 'MAC vendor lookup', params: [q('mac', 'string', true, 'MAC or OUI', '00:1A:2B')], ttlSeconds: 86400, responseSchema: 'OsintResponse', upstreams: ['api.maclookup.app'], forwardsUserInput: true, rateLimit: OSINT_LIMIT, example: '?mac=00:1A:2B', osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/cve', group: 'osint', summary: 'CVE detail (MITRE, CIRCL, NVD) with KEV flag', params: [q('id', 'string', true, 'CVE id', 'CVE-2024-3400')], ttlSeconds: 3600, responseSchema: 'OsintResponse', upstreams: ['cveawg.mitre.org', 'cve.circl.lu', 'services.nvd.nist.gov'], forwardsUserInput: true, rateLimit: OSINT_LIMIT, example: '?id=CVE-2024-3400', osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/threats', group: 'osint', summary: 'Threat intel for an IP/domain/hash (abuse.ch, OTX, Tor exit exact match)', params: [q('ioc', 'string', true, 'indicator', '1.2.3.4')], ttlSeconds: 600, responseSchema: 'OsintResponse', upstreams: ['threatfox-api.abuse.ch', 'urlhaus-api.abuse.ch', 'otx.alienvault.com', 'check.torproject.org', 'feodotracker.abuse.ch'], forwardsUserInput: true, rateLimit: OSINT_LIMIT, osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/sanctions', group: 'osint', summary: 'OFAC SDN search (OpenSanctions bulk, CC BY-NC)', params: [q('q', 'string', true, 'name / vessel / entity', 'Rosneft')], ttlSeconds: 86400, responseSchema: 'OsintResponse', upstreams: ['data.opensanctions.org'], forwardsUserInput: false, capability: 'nc_sources', rateLimit: OSINT_LIMIT, example: '?q=Rosneft', osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/crypto', group: 'osint', summary: 'Wallet trace BTC/ETH/SOL with transparent risk factors', params: [q('address', 'string', true, 'wallet address'), q('chain', 'enum', false, 'chain', 'btc', ['btc', 'eth', 'sol'])], ttlSeconds: 300, responseSchema: 'OsintResponse', upstreams: ['mempool.space', 'eth.blockscout.com', 'api.mainnet-beta.solana.com'], forwardsUserInput: true, rateLimit: OSINT_LIMIT, osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/osint/leaks', group: 'osint', summary: 'Known breaches of an organisation domain (no personal email lookups)', params: [q('domain', 'string', true, 'organisation domain', 'example.com')], ttlSeconds: 86400, responseSchema: 'OsintResponse', upstreams: ['api.xposedornot.com'], forwardsUserInput: true, rateLimit: OSINT_LIMIT, osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/scanner', group: 'osint', summary: 'Allow-listed active scan types proxied through this server to an optional backend (disabled unless configured)', params: [q('type', 'string', true, 'allow-listed scan type'), q('target', 'string', true, 'public host/IP')], ttlSeconds: null, responseSchema: 'OsintResponse', upstreams: ['(SCANNER_URL)'], forwardsUserInput: true, capability: 'scanner', rateLimit: { limit: 5, windowS: 60, bucket: 'scanner', failClosed: true }, osiris: true, owner: 'panels-recon' },

  // ── geo ────────────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/geo', group: 'geo', summary: "Visitor region from IP — only after the user clicks 'centre on my region'", params: [], ttlSeconds: null, responseSchema: 'GeoResponse', upstreams: ['ipwho.is', 'free.freeipapi.com'], forwardsUserInput: true, osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/geo/reverse', group: 'geo', summary: 'Reverse geocode (Photon, then queued Nominatim; cached 30 days)', params: [q('lat', 'number', true, 'latitude', '51.5'), q('lng', 'number', true, 'longitude', '-0.12')], ttlSeconds: 600, responseSchema: 'GeoResponse', upstreams: ['photon.komoot.io', 'nominatim.openstreetmap.org'], forwardsUserInput: true, example: '?lat=51.5&lng=-0.12', osiris: true, owner: 'panels-recon' },
  { method: 'GET', path: '/api/geosearch', group: 'geo', summary: 'Place search: Photon type-ahead; Nominatim only on explicit submit', params: [q('q', 'string', true, 'query', 'Kyiv'), q('submit', 'boolean', false, '1 = explicit submit (allows Nominatim promotion)'), q('lat', 'number', false, 'bias latitude'), q('lng', 'number', false, 'bias longitude')], ttlSeconds: 600, responseSchema: 'GeoResponse', upstreams: ['photon.komoot.io', 'nominatim.openstreetmap.org'], forwardsUserInput: true, example: '?q=Kyiv', osiris: true, owner: 'panels-recon' },
  {
    method: 'GET', path: '/api/directions', group: 'geo', summary: 'Turn-by-turn routing (Valhalla, OSRM fallback) with elevation profile',
    params: [
      q('from', 'string', true, 'lat,lng (OSIRIS order)', '51.5072,-0.1276'),
      q('to', 'string', true, 'lat,lng', '51.5081,-0.0877'),
      q('via', 'string', false, 'lat,lng|lat,lng waypoints'),
      q('mode', 'enum', false, 'mode (OSIRIS names auto/bicycle/pedestrian accepted as aliases)', 'drive', ['drive', 'walk', 'bike', 'auto', 'pedestrian', 'bicycle']),
      q('avoid', 'string', false, 'tolls,highways,ferries'),
    ],
    ttlSeconds: 300, responseSchema: 'DirectionsResponse', upstreams: ['valhalla1.openstreetmap.de', 'router.project-osrm.org', 'routing.openstreetmap.de'], forwardsUserInput: true, example: '?from=51.5072,-0.1276&to=51.5081,-0.0877', osiris: true, owner: 'panels-recon',
  },
  {
    method: 'GET', path: '/api/arcgis', group: 'geo', summary: 'ArcGIS catalogue search and Feature/Map Service import (URL rebuilt to …/rest/services/…/(Feature|Map)Server/<n>/query, SSRF-guarded)',
    params: [q('q', 'string', false, 'catalogue search'), q('url', 'string', false, 'any public …/rest/services/…/(Feature|Map)Server[/n] URL'), q('bbox', 'string', false, 'west,south,east,north')],
    ttlSeconds: 600, responseSchema: 'ArcgisResponse', upstreams: ['www.arcgis.com', '(user-supplied public ArcGIS server)'], forwardsUserInput: true, osiris: true, owner: 'panels-recon',
  },

  // ── flight paths ───────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/airports/search', group: 'flight-paths', summary: 'Airport resolution: IATA → ICAO → ident → fuzzy → metro → Photon → Nominatim', params: [q('q', 'string', true, 'code, name, city or place', 'London'), q('all', 'boolean', false, '1 = include all airfields')], ttlSeconds: 600, responseSchema: 'AirportSearchResponse', upstreams: ['photon.komoot.io', 'nominatim.openstreetmap.org'], forwardsUserInput: true, example: '?q=London', osiris: false, owner: 'feature-flight-paths' },
  { method: 'GET', path: '/api/airports/{code}', group: 'flight-paths', summary: 'Airport record + runways + METAR/TAF + local time', params: [p('code', 'IATA, ICAO or ident', 'EGLL')], ttlSeconds: 300, responseSchema: 'AirportDetailResponse', upstreams: ['aviationweather.gov', 'api.adsb.lol'], forwardsUserInput: true, example: 'EGLL', osiris: false, owner: 'feature-flight-paths' },
  { method: 'GET', path: '/api/route/plan', group: 'flight-paths', summary: 'Planned route between two airports: great circle, estimates, services, weather, diversions', params: [q('from', 'string', true, 'origin code', 'EGLL'), q('to', 'string', true, 'destination code', 'KJFK')], ttlSeconds: 86400, responseSchema: 'RoutePlanResponse', upstreams: ['aviationweather.gov', 'api.open-meteo.com', 'services6.arcgis.com', 'aeroapi.flightaware.com', 'api.flightplandatabase.com'], forwardsUserInput: true, example: '?from=EGLL&to=KJFK', osiris: false, owner: 'feature-flight-paths' },
  { method: 'GET', path: '/api/route/live', group: 'flight-paths', summary: 'Live aircraft on an airport pair (matched + corridor-inferred)', params: [q('from', 'string', true, 'origin code', 'EGLL'), q('to', 'string', true, 'destination code', 'KJFK'), q('reverse', 'boolean', false, '1 = include B→A')], ttlSeconds: 15, responseSchema: 'RouteLiveResponse', upstreams: ['api.adsb.lol'], forwardsUserInput: true, example: '?from=EGLL&to=KJFK&reverse=1', osiris: false, owner: 'feature-flight-paths' },
  { method: 'GET', path: '/api/flight/{ident}', group: 'flight-paths', summary: 'A specific flight by callsign, IATA flight number, registration or hex', params: [p('ident', 'BAW117, BA117, G-XWBA or 4ca2b3', 'BA117')], ttlSeconds: 60, responseSchema: 'FlightDetailResponse', upstreams: ['vrs-standing-data.adsb.lol', 'api.adsbdb.com', 'hexdb.io', 'api.adsb.lol', 'adsb.lol', 'aviationweather.gov'], forwardsUserInput: true, example: 'BA117', osiris: false, owner: 'feature-flight-paths' },
] as const satisfies readonly ApiEndpoint[];

/**
 * OSIRIS routes deliberately not replicated, with the reason (parity accounting for reviewers).
 */
export const EXCLUDED_OSIRIS_ROUTES = [
  { path: '/api/proxy-tiles', reason: 'CARTO terms (2026-09-29) forbid proxying/caching; GODSEYE uses OpenFreeMap directly.' },
  { path: '/api/osint/username', reason: 'People-search: GODSEYE only runs passive lookups on infrastructure (§0.7).' },
  { path: '/api/osint/fingerprint', reason: 'People-search / identity fingerprinting (§0.7).' },
  { path: '/api/osint/phone', reason: 'People-search (§0.7).' },
  { path: '/api/osint/github', reason: 'People-search (§0.7).' },
  { path: '/api/osint/hudsonrock', reason: 'Infostealer lookups by personal email (§0.7).' },
  { path: '/api/github-webhook', reason: "OSIRIS's own deploy hook, not a product feature." },
] as const;

/** Look up a catalogue entry by its (templated) path. */
export function catalogEntry(path: string, method: 'GET' | 'POST' = 'GET'): ApiEndpoint | undefined {
  return (API_CATALOG as readonly ApiEndpoint[]).find((e) => e.method === method && (e.path === path || e.aliases?.includes(path)));
}

export function endpointsByGroup(): Map<ApiGroup, ApiEndpoint[]> {
  const out = new Map<ApiGroup, ApiEndpoint[]>();
  for (const e of API_CATALOG as readonly ApiEndpoint[]) {
    const list = out.get(e.group) ?? [];
    list.push(e);
    out.set(e.group, list);
  }
  return out;
}

/** Map a catalogue path to its App Router route file, e.g. `/api/airports/{code}` → `src/app/api/airports/[code]/route.ts`. */
export function routeFileFor(path: string): string {
  return `src/app${path.replace(/\{(\w+)\}/g, '[$1]')}/route.ts`;
}

/** Distinct upstream hosts that receive user-supplied input (for the Privacy page). */
export function upstreamsReceivingUserInput(): string[] {
  const hosts = new Set<string>();
  for (const e of API_CATALOG as readonly ApiEndpoint[]) if (e.forwardsUserInput) e.upstreams.forEach((h) => hosts.add(h));
  return [...hosts].sort();
}
