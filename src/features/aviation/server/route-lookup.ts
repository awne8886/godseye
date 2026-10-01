/**
 * Callsign → route for GET /api/flight-route. Order (docs/reference/21, 25; §6):
 *  1. VRS standing data on adsb.lol (CC0): `vrs-standing-data.adsb.lol/routes/{CS[0:2]}/{CS}.json`.
 *  2. adsbdb `/v0/callsign/{CS}` (per request only; adsbdb route data may not be copied into
 *     other databases, so it is cached briefly and never bulk-stored).
 *  3. hexdb `/api/v1/route/icao/{CS}` (§6.2: the old `/route/callsign/` path is gone) + hexdb
 *     airport lookups; its records can be years old, so the answer carries `sourceUpdatedAt` and
 *     is labelled stale when older than 180 days.
 * With a current position, `basis`/`status`/`progress` come from the great circle; otherwise
 * `basis: 'schedule'`, `status: 'unknown'`. With `icao24`, the exact observed position of that
 * aircraft in the flights snapshot judges the leg (the card's query is quantised), and its flown
 * track corroborates a reverse leg. The observed direction beats the schedule: a leg the
 * observed course contradicts is withheld with a reason (same rule as the FLIGHT view,
 * src/features/flight-paths/server/flight.ts). Server-only.
 */
import 'server-only';
import type { z } from 'zod';
import { httpJson, HttpError } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { sourceCache } from '@/lib/cache';
import { getFeed, runProvider, type ProviderRun } from '@/lib/feeds';
import type { LngLatTuple } from '@/lib/geo';
import type { FlightRouteResponse, RouteAirport } from '@/lib/schemas/aviation';
import type { Providers } from '@/lib/types';
import type { FlightRecord } from '../adsb';
import type { TrackPoint } from '../trace';
import { directionConflict, isImplausible, lastLowEnd, pickLeg, routeProgress, type RoutePosition } from '../route-geometry';
import { adsbdbBucket, aircraftDetail } from './aircraft';

export { IMPLAUSIBLE_FACTOR, isImplausible, pickLeg, routeProgress } from '../route-geometry';

export type FlightRoute = z.infer<typeof FlightRouteResponse>;
type Airport = z.infer<typeof RouteAirport>;

export const VRS_URL = (cs: string) => `https://vrs-standing-data.adsb.lol/routes/${cs.slice(0, 2)}/${cs}.json`;
export const ADSBDB_CALLSIGN = (cs: string) => `https://api.adsbdb.com/v0/callsign/${cs}`;
export const HEXDB_ROUTE = (cs: string) => `https://hexdb.io/api/v1/route/icao/${cs}`;
export const HEXDB_AIRPORT = (icao: string) => `https://hexdb.io/api/v1/airport/icao/${icao}`;

const vrsBucket = () => providerBucket('vrs-standing-data.adsb.lol', 4, 4);
const hexdbBucket = () => providerBucket('hexdb.io', 1, 2);
const STALE_AFTER_MS = 180 * 86_400_000;

