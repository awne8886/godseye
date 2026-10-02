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
  fpdb: { env: ['FPDB_API_KEY'], note: 'FlightPlanDatabase (sim-only filed plans)' },
  aeroapi: { env: ['AEROAPI_KEY'], invertFlag: 'COMMERCIAL_DEPLOYMENT', note: 'FlightAware AeroAPI personal tier (filed routes, schedules; non-commercial)' },
  // Space
  // Hazards
  // Maritime
  ais: { env: ['AIS_API_KEY'], note: 'AISStream.io server relay' },
  // Surveillance
  tfl: { env: ['TFL_APP_KEY'], note: 'TfL Unified API app_key ("Powered by TfL Open Data")' },
  trafikverket: { env: ['TRAFIKVERKET_KEY'], note: 'Trafikverket API (stills are keyless)' },
  // Threats / network
  cloudflare: { env: ['CLOUDFLARE_API_TOKEN'], invertFlag: 'COMMERCIAL_DEPLOYMENT', note: 'Cloudflare Radar (Radar: Read; data CC BY-NC)' },
  abusech: { env: ['ABUSECH_AUTH_KEY'], note: 'abuse.ch APIs (bulk files stay keyless)' },
  nvd: { env: ['NVD_API_KEY'], note: 'NVD 2.0 higher rate' },
  otx: { env: ['OTX_KEY'], note: 'AlienVault OTX' },
  // OSINT
  opensanctions: { env: ['OPENSANCTIONS_KEY'], note: 'OpenSanctions API' },
  scanner: { env: ['SCANNER_URL', 'SCANNER_KEY'], note: 'Optional allow-listed scanner backend (passive scan types)' },
  scanner_active: { env: ['SCANNER_URL', 'SCANNER_KEY'], flag: 'SCANNER_ALLOW_ACTIVE', note: 'Operator opt-in for active scan types (quick/vuln)' },
  // Markets
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
    note: 'Non-commercial sources: TeleGeography cables, OpenSanctions bulk (CC BY-NC), abuse.ch (not-for-profit), ip-api and Shodan InternetDB (non-commercial), City of Edmonton cameras (personal, educational or non-commercial use only)',
  },
  openmeteo: { env: [], invertFlag: 'COMMERCIAL_DEPLOYMENT', note: 'Open-Meteo free tier (non-commercial; CC BY 4.0 data)' },
  deepstate: { env: [], flag: 'NONCOMMERCIAL', note: "DeepStateMap frontlines (non-commercial, attribution; commercial API use needs DeepState's prior approval)" },
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
