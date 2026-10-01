/**
 * Aviation upstream adapters (§4 FlightsProvider). Server-only.
 *  - adsblol_tiles (default, keyless, ODbL): `/v2/point/{lat}/{lon}/250` over the coverage grid,
 *    ≤ 1 request in flight (adsblolSerial), one start every 1.2 s via providerBucket('api.adsb.lol'),
 *    read continuously by the background TileSweeper (tile-sweeper.ts) and drained per feed run.
 *  - adsblol_mil / _ladd / _pia (keyless): global lists; rows without lat/lon are `noPosition`.
 *  - adsblol_reapi (`ADSBLOL_REAPI=true`, feeder IP only): `re-api.adsb.lol/?all_with_pos&jv2`,
 *    replaces the tile sweep when enabled.
 *  - opensky (`OPENSKY_LICENSED=true` + OAuth2 client credentials; written licence required).
 *  - adsbfi_mil (`ADSBFI_PERSONAL_USE=true`; personal, non-commercial use only; 1 req/s).
 * airplanes.live is not used (403 on every endpoint, contact-gated; docs/reference/25 §15).
 */
import 'server-only';
import { httpJson, HttpError } from '@/lib/http';
import { providerBucket, SerialQueue } from '@/lib/ratelimit';
import { classifyAircraft, isHelicopter } from '../classify';
import { cleanCallsign, emergencyOf, normalizeAdsbResponse, type AdsbResponse, type FlightRecord, type NormalizedBatch } from '../adsb';
import { tileUrl, type Tile } from '../tiles';

/** One start every 1.2 s across every api.adsb.lol request (tiles and global lists). */
export const ADSBLOL_RATE_PER_S = 1 / 1.2;
export const adsblolBucket = () => providerBucket('api.adsb.lol', ADSBLOL_RATE_PER_S, 1);
/**
 * ≤ 1 api.adsb.lol request in flight: the background tile worker and the feed run's global lists
 * share this queue (the bucket above spaces the starts). Pinned on globalThis across HMR.
 */
const G = globalThis as unknown as { __godseyeAdsblolSerial?: SerialQueue };
export const adsblolSerial = (G.__godseyeAdsblolSerial ??= new SerialQueue(0, 32));
const adsbfiBucket = () => providerBucket('opendata.adsb.fi', 1, 1);
const openskyBucket = () => providerBucket('opensky-network.org', 1, 1);

export const ADSBLOL_GLOBAL = {
  adsblol_mil: 'https://api.adsb.lol/v2/mil',
  adsblol_ladd: 'https://api.adsb.lol/v2/ladd',
  adsblol_pia: 'https://api.adsb.lol/v2/pia',
} as const;
export type GlobalKey = keyof typeof ADSBLOL_GLOBAL;

export const REAPI_URL = 'https://re-api.adsb.lol/?all_with_pos&jv2';
export const ADSBFI_MIL_URL = 'https://opendata.adsb.fi/api/v2/mil';
export const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all?extended=1';
export const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

export async function fetchAdsbJson(url: string, source: string, signal: AbortSignal, opts: { timeoutMs?: number; limiter?: { take(): Promise<void> } } = {}): Promise<NormalizedBatch> {
  const res = await httpJson<AdsbResponse & { aircraft?: AdsbResponse['ac'] }>(url, {
    signal,
    timeoutMs: opts.timeoutMs ?? 10_000,
    retries: 0,
    limiter: opts.limiter ?? adsblolBucket(),
  });
  const body = res.data;
  if (!body || (!Array.isArray(body.ac) && !Array.isArray(body.aircraft))) throw new HttpError('Unexpected body (no ac[])', 'parse', url, res.status);
  return normalizeAdsbResponse({ ...body, ac: body.ac ?? body.aircraft }, source, Date.now());
}

export function fetchTile(tile: Tile, signal: AbortSignal): Promise<NormalizedBatch> {
  return adsblolSerial.run(() => fetchAdsbJson(tileUrl(tile), 'adsblol_tiles', signal));
}

export function fetchGlobal(key: GlobalKey, signal: AbortSignal): Promise<NormalizedBatch> {
  return adsblolSerial.run(() => fetchAdsbJson(ADSBLOL_GLOBAL[key], key, signal, { timeoutMs: 15_000 }));
}

export function fetchReapi(signal: AbortSignal): Promise<NormalizedBatch> {
  return fetchAdsbJson(REAPI_URL, 'adsblol_reapi', signal, { timeoutMs: 20_000, limiter: providerBucket('re-api.adsb.lol', 1 / 5, 1) });
}

export function fetchAdsbfiMil(signal: AbortSignal): Promise<NormalizedBatch> {
  return fetchAdsbJson(ADSBFI_MIL_URL, 'adsbfi_mil', signal, { timeoutMs: 15_000, limiter: adsbfiBucket() });
}