export interface RouteCandidate {
  airports: Airport[];
  source: 'vrs' | 'adsbdb' | 'hexdb';
  updatedAt: number | null;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function airport(a: { icao?: unknown; iata?: unknown; name?: unknown; city?: unknown; country?: unknown; lat?: unknown; lng?: unknown; elevationFt?: unknown }): Airport | null {
  const lat = num(a.lat);
  const lng = num(a.lng);
  const name = text(a.name) ?? text(a.icao) ?? text(a.iata);
  if (lat === null || lng === null || !name || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const elev = num(a.elevationFt);
  return { icao: text(a.icao), iata: text(a.iata), name, city: text(a.city), country: text(a.country), lat, lng, ...(elev !== null ? { elevationFt: Math.round(elev) } : {}) };
}

async function getJson<T>(url: string, limiter: { take(): Promise<void> }, timeoutMs: number): Promise<{ data: T; lastModified: string | null } | null> {
  try {
    const res = await httpJson<T>(url, { limiter, timeoutMs, retries: 0 });
    return res.data === undefined ? null : { data: res.data, lastModified: res.lastModified };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null; // "no such route" is an answer
    throw e;
  }
}

interface VrsRoute {
  airport_codes?: string;
  _airports?: { name?: string; icao?: string; iata?: string; location?: string; countryiso2?: string; lat?: number; lon?: number; alt_feet?: number }[];
}

export async function vrsRoute(cs: string): Promise<RouteCandidate | null> {
  const r = await getJson<VrsRoute>(VRS_URL(cs), vrsBucket(), 6_000);
  const list = r?.data._airports ?? [];
  const airports = list
    .map((a) => airport({ icao: a.icao, iata: a.iata, name: a.name, city: a.location, country: a.countryiso2, lat: a.lat, lng: a.lon, elevationFt: a.alt_feet }))
    .filter((a): a is Airport => a !== null);
  if (airports.length < 2) return null;
  const lm = r?.lastModified ? Date.parse(r.lastModified) : NaN;
  return { airports, source: 'vrs', updatedAt: Number.isFinite(lm) ? lm : null };
}

interface AdsbdbAirport {
  country_iso_name?: string;
  elevation?: number;
  iata_code?: string;
  icao_code?: string;
  latitude?: number;
  longitude?: number;
  municipality?: string;
  name?: string;
}

export async function adsbdbRoute(cs: string): Promise<RouteCandidate | null> {
  const r = await getJson<{ response?: { flightroute?: { origin?: AdsbdbAirport; destination?: AdsbdbAirport } } | string }>(ADSBDB_CALLSIGN(cs), adsbdbBucket(), 6_000);
  const fr = r && typeof r.data.response === 'object' ? r.data.response.flightroute : undefined;
  if (!fr) return null;
  const map = (a: AdsbdbAirport | undefined) =>
    a ? airport({ icao: a.icao_code, iata: a.iata_code, name: a.name, city: a.municipality, country: a.country_iso_name, lat: a.latitude, lng: a.longitude, elevationFt: a.elevation }) : null;
  const o = map(fr.origin);
  const d = map(fr.destination);
  return o && d ? { airports: [o, d], source: 'adsbdb', updatedAt: null } : null;
}

interface HexdbAirport {
  country_code?: string;
  region_name?: string;
  iata?: string;
  icao?: string;
  airport?: string;
  latitude?: number;
  longitude?: number;
}

export async function hexdbRoute(cs: string): Promise<RouteCandidate | null> {
  const r = await getJson<{ flight?: string; route?: string; updatetime?: number }>(HEXDB_ROUTE(cs), hexdbBucket(), 6_000);
  const codes = (r?.data.route ?? '').split('-').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z0-9]{4}$/.test(c));
  if (codes.length < 2) return null;
  const ends = [codes[0]!, codes[codes.length - 1]!];
  const airports: Airport[] = [];
  for (const code of ends) {
    const a = await getJson<HexdbAirport>(HEXDB_AIRPORT(code), hexdbBucket(), 6_000);
    const ap = a ? airport({ icao: a.data.icao, iata: a.data.iata, name: a.data.airport, city: a.data.region_name, country: a.data.country_code, lat: a.data.latitude, lng: a.data.longitude }) : null;
    if (!ap) return null;
    airports.push(ap);
  }
  const t = num(r?.data.updatetime);
  return { airports, source: 'hexdb', updatedAt: t !== null ? t * 1000 : null };
}

export type Position = RoutePosition;

export interface RouteDeps {
  vrs: (cs: string) => Promise<RouteCandidate | null>;
  adsbdb: (cs: string) => Promise<RouteCandidate | null>;
  hexdb: (cs: string) => Promise<RouteCandidate | null>;
  /** The aircraft's record in the flights snapshot (exact observed position); default reads the feed. */
  live?: (hex: string) => FlightRecord | null;
  /** The aircraft's flown track (current leg, oldest first); default: the cached /api/aircraft lookup. */
  track?: (hex: string) => Promise<readonly TrackPoint[] | null>;
}

function snapshotRecord(hex: string): FlightRecord | null {
  const snap = getFeed('flights')?.peek();
  const records = (snap?.data as { records?: FlightRecord[] } | null | undefined)?.records;
  return records?.find((r) => r.id === hex) ?? null;
}

async function flownTrack(hex: string): Promise<readonly TrackPoint[] | null> {
  // Non-ICAO addresses (`~` prefix, TIS-B) have no readsb trace file.
  if (!/^[0-9a-f]{6}$/.test(hex)) return null;
  return (await aircraftDetail(hex))?.track ?? null;
}

const defaultDeps: RouteDeps = { vrs: vrsRoute, adsbdb: adsbdbRoute, hexdb: hexdbRoute, live: snapshotRecord, track: flownTrack };

interface StoredRoute {
  candidate: RouteCandidate | null;
  providers: Record<string, ProviderRun>;
}

/** Try each source in order, stopping at the first answer; all misses/failures are reported. */
export async function resolveRoute(cs: string, deps: RouteDeps = defaultDeps): Promise<StoredRoute> {
  const providers: Record<string, ProviderRun> = {};
  for (const [key, fn] of [['vrs', deps.vrs], ['adsbdb', deps.adsbdb], ['hexdb', deps.hexdb]] as const) {
    const { result, run } = await runProvider(() => fn(cs), (r) => (r ? 1 : 0), { allowEmpty: true });
    providers[key] = run;
    if (result) return { candidate: result, providers };
  }
  return { candidate: null, providers };
}

