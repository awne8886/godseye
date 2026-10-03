/**
 * FlightAware AeroAPI v4 adapter (personal tier), only with the `aeroapi` capability (AEROAPI_KEY;
 * off when COMMERCIAL_DEPLOYMENT=true). The key travels only in the `x-apikey` header — never in a
 * URL, a log line or a response. Every call goes through httpJson and one shared politeness bucket
 * (1 request / 10 s, burst 2; the personal tier allows 10 result sets a minute and bills per result set).
 * Admission is non-blocking (`tryTake`): when no token is free the provider is reported
 * `skipped: 'budget'` (or the last good value is served) instead of queueing, and /api/route/plan
 * waits at most PLAN_WAIT_MS before reporting `error: 'pending'` while the refresh completes in the
 * background. Every request carries the cache's abort signal and its own deadline.
 *
 *  - Filed route for a pair (/api/route/plan): /airports/{o}/flights/to/{d} (one page) → the most
 *    recent flight with a FlightAware id → /flights/{fa_flight_id}/route (decoded fixes). FlightAware
 *    decodes fixes only for routes inside continental US airspace; fixes without coordinates are
 *    dropped. Cached 24 h per pair.
 *  - A flight's schedule (/api/flight/{ident}): /flights/{ident} (one page) → the leg in progress,
 *    else the next scheduled one, else the latest. Cached 10 min per ident.
 *
 * Without a key no request is made (`skipped: not-configured`); a keyless probe answers 401. With a
 * key on a commercial deployment no request is made either, and the provider says why (`skipped:
 * licence`, round 11 — the personal tier's licence, not missing configuration).
 * Server-only.
 */
import 'server-only';
import { sourceCache } from '@/lib/cache';
import { hasCapability } from '@/lib/capabilities';
import { runProvider, skippedProvider, type ProviderRun } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { PROVIDER_PENDING } from '../lib/pending';
import type { FiledPlan } from './fpdb';

export const AEROAPI_HOST = 'aeroapi.flightaware.com';
const BASE = `https://${AEROAPI_HOST}/aeroapi`;
export const AEROAPI_DISCLAIMER = 'Filed IFR route from FlightAware AeroAPI (a recent flight on this pair) — for information only, not for navigation.';

/**
 * One request per 10 s with a burst of 2, so a pair's two calls (flights list → route) need not
 * wait: at most 2 + 6 = 8 result sets in any minute, under the personal tier's 10 per minute.
 */
export const aeroapiBucket = () => providerBucket(AEROAPI_HOST, 1 / 10, 2);

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
  /**
   * One AeroAPI GET. `admitted`: the caller already holds a bucket token for this request (the
   * first call of a refresh); otherwise the call waits for one, bounded by `signal`.
   */
  get: <T>(path: string, opts: { signal: AbortSignal; admitted: boolean }) => Promise<T>;
  /** Non-blocking admission: true when a token was taken now (never queues). */
  tryAdmit: () => boolean;
}

/** Per-request network deadline; the cache's own deadline also aborts via `signal`. */
const REQUEST_DEADLINE_MS = 12_000;

function liveDeps(key: string): AeroDeps {
  const bucket = aeroapiBucket();
  return {
    get: async <T,>(path: string, { signal, admitted }: { signal: AbortSignal; admitted: boolean }) =>
      (
        await httpJson<T>(`${BASE}${path}`, {
          timeoutMs: 10_000,
          deadlineMs: REQUEST_DEADLINE_MS,
          signal,
          retries: 0,
          // Waiting is bounded by `signal`: an aborted wait makes no request (httpJson races the limiter).
          ...(admitted ? {} : { limiter: bucket }),
          headers: { 'x-apikey': key },
        })
      ).data as T,
    tryAdmit: () => bucket.tryTake(),
  };
}

const failed = (error: string): ProviderRun => ({ status: { ok: false, count: 0, ms: 0, age_s: null, error }, okAt: null });
/** A refresh is running in the background and the response did not wait for it. */
export const AEROAPI_PENDING = PROVIDER_PENDING;
const pending = (): ProviderRun => failed(AEROAPI_PENDING);

/** Filed route for the pair (≤ 2 result sets), or none. The first request is already admitted. */
export async function fetchAeroFiledPlan(from: string, to: string, deps: Pick<AeroDeps, 'get'>, now = Date.now(), signal: AbortSignal = new AbortController().signal): Promise<FiledPlan[]> {
  const list = await deps.get<{ flights?: { segments?: AeroFlight[] }[] }>(`/airports/${encodeURIComponent(from)}/flights/to/${encodeURIComponent(to)}?max_pages=1`, { signal, admitted: true });
  const segments = (list?.flights ?? []).flatMap((f) => (f.segments?.length === 1 ? f.segments : []));
  // Most recent departure first: its filed route is the one most likely to be flown today.
  const flown = segments.filter((s) => s.fa_flight_id && !s.cancelled && Number.isFinite(iso(s.actual_off)) && iso(s.actual_off) <= now).sort((a, b) => iso(b.actual_off) - iso(a.actual_off));
  const pick = flown[0] ?? pickFlight(segments, now);
  if (!pick?.fa_flight_id) return [];
  const route = await deps.get<{ route_distance?: string | null; fixes?: AeroFix[] }>(`/flights/${encodeURIComponent(pick.fa_flight_id)}/route`, { signal, admitted: false });
  const plan = mapAeroRoute(pick.fa_flight_id, route?.fixes ?? [], route?.route_distance);
  return plan ? [plan] : [];
}