// ── OpenSky (licensed only) ─────────────────────────────────────────────────────
/** Token lives in process memory only (never in the snapshot store, never logged). */
let openskyToken: { value: string; until: number } | null = null;

async function openskyAccessToken(env: Record<string, string | undefined>, signal: AbortSignal): Promise<string> {
  if (openskyToken && openskyToken.until > Date.now()) return openskyToken.value;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: env.OPENSKY_CLIENT_ID ?? '', client_secret: env.OPENSKY_CLIENT_SECRET ?? '' }).toString();
  const res = await httpJson<{ access_token?: string; expires_in?: number }>(OPENSKY_TOKEN_URL, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal,
    timeoutMs: 10_000,
  });
  const token = res.data?.access_token;
  if (!token) throw new HttpError('OpenSky token response without access_token', 'parse', OPENSKY_TOKEN_URL, res.status);
  openskyToken = { value: token, until: Date.now() + Math.max(60, (res.data?.expires_in ?? 1800) - 60) * 1000 };
  return token;
}

type OpenSkyState = [string, string | null, string, number | null, number, number | null, number | null, number | null, boolean, number | null, number | null, number | null, unknown, number | null, string | null, boolean, number, number?];

const M_TO_FT = 3.28084;
const MS_TO_KT = 1.943844;
const MS_TO_FPM = 196.8504;
const POSITION_SOURCE: Record<number, FlightRecord['posSource']> = { 0: 'adsb', 1: 'other', 2: 'mlat', 3: 'other' };

/**
 * OpenSky state vectors → records (docs/reference/25 §0 mapping; metres/m·s⁻¹ converted to ft/kt).
 * `time_position` is whole epoch seconds; it is never dated after `receivedAtMs` (our receipt).
 */
export function mapOpenSkyStates(states: readonly unknown[], receivedAtMs = Date.now()): NormalizedBatch {
  const receivedS = Math.floor(receivedAtMs / 1000);
  const records: FlightRecord[] = [];
  const noPosition: string[] = [];
  for (const raw of states) {
    if (!Array.isArray(raw)) continue;
    const s = raw as OpenSkyState;
    const id = String(s[0] ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(id)) continue;
    const lng = typeof s[5] === 'number' ? s[5] : null;
    const lat = typeof s[6] === 'number' ? s[6] : null;
    const seen = typeof s[3] === 'number' ? s[3] : null;
    if (lat === null || lng === null || seen === null) {
      noPosition.push(id);
      continue;
    }
    const callsign = cleanCallsign(s[1]);
    const altFt = typeof s[7] === 'number' && !s[8] ? Math.round(s[7] * M_TO_FT) : null;
    const gsKt = typeof s[9] === 'number' ? Math.round(s[9] * MS_TO_KT * 10) / 10 : null;
    const categoryOs = typeof s[17] === 'number' ? s[17] : null;
    const squawk = typeof s[14] === 'string' && /^[0-7]{4}$/.test(s[14]) ? s[14] : null;
    records.push({
      id,
      callsign,
      registration: null,
      typeCode: null,
      bucket: classifyAircraft({ typeCode: null, callsign, dbFlags: null, categoryOs, altFt, gsKt }),
      isHelicopter: isHelicopter(null, categoryOs),
      onGround: s[8] === true,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      altFt,
      altGeomFt: typeof s[13] === 'number' ? Math.round(s[13] * M_TO_FT) : null,
      gsKt,
      trackDeg: typeof s[10] === 'number' ? (Math.round(s[10] * 10) / 10) % 360 : null,
      vrFpm: typeof s[11] === 'number' ? Math.round(s[11] * MS_TO_FPM) : null,
      squawk,
      emergency: emergencyOf(squawk),
      category: null,
      nacP: null,
      dbFlags: null,
      seenAt: Math.min(Math.floor(seen), receivedS),
      source: 'opensky',
      posSource: POSITION_SOURCE[s[16]] ?? null,
    });
  }
  return { records, noPosition };
}

export class RateLimitedError extends HttpError {
  constructor(url: string, readonly retryAfterS: number) {
    super('Rate limited', 'http', url, 429);
  }
}

export async function fetchOpenSky(env: Record<string, string | undefined>, signal: AbortSignal): Promise<NormalizedBatch> {
  const token = await openskyAccessToken(env, signal);
  try {
    const res = await httpJson<{ time?: number; states?: unknown[] | null }>(OPENSKY_STATES_URL, {
      headers: { authorization: `Bearer ${token}` },
      signal,
      timeoutMs: 30_000,
      retries: 0,
      limiter: openskyBucket(),
    });
    return mapOpenSkyStates(res.data?.states ?? [], Date.now());
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) openskyToken = null;
    if (e instanceof HttpError && e.status === 429) throw new RateLimitedError(OPENSKY_STATES_URL, 15 * 60);
    throw e;
  }
}
