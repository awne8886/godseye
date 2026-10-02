/**
 * GET /api/route/plan builder (§8): great circle, block-time estimates, time zones, daylight,
 * known services (VRS standing data, LIVE when the callsign is in the flights snapshot),
 * historical routes (OpenFlights 2014), filed plans (keyed: FlightAware AeroAPI real filed IFR
 * routes, FlightPlanDatabase sim-community plans), US airways near the route (bundled FAA ADDS
 * snapshot), METAR/TAF at both ends, winds aloft (Open-Meteo, capability-gated) and diversion
 * airports. Server-only.
 */
import 'server-only';
import type { z } from 'zod';
import { getFeed, type Feed, type ProviderRun } from '@/lib/feeds';
import { entityFreshness } from '@/lib/freshness';
import { OBSERVATION_CADENCE_MS } from '@/lib/layer-registry';
import type { FreshnessState } from '@/lib/types';
import { honestFlights } from '@/features/aviation/server/view';
import type { LngLatTuple } from '@/lib/geo';
import type { Providers } from '@/lib/types';
import type { KnownService, RouteEndpoint, RoutePlanResponse } from '@/lib/schemas/flight-paths';
import { DAYLIGHT_METHOD, DIVERSION_METHOD, ESTIMATE_METHOD, daylightSamples, estimatesByClass, greatCircle, samplePoints, selectDiversions, type DiversionCandidate } from '../lib/geometry';
import { localTimeIso, offsetDeltaHours } from '../lib/time';
import { emptyWeather } from '../lib/metar';
import { airportIndex, openFlights, vrsIndex, type AirportRecord } from './data';
import { aeroFiledPlans } from './aeroapi';
import { routeAirways } from './airways';
import { filedPlans } from './fpdb';
import { stationFor, stationWeather } from './weather';
import { windsAloft } from './winds';

export type RoutePlan = z.infer<typeof RoutePlanResponse>;
type Endpoint = z.infer<typeof RouteEndpoint>;
type Service = z.infer<typeof KnownService>;

export const WIND_SAMPLES = 8;
export const MAX_SERVICES = 200;

export function endpoint(a: AirportRecord): Endpoint {
  return { ident: a.ident, icao: a.icao, iata: a.iata, name: a.name, lat: a.lat, lng: a.lng, tz: a.tz, municipality: a.municipality, isoCountry: a.isoCountry };
}

/** 4-character code used by the VRS table and AWC for an airport. */
export const icaoOf = (a: AirportRecord): string | null => [a.icao, a.gps, a.ident.toUpperCase()].find((c) => typeof c === 'string' && /^[A-Z0-9]{4}$/.test(c)) ?? null;

export function airlineFor(callsign: string): Service['airline'] {
  const code = /^[A-Z]{3}(?=\d)/.exec(callsign)?.[0] ?? null;
  const al = code ? openFlights().airlines[code] : undefined;
  return { icao: code, iata: al?.[0] ?? null, name: al?.[1] ?? null };
}

export interface LiveCallsigns {
  /** callsign → its newest own observation (ms epoch) in a LIVE/RECENT snapshot. */
  seen: Map<string, number>;
  /** honestFlights-capped state of the snapshot ('offline' when there is none). */
  state: FreshnessState;
  run: ProviderRun;
}

/**
 * Callsigns in the in-process flights snapshot (read with peek(); never fetched for this).
 * Round 6: the snapshot is not eager — it freezes ~10 min after the aviation layer stops reading
 * it, and records live up to the sweep's prune age — so a callsign is only reported from a
 * snapshot whose honest state (`honestFlights`) is LIVE or RECENT, with its own `seenAt`; a
 * frozen/stale/failed snapshot is `ok: false, error: 'stale_snapshot'` and marks nothing.
 */
