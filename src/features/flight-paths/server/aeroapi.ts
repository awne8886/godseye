/**
 * FlightAware AeroAPI v4 adapter (personal tier), only with the `aeroapi` capability (AEROAPI_KEY;
 * off when COMMERCIAL_DEPLOYMENT=true). The key travels only in the `x-apikey` header — never in a
 * URL, a log line or a response. Every call goes through httpJson and one shared politeness bucket
 * (1 request / 10 s; the personal tier allows 10 result sets a minute and bills per result set).
 *
 *  - Filed route for a pair (/api/route/plan): /airports/{o}/flights/to/{d} (one page) → the most
 *    recent flight with a FlightAware id → /flights/{fa_flight_id}/route (decoded fixes). FlightAware
 *    decodes fixes only for routes inside continental US airspace; fixes without coordinates are
 *    dropped. Cached 24 h per pair.
 *  - A flight's schedule (/api/flight/{ident}): /flights/{ident} (one page) → the leg in progress,
 *    else the next scheduled one, else the latest. Cached 10 min per ident.
 *
 * Without a key no request is made (`skipped: not-configured`); a keyless probe answers 401.
 * Server-only.
 */
import 'server-only';
import { sourceCache } from '@/lib/cache';
import { hasCapability } from '@/lib/capabilities';
import { runProvider, skippedProvider, type ProviderRun } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { FiledPlan } from './fpdb';

export const AEROAPI_HOST = 'aeroapi.flightaware.com';
const BASE = `https://${AEROAPI_HOST}/aeroapi`;
export const AEROAPI_DISCLAIMER = 'Filed IFR route from FlightAware AeroAPI (a recent flight on this pair) — for information only, not for navigation.';

/** One request per 10 s (personal tier: 10 result sets per minute, billed per result set). */
export const aeroapiBucket = () => providerBucket(AEROAPI_HOST, 1 / 10, 1);

// ── AeroAPI v4 shapes (the fields this adapter reads; see the published OpenAPI document) ──
export interface AeroAirportRef {
  code?: string | null;
  code_icao?: string | null;
  code_iata?: string | null;
  code_lid?: string | null;
  timezone?: string | null;
  name?: string | null;
  city?: string | null;
}

export interface AeroFlight {
  ident?: string;
  ident_icao?: string | null;
  ident_iata?: string | null;
  fa_flight_id?: string;
  registration?: string | null;
  origin?: AeroAirportRef | null;
  destination?: AeroAirportRef | null;
  cancelled?: boolean;
  diverted?: boolean;
  status?: string;
  route?: string | null;
  filed_altitude?: number | null;
  scheduled_out?: string | null;
  actual_off?: string | null;
  actual_on?: string | null;
  scheduled_off?: string | null;
}

export interface AeroFix {
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
  type?: string;
}

/** The schedule facts the flight lookup uses. */
export interface AeroSchedule {
  faFlightId: string;
  callsign: string | null;
  iataFlight: string | null;
  registration: string | null;
  /** ICAO (else IATA/LID) codes as FlightAware gives them. */
  origin: string | null;
  destination: string | null;
  scheduledOut: string | null;
  status: string | null;
}

type Env = Record<string, string | undefined>;

const iso = (v: string | null | undefined): number => (v ? Date.parse(v) : NaN);
const codeOf = (a: AeroAirportRef | null | undefined): string | null => {
  const c = a?.code_icao ?? a?.code ?? a?.code_iata ?? a?.code_lid ?? null;
  return c && /^[A-Z0-9]{3,4}$/.test(c) ? c : null;
};

/**
 * The flight an ident means right now: the leg in progress (off, not yet on), else the next
 * scheduled departure, else the most recent one. Cancelled flights are never chosen.
 */
export function pickFlight(flights: readonly AeroFlight[], now: number): AeroFlight | null {
  const usable = flights.filter((f) => f.fa_flight_id && !f.cancelled);
  const enRoute = usable.find((f) => f.actual_off && !f.actual_on);
  if (enRoute) return enRoute;
  const when = (f: AeroFlight) => iso(f.scheduled_out ?? f.scheduled_off);
  const upcoming = usable.filter((f) => !f.actual_off && when(f) >= now).sort((a, b) => when(a) - when(b));
  if (upcoming[0]) return upcoming[0];
  const past = usable.filter((f) => Number.isFinite(when(f))).sort((a, b) => when(b) - when(a));
  return past[0] ?? null;
}

export function toSchedule(f: AeroFlight): AeroSchedule {
  return {
    faFlightId: f.fa_flight_id!,
    callsign: f.ident_icao ?? null,
    iataFlight: f.ident_iata ?? null,
    registration: f.registration ?? null,
    origin: codeOf(f.origin),
    destination: codeOf(f.destination),
    scheduledOut: f.scheduled_out ?? null,
    status: f.status ?? null,
  };
}

