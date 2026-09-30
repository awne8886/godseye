/**
 * Server-side capability flags derived from the environment. Everything works with zero keys;
 * keys only unlock upgrades. /api/health exposes these so the UI hides what is not configured.
 * Never read these in client code: the UI gets them from /api/health.
 * Owner: lead (shared). Builders request new capabilities in their report.
 */

export const CAPABILITIES = {
  // Aviation
  adsblol_reapi: { env: ['ADSBLOL_REAPI'], flag: 'ADSBLOL_REAPI', note: 'adsb.lol re-api (feeder IP only)' },
  opensky: { env: ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'], flag: 'OPENSKY_LICENSED', note: 'OpenSky OAuth2 + written licence' },
  adsbfi: { env: [], flag: 'ADSBFI_PERSONAL_USE', note: 'adsb.fi open data (personal use only)' },
  aeroapi: { env: ['AEROAPI_KEY'], note: 'FlightAware AeroAPI (filed routes, schedules)' },
  fpdb: { env: ['FPDB_API_KEY'], note: 'FlightPlanDatabase (sim-only filed plans)' },
  // Space
  n2yo: { env: ['N2YO_API_KEY'], note: 'N2YO visual passes' },
  // Hazards
  firms_area: { env: ['FIRMS_MAP_KEY'], note: 'NASA FIRMS area API' },
  openaq: { env: ['OPENAQ_API_KEY'], note: 'OpenAQ v3' },
  waqi: { env: ['WAQI_TOKEN'], note: 'World Air Quality Index' },
  cdse: { env: ['CDSE_CLIENT_ID', 'CDSE_CLIENT_SECRET'], note: 'Copernicus Data Space (Sentinel Hub)' },
  // Maritime
  ais: { env: ['AIS_API_KEY'], note: 'AISStream.io server relay' },
  // Surveillance
  windy: { env: ['WINDY_WEBCAMS_KEY'], note: 'Windy Webcams v3 (x-windy-api-key header)' },
  tfl: { env: ['TFL_APP_KEY'], note: 'TfL Unified API app_key ("Powered by TfL Open Data")' },
  wsdot: { env: ['WSDOT_ACCESS_CODE'], note: 'WSDOT Traveler API (the camera KML is keyless)' },
  trafikverket: { env: ['TRAFIKVERKET_KEY'], note: 'Trafikverket API (stills are keyless)' },
  ibi511: { env: ['IBI511_KEYS'], note: 'IBI 511 developer keys, e.g. "fl:KEY,ga:KEY" (FL, GA, NC, AZ, LA, NV, UT)' },
  // Threats / network
  cloudflare: { env: ['CLOUDFLARE_API_TOKEN'], invertFlag: 'COMMERCIAL_DEPLOYMENT', note: 'Cloudflare Radar (Radar: Read; data CC BY-NC)' },
  acled: { env: ['ACLED_EMAIL', 'ACLED_PASSWORD'], note: 'ACLED OAuth' },
  ucdp: { env: ['UCDP_TOKEN'], note: 'UCDP GED x-ucdp-access-token' },
  abusech: { env: ['ABUSECH_AUTH_KEY'], note: 'abuse.ch APIs (bulk files stay keyless)' },
  nvd: { env: ['NVD_API_KEY'], note: 'NVD 2.0 higher rate' },
  otx: { env: ['OTX_KEY'], note: 'AlienVault OTX' },
  // OSINT
  shodan: { env: ['SHODAN_KEY'], note: 'Shodan full API (InternetDB is keyless)' },
  ipinfo: { env: ['IPINFO_TOKEN'], note: 'IPinfo Lite' },
  opensanctions: { env: ['OPENSANCTIONS_KEY'], note: 'OpenSanctions API' },
  etherscan: { env: ['ETHERSCAN_API_KEY'], note: 'Etherscan' },
  helius: { env: ['HELIUS_API_KEY'], note: 'Helius Solana RPC' },
  scanner: { env: ['SCANNER_URL', 'SCANNER_KEY'], note: 'Optional allow-listed scanner backend (passive scan types)' },
  scanner_active: { env: ['SCANNER_URL', 'SCANNER_KEY'], flag: 'SCANNER_ALLOW_ACTIVE', note: 'Operator opt-in for active scan types (quick/vuln)' },
  // Markets
  finnhub: { env: ['FINNHUB_KEY'], note: 'Finnhub quotes' },
  coingecko_demo: { env: ['COINGECKO_DEMO_KEY'], note: 'CoinGecko demo key' },
  // AI
  anthropic: { env: ['ANTHROPIC_API_KEY'], note: 'Claude analyst (briefings/overviews)' },
  gemini: { env: ['GEMINI_API_KEY_1'], note: 'Gemini fallback analyst' },
  /** Server-configured only; a visitor can never supply an Ollama URL (that would be an SSRF path). */
  ollama: { env: ['OLLAMA_URL'], note: 'Local Ollama analyst (operator-configured URL)' },
  ai_user_keys: { env: [], invertFlag: 'DISABLE_USER_AI_KEYS', note: 'Visitors may send their own provider key in the x-ai-key header (used once, never stored)' },
  // Infra
  redis: { env: ['REDIS_URL'], note: 'Shared cache + rate limits across instances' },
  sdk: { env: ['SDK_INGEST_KEY'], note: 'GODSEYE SDK entity ingest (fail-closed without a key)' },
  // Licensing gates
  nc_sources: {
    env: [],
    invertFlag: 'COMMERCIAL_DEPLOYMENT',
    note: 'Non-commercial sources: TeleGeography cables, OpenSanctions bulk (CC BY-NC), abuse.ch (not-for-profit), ip-api and Shodan InternetDB (non-commercial), Edmonton cameras',
  },
  openmeteo: { env: [], invertFlag: 'COMMERCIAL_DEPLOYMENT', note: 'Open-Meteo free tier (non-commercial; CC BY 4.0 data)' },
  deepstate: { env: [], flag: 'NONCOMMERCIAL', note: 'DeepStateMap frontlines (non-commercial, attribution)' },
  photoreal: { env: ['GOOGLE_MAPS_API_KEY'], note: 'Standalone Photoreal City View (Google 3D Tiles)' },
} as const satisfies Record<string, CapabilitySpec>;

export interface CapabilitySpec {
  /** All of these must be non-empty. */
  env: readonly string[];
  /** If set, this env var must equal "true". */
  flag?: string;
  /** If set, this env var must NOT equal "true". */
  invertFlag?: string;
  note: string;
}

export type CapabilityId = keyof typeof CAPABILITIES;

export interface CapabilityResult {
  enabled: boolean;
  reason: string | null;
}

export function evaluateCapability(id: CapabilityId, env: Record<string, string | undefined> = process.env): CapabilityResult {
  const spec: CapabilitySpec = CAPABILITIES[id];
  const missing = spec.env.filter((k) => !env[k]?.trim());
  if (missing.length) return { enabled: false, reason: `${missing.join(', ')} not set` };
  if (spec.flag && env[spec.flag] !== 'true') return { enabled: false, reason: `${spec.flag} is not "true"` };
  if (spec.invertFlag && env[spec.invertFlag] === 'true') return { enabled: false, reason: `${spec.invertFlag} is "true"` };
  // Licence gates that also depend on another gate.
  if (id === 'deepstate' && env.COMMERCIAL_DEPLOYMENT === 'true') return { enabled: false, reason: 'COMMERCIAL_DEPLOYMENT is "true"' };
  return { enabled: true, reason: null };
}

export function evaluateCapabilities(env: Record<string, string | undefined> = process.env): Record<CapabilityId, CapabilityResult> {
  return Object.fromEntries(
    (Object.keys(CAPABILITIES) as CapabilityId[]).map((id) => [id, evaluateCapability(id, env)]),
  ) as Record<CapabilityId, CapabilityResult>;
}

export function hasCapability(id: CapabilityId, env: Record<string, string | undefined> = process.env): boolean {
  return evaluateCapability(id, env).enabled;
}