function providersAt(runs: Record<string, ProviderRun>, now: number): Providers {
  return Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, { ...r.status, age_s: r.okAt ? Math.round((now - r.okAt) / 1000) : null }]));
}

const code = (a: Airport) => a.iata ?? a.icao ?? a.name;

export interface RouteOptions {
  /** ICAO 24-bit hex of the aircraft: exact snapshot position + flown-track corroboration. */
  icao24?: string | null;
}

/** The exact observed state of `icao24` when the snapshot has it airborne under this callsign. */
function exactPosition(cs: string, icao24: string | null | undefined, deps: RouteDeps): Position | null {
  if (!icao24) return null;
  let rec: FlightRecord | null = null;
  try {
    rec = (deps.live ?? snapshotRecord)(icao24);
  } catch {
    rec = null;
  }
  if (!rec || rec.onGround || (rec.callsign ?? '').replace(/\s+/g, '').toUpperCase() !== cs) return null;
  return { lat: rec.lat, lng: rec.lng, speedKt: rec.gsKt, trackDeg: rec.trackDeg };
}

/** Cached per callsign for 10 min (hits and misses). Null when every source errored. */
export async function flightRoute(cs: string, pos: Position | null, deps: RouteDeps = defaultDeps, opts: RouteOptions = {}): Promise<FlightRoute | null> {
  const cache = sourceCache<StoredRoute>(`flight-route:${cs}`, async () => ({ data: await resolveRoute(cs, deps) }), { ttlMs: 10 * 60_000, retryAfterErrorMs: 60_000, deadlineMs: 20_000 });
  const r = await cache.get();
  const s = r.data;
  const now = Date.now();
  if (!s || !Object.values(s.providers).some((p) => p.status.ok)) return null;
  const base = { callsign: cs, providers: providersAt(s.providers, now), timestamp: new Date(now).toISOString() };
  if (!s.candidate) return { ...base, found: false, origin: null, destination: null, basis: null, status: 'unknown', progress: null, distanceKm: null, source: null };
  // R2 round 4 MINOR-6: the card's query position is quantised (0.5°, 50 kt, 45°); the snapshot has the exact one.
  const exact = exactPosition(cs, opts.icao24, deps);
  const p = exact ?? pos;
  const positionSource: FlightRoute['positionSource'] = exact ? 'snapshot' : pos ? 'query' : null;
  const here: LngLatTuple | null = p ? [p.lng, p.lat] : null;
  const [o, d] = pickLeg(s.candidate.airports, here, p?.trackDeg ?? null);
  const updated = s.candidate.updatedAt;
  // Judge the whole listed route (first → last stop), not just the nearest leg.
  const first = s.candidate.airports[0]!;
  const last = s.candidate.airports[s.candidate.airports.length - 1]!;
  if (isImplausible(first, last, p) && isImplausible(o, d, p)) {
    return { ...base, found: false, implausible: true, origin: null, destination: null, basis: null, status: 'unknown', progress: null, distanceKm: null, source: s.candidate.source, positionSource };
  }
  const listed = {
    source: s.candidate.source,
    sourceUpdatedAt: updated !== null ? new Date(updated).toISOString() : null,
    stale: s.candidate.source === 'hexdb' && (updated === null || now - updated > STALE_AFTER_MS),
    positionSource,
  };
  if (directionConflict(o, d, p)) {
    // The observed course heads back toward the listed origin: the listed leg is contradicted.
    // Show the reverse only when the flown track saw this aircraft take off from the listed
    // destination; otherwise withhold, with the reason (the FLIGHT view's rule).
    const sched = `${code(o)}→${code(d)}`;
    let track: readonly TrackPoint[] | null = null;
    if (opts.icao24) {
      try {
        track = await (deps.track ?? flownTrack)(opts.icao24);
      } catch {
        track = null;
      }
    }
    const lastLow = track?.length ? lastLowEnd(track, o, d) : null;
    if (lastLow === 'd') {
      return {
        ...base,
        found: true,
        origin: d,
        destination: o,
        ...routeProgress(d, o, p),
        basis: 'observed',
        reversed: true,
        routeCheck: `observed departure ${code(d)} and course toward ${code(o)}: shown as flown ${code(d)}→${code(o)}; standing data lists ${sched}`,
        ...listed,
      };
    }
    const routeCheck =
      lastLow === 'o'
        ? `departed ${code(o)} earlier, now on course back toward ${code(o)} — return leg or turnaround not observed; route not confirmed`
        : `airborne inside the corridor but heading toward ${code(o)}, opposite to standing data ${sched}; departure not observed — route not confirmed`;
    return { ...base, found: true, origin: null, destination: null, basis: null, status: 'unknown', progress: null, distanceKm: null, directionConflict: true, routeCheck, ...listed };
  }
  return { ...base, found: true, origin: o, destination: d, ...routeProgress(o, d, p), ...listed };
}