/** Decoded fixes → one filed plan (null when fewer than two fixes have coordinates). */
export function mapAeroRoute(faFlightId: string, fixes: readonly AeroFix[], routeDistance: string | null | undefined): FiledPlan | null {
  const pts = fixes.filter(
    (x) => typeof x.latitude === 'number' && typeof x.longitude === 'number' && Math.abs(x.latitude) <= 90 && Math.abs(x.longitude) <= 180 && x.type !== 'UNKNOWN',
  );
  if (pts.length < 2) return null;
  // route_distance is a string like "2,476 mi" in the account's display units: kept only when it says nm.
  const nm = /^([\d,.]+)\s*(nm|nmi)$/i.exec((routeDistance ?? '').trim());
  return {
    id: `aeroapi:${faFlightId}`,
    waypoints: pts.map((x) => ({ ident: String(x.name ?? '').slice(0, 12) || 'WPT', type: String(x.type ?? 'FIX').slice(0, 16), lat: x.latitude!, lng: x.longitude!, altFt: null, via: null })),
    distanceNm: nm ? Math.round(Number(nm[1]!.replace(/,/g, ''))) : null,
    source: 'FlightAware AeroAPI',
    disclaimer: AEROAPI_DISCLAIMER,
  };
}

export interface AeroDeps {
  get: <T>(path: string) => Promise<T>;
}

function liveDeps(key: string): AeroDeps {
  return {
    get: async <T,>(path: string) => (await httpJson<T>(`${BASE}${path}`, { timeoutMs: 10_000, retries: 0, limiter: aeroapiBucket(), headers: { 'x-apikey': key } })).data as T,
  };
}

const failed = (error: string): ProviderRun => ({ status: { ok: false, count: 0, ms: 0, age_s: null, error }, okAt: null });

/** Filed route for the pair (≤ 2 result sets), or none. */
export async function fetchAeroFiledPlan(from: string, to: string, deps: AeroDeps, now = Date.now()): Promise<FiledPlan[]> {
  const list = await deps.get<{ flights?: { segments?: AeroFlight[] }[] }>(`/airports/${encodeURIComponent(from)}/flights/to/${encodeURIComponent(to)}?max_pages=1`);
  const segments = (list?.flights ?? []).flatMap((f) => (f.segments?.length === 1 ? f.segments : []));
  // Most recent departure first: its filed route is the one most likely to be flown today.
  const flown = segments.filter((s) => s.fa_flight_id && !s.cancelled && Number.isFinite(iso(s.actual_off)) && iso(s.actual_off) <= now).sort((a, b) => iso(b.actual_off) - iso(a.actual_off));
  const pick = flown[0] ?? pickFlight(segments, now);
  if (!pick?.fa_flight_id) return [];
  const route = await deps.get<{ route_distance?: string | null; fixes?: AeroFix[] }>(`/flights/${encodeURIComponent(pick.fa_flight_id)}/route`);
  const plan = mapAeroRoute(pick.fa_flight_id, route?.fixes ?? [], route?.route_distance);
  return plan ? [plan] : [];
}

/** /api/route/plan: AeroAPI filed route for an ICAO pair, cached 24 h; skipped without the capability. */
export async function aeroFiledPlans(from: string, to: string, env: Env = process.env, deps?: AeroDeps): Promise<{ plans: FiledPlan[]; run: ProviderRun }> {
  if (!hasCapability('aeroapi', env)) return { plans: [], run: skippedProvider('not-configured') };
  const d = deps ?? liveDeps(env.AEROAPI_KEY ?? '');
  const cache = sourceCache<{ plans: FiledPlan[]; run: ProviderRun }>(
    `fp:aeroapi:route:${from}-${to}`,
    async () => {
      const r = await runProvider(() => fetchAeroFiledPlan(from, to, d), (p) => p.length, { allowEmpty: true });
      if (!r.run.status.ok) throw new Error(r.run.status.error ?? 'aeroapi_failed');
      return { data: { plans: r.result ?? [], run: r.run } };
    },
    { ttlMs: 24 * 3_600_000, retryAfterErrorMs: 10 * 60_000, deadlineMs: 30_000, isEmpty: () => false },
  );
  const r = await cache.get();
  return r.data ?? { plans: [], run: failed(r.error ?? 'error') };
}

/** /api/flight/{ident}: AeroAPI schedule for a callsign, cached 10 min; skipped without the capability. */
export async function aeroSchedule(ident: string, env: Env = process.env, deps?: AeroDeps, now = Date.now()): Promise<{ schedule: AeroSchedule | null; run: ProviderRun }> {
  if (!hasCapability('aeroapi', env)) return { schedule: null, run: skippedProvider('not-configured') };
  const d = deps ?? liveDeps(env.AEROAPI_KEY ?? '');
  const cache = sourceCache<{ schedule: AeroSchedule | null; run: ProviderRun }>(
    `fp:aeroapi:flight:${ident}`,
    async () => {
      const r = await runProvider(
        async () => {
          const res = await d.get<{ flights?: AeroFlight[] }>(`/flights/${encodeURIComponent(ident)}?max_pages=1`);
          const f = pickFlight(res?.flights ?? [], now);
          return f ? toSchedule(f) : null;
        },
        (s) => (s ? 1 : 0),
        { allowEmpty: true },
      );
      if (!r.run.status.ok) throw new Error(r.run.status.error ?? 'aeroapi_failed');
      return { data: { schedule: r.result, run: r.run } };
    },
    { ttlMs: 10 * 60_000, retryAfterErrorMs: 5 * 60_000, deadlineMs: 15_000, isEmpty: () => false },
  );
  const r = await cache.get();
  return r.data ?? { schedule: null, run: failed(r.error ?? 'error') };
}