export function liveCallsigns(feed: Pick<Feed<unknown>, 'peek'> | undefined, now = Date.now()): LiveCallsigns {
  const none = (error: string, state: FreshnessState = 'offline', ageS: number | null = null): LiveCallsigns => ({
    seen: new Map(),
    state,
    run: { status: { ok: false, count: 0, ms: 0, age_s: ageS, error }, okAt: null },
  });
  if (!feed) return none('no_flights_feed');
  const snap = honestFlights(feed.peek());
  const records = (snap.data as { records?: { callsign: string | null; seenAt?: number | null }[] } | null)?.records;
  if (!records) return none('no_flights_snapshot');
  const fetched = snap.meta.fetchedAt ? Date.parse(snap.meta.fetchedAt) : NaN;
  const okAt = Number.isFinite(fetched) ? fetched : null;
  const state = snap.meta.state;
  if (state !== 'live' && state !== 'recent') return none('stale_snapshot', state, okAt === null ? null : Math.max(0, Math.round((now - okAt) / 1000)));
  const seen = new Map<string, number>();
  for (const r of records) {
    if (!r.callsign || typeof r.seenAt !== 'number' || !Number.isFinite(r.seenAt)) continue;
    const at = r.seenAt * 1000;
    // Never report an observation from the future, nor one older than the RECENT window.
    if (at - now > 60_000 || now - at > OBSERVATION_CADENCE_MS.flights * 6) continue;
    const prev = seen.get(r.callsign);
    if (prev === undefined || at > prev) seen.set(r.callsign, at);
  }
  return { seen, state, run: { status: { ok: true, count: seen.size, ms: 0, age_s: 0 }, okAt } };
}

export function knownServices(o: AirportRecord, d: AirportRecord, live: Pick<LiveCallsigns, 'seen' | 'state'>, now = Date.now()): Service[] {
  const a = icaoOf(o);
  const b = icaoOf(d);
  if (!a || !b) return [];
  const idx = vrsIndex();
  const list = [...new Set(idx.byPair.get(`${a}-${b}`) ?? [])].sort();
  return list
    .map((callsign) => {
      const at = live.seen.get(callsign) ?? null;
      const isLive =
        at !== null && entityFreshness({ kind: 'live', at, observationCadenceMs: OBSERVATION_CADENCE_MS.flights, feedState: live.state, now }) === 'live';
      return {
        callsign,
        airline: airlineFor(callsign),
        live: isLive,
        observedAt: at === null ? null : new Date(at).toISOString(),
        source: 'vrs' as const,
        airportCodes: idx.chainOf.get(callsign) ?? [a, b],
      };
    })
    .sort(
      (x, y) =>
        Number(y.live) - Number(x.live) ||
        Number(y.observedAt !== null) - Number(x.observedAt !== null) ||
        x.airportCodes.length - y.airportCodes.length ||
        x.callsign.localeCompare(y.callsign),
    )
    .slice(0, MAX_SERVICES);
}

export function historicalRoutes(o: AirportRecord, d: AirportRecord): RoutePlan['historicalRoutes'] {
  const routes = openFlights().routes;
  const keys = new Set([o.iata && d.iata ? `${o.iata}-${d.iata}` : null, o.icao && d.icao ? `${o.icao}-${d.icao}` : null].filter((k): k is string => k !== null));
  const out: RoutePlan['historicalRoutes'] = [];
  for (const k of keys) {
    for (const [airline, codeshare, stops, equipment] of routes[k] ?? []) {
      out.push({ airline, codeshare: codeshare === 1, stops, equipment: equipment.split(/\s+/).filter(Boolean) });
    }
  }
  return out.sort((x, y) => Number(x.codeshare) - Number(y.codeshare) || x.airline.localeCompare(y.airline));
}

let diversionPool: DiversionCandidate[] | null = null;
function diversionCandidates(): DiversionCandidate[] {
  if (diversionPool) return diversionPool;
  diversionPool = airportIndex('min')
    .list.filter((a) => (a.longestRunwayM ?? 0) >= 2400)
    .map((a) => ({ code: a.iata ?? a.icao ?? a.ident, name: a.name, lat: a.lat, lng: a.lng, runwayM: a.longestRunwayM }));
  return diversionPool;
}

const ageFrom = (iso: string | null | undefined, now: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null;
};

