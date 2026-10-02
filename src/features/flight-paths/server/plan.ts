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
import { getFeed, type ProviderRun } from '@/lib/feeds';
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

/** Callsigns currently in the live flights snapshot (read in-process; never fetched for this). */
export function liveCallsigns(): { set: Set<string>; run: ProviderRun } {
  const feed = getFeed('flights');
  if (!feed) return { set: new Set(), run: { status: { ok: false, count: 0, ms: 0, age_s: null, error: 'no_flights_feed' }, okAt: null } };
  const snap = feed.peek();
  const records = (snap.data as { records?: { callsign: string | null }[] } | null)?.records;
  if (!records) return { set: new Set(), run: { status: { ok: false, count: 0, ms: 0, age_s: null, error: 'no_flights_snapshot' }, okAt: null } };
  const set = new Set<string>();
  for (const r of records) if (r.callsign) set.add(r.callsign);
  const at = snap.meta.fetchedAt ? Date.parse(snap.meta.fetchedAt) : null;
  return { set, run: { status: { ok: true, count: set.size, ms: 0, age_s: 0 }, okAt: at } };
}

export function knownServices(o: AirportRecord, d: AirportRecord, live: ReadonlySet<string>): Service[] {
  const a = icaoOf(o);
  const b = icaoOf(d);
  if (!a || !b) return [];
  const idx = vrsIndex();
  const list = [...new Set(idx.byPair.get(`${a}-${b}`) ?? [])].sort();
  return list
    .map((callsign) => ({ callsign, airline: airlineFor(callsign), live: live.has(callsign), source: 'vrs' as const, airportCodes: idx.chainOf.get(callsign) ?? [a, b] }))
    .sort((x, y) => Number(y.live) - Number(x.live) || x.airportCodes.length - y.airportCodes.length || x.callsign.localeCompare(y.callsign))
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
  const live = liveCallsigns();
  const services = knownServices(o, d, live.set);
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
    historicalRoutes: historical,
    ...(airways.run.status.ok ? { airways: airways.airways } : {}),
    ...(filed.length ? { filedPlans: filed } : {}),
    weather: { origin: oWx, destination: dWx, windsAloft: winds.winds },
    diversionAirports: diversions,
    diversionMethod: DIVERSION_METHOD,
    pathLabels: filed.length ? ['GREAT-CIRCLE ESTIMATE', 'FILED'] : ['GREAT-CIRCLE ESTIMATE'],
    providers: providersAt(runs, now),
    timestamp: new Date(now).toISOString(),
  };
}