/** Refreshes this process started and has not finished, by cache key (a joiner never takes a second token). */
const RUNNING = new Map<string, Promise<unknown>>();

type Cached<T> = ReturnType<typeof sourceCache<T>>;

/**
 * Bounded admission in front of a sourceCache: a refresh starts only when the bucket has a token
 * free right now (`tryAdmit`), so callers never queue behind each other. Denied → the last good
 * value if any, else `skipped: 'budget'` (no request was made). Admitted → the refresh runs with
 * the cache's abort signal and deadline; the caller waits at most `waitMs` for it, then gets the
 * last good value or `error: 'pending'` while it finishes in the background and fills the cache.
 * (Admission looks at this process's L1 only; with a shared store a peer's fresh copy is picked up
 * by the refresh's lock poll at the cost of one unused token.)
 */
async function admitted<T>(cache: Cached<T>, deps: AeroDeps, fallback: (run: ProviderRun) => T, waitMs: number): Promise<T> {
  const snap = cache.peek();
  const lastGood = snap.data !== null && snap.fetchedAt !== null ? snap.data : null;
  if (!cache.dueForRefresh()) return snap.data ?? fallback(failed(snap.error ?? 'error'));
  let run = RUNNING.get(cache.key);
  if (!run) {
    // Last good data (stale) beats nothing; with none, say why nothing was asked for.
    if (!deps.tryAdmit()) return lastGood ?? fallback(skippedProvider('budget'));
    run = cache.refresh({ force: true }).finally(() => RUNNING.delete(cache.key));
    RUNNING.set(cache.key, run);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    run.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), waitMs);
    }),
  ]).finally(() => clearTimeout(timer));
  if (!settled) return lastGood ?? fallback(pending());
  const now = cache.peek();
  return now.data ?? fallback(failed(now.error ?? 'error'));
}

/** Why AeroAPI is off: the licence gate when a key is set (COMMERCIAL_DEPLOYMENT=true), else no key. */
export function aeroSkipReason(env: Env = process.env): 'licence' | 'not-configured' {
  return env.AEROAPI_KEY?.trim() ? 'licence' : 'not-configured';
}

/** How long /api/route/plan waits for a new pair's filed route before answering `pending`. */
export const PLAN_WAIT_MS = 2_500;

/** /api/route/plan: AeroAPI filed route for an ICAO pair, cached 24 h; skipped without the capability; never blocks the plan longer than `waitMs`. */
export async function aeroFiledPlans(from: string, to: string, env: Env = process.env, deps?: AeroDeps, waitMs = PLAN_WAIT_MS): Promise<{ plans: FiledPlan[]; run: ProviderRun }> {
  if (!hasCapability('aeroapi', env)) return { plans: [], run: skippedProvider(aeroSkipReason(env)) };
  const d = deps ?? liveDeps(env.AEROAPI_KEY ?? '');
  const cache = sourceCache<{ plans: FiledPlan[]; run: ProviderRun }>(
    `fp:aeroapi:route:${from}-${to}`,
    async (_prev, signal) => {
      const r = await runProvider(() => fetchAeroFiledPlan(from, to, d, Date.now(), signal), (p) => p.length, { allowEmpty: true });
      if (!r.run.status.ok) throw new Error(r.run.status.error ?? 'aeroapi_failed');
      return { data: { plans: r.result ?? [], run: r.run } };
    },
    { ttlMs: 24 * 3_600_000, retryAfterErrorMs: 10 * 60_000, deadlineMs: 30_000, isEmpty: () => false },
  );
  return admitted(cache, d, (run) => ({ plans: [], run }), waitMs);
}

/** /api/flight/{ident}: AeroAPI schedule for a callsign (one result set), cached 10 min; skipped without the capability. */
export async function aeroSchedule(ident: string, env: Env = process.env, deps?: AeroDeps, now = Date.now(), waitMs = 15_000): Promise<{ schedule: AeroSchedule | null; run: ProviderRun }> {
  if (!hasCapability('aeroapi', env)) return { schedule: null, run: skippedProvider(aeroSkipReason(env)) };
  const d = deps ?? liveDeps(env.AEROAPI_KEY ?? '');
  const cache = sourceCache<{ schedule: AeroSchedule | null; run: ProviderRun }>(
    `fp:aeroapi:flight:${ident}`,
    async (_prev, signal) => {
      const r = await runProvider(
        async () => {
          const res = await d.get<{ flights?: AeroFlight[] }>(`/flights/${encodeURIComponent(ident)}?max_pages=1`, { signal, admitted: true });
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
  return admitted(cache, d, (run) => ({ schedule: null, run }), waitMs);
}