function providersAt(runs: Record<string, ProviderRun>, now: number): Providers {
  // Bundled files carry their build age in status.age_s (okAt null); live providers age from okAt.
  return Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, { ...r.status, age_s: r.okAt ? Math.max(0, Math.round((now - r.okAt) / 1000)) : r.status.age_s }]));
}

export async function buildPlan(o: AirportRecord, d: AirportRecord, now = Date.now()): Promise<RoutePlan> {
  const A: LngLatTuple = [o.lng, o.lat];
  const B: LngLatTuple = [d.lng, d.lat];
  const gc = greatCircle(A, B);
  const minIdx = airportIndex('min');
  const vrs = vrsIndex();
  const of = openFlights();
  const live = liveCallsigns(getFeed('flights'), now);
  const services = knownServices(o, d, live, now);
  const historical = historicalRoutes(o, d);
  const exclude = new Set([o.iata, o.icao, o.ident, d.iata, d.icao, d.ident].filter((c): c is string => !!c));
  const diversions = selectDiversions(A, B, diversionCandidates(), exclude);

  const airways = routeAirways(gc.points, now);
  const pair = icaoOf(o) && icaoOf(d) ? ([icaoOf(o)!, icaoOf(d)!] as const) : null;
  const [wx, winds, fpdb, aero] = await Promise.all([
    stationWeather([stationFor(o), stationFor(d)]),
    windsAloft(samplePoints(A, B, WIND_SAMPLES)),
    pair ? filedPlans(pair[0], pair[1]) : Promise.resolve(null),
    pair ? aeroFiledPlans(pair[0], pair[1]) : Promise.resolve(null),
  ]);
  const oWx = wx.byStation.get(stationFor(o) ?? '') ?? emptyWeather();
  const dWx = wx.byStation.get(stationFor(d) ?? '') ?? emptyWeather();

  const bundledRun = (count: number, generatedAt: string): ProviderRun => ({ status: { ok: true, count, ms: 0, age_s: ageFrom(generatedAt, now) }, okAt: null });
  const runs: Record<string, ProviderRun> = {
    ourairports: bundledRun(2 + diversions.length, minIdx.generatedAt),
    vrs_routes: bundledRun(services.length, vrs.generatedAt),
    openflights: bundledRun(historical.length, of.generatedAt),
    ...wx.providers,
    openmeteo: winds.run,
    flights: live.run,
  };
  if (fpdb) runs.fpdb = fpdb.run;
  if (aero) runs.aeroapi = aero.run;
  runs.faa_adds = airways.run;

  // Real filed IFR routes (AeroAPI) before sim-community plans.
  const filed = [...(aero?.plans ?? []), ...(fpdb?.plans ?? [])];
  return {
    origin: endpoint(o),
    destination: endpoint(d),
    greatCircle: gc,
    estimates: { byClass: estimatesByClass(gc.distanceKm), method: ESTIMATE_METHOD },
    timezones: {
      origin: { tz: o.tz, localNow: localTimeIso(o.tz, now) },
      destination: { tz: d.tz, localNow: localTimeIso(d.tz, now) },
      offsetHours: offsetDeltaHours(o.tz, d.tz, now),
    },
    daylight: daylightSamples(A, B, now),
    daylightMethod: DAYLIGHT_METHOD,
    knownServices: services,
    flightsState: live.state,
    historicalRoutes: historical,
    ...(airways.run.status.ok ? { airways: airways.airways } : {}),
    ...(airways.run.status.ok && airways.source && airways.airways.length ? { airwaysSource: airways.source } : {}),
    ...(filed.length ? { filedPlans: filed } : {}),
    weather: { origin: oWx, destination: dWx, windsAloft: winds.winds },
    diversionAirports: diversions,
    diversionMethod: DIVERSION_METHOD,
    pathLabels: filed.length ? ['GREAT-CIRCLE ESTIMATE', 'FILED'] : ['GREAT-CIRCLE ESTIMATE'],
    providers: providersAt(runs, now),
    timestamp: new Date(now).toISOString(),
  };
}
