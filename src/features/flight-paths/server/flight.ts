/**
 * "Track my flight" (GET /api/flight/{ident}, §8). Resolves an ICAO callsign, IATA flight number
 * (via OpenFlights airlines.dat, disambiguated against VRS standing data), registration or hex;
 * then the route (aviation's VRS → adsbdb → hexdb chain; hexdb's years-old records are labelled
 * stale), the live position (flights snapshot, else adsb.lol /v2/callsign|hex through aviation's
 * shared bucket), the flown track + identity (aviation's adsbdb + adsb.lol trace lookup) and
 * METAR/TAF at both ends. OSIRIS corroboration: an observed departure beats the schedule; a
 * standing-data route is trusted only when its origin agrees with the observed departure or the
 * aircraft is inside the route corridor. Server-only.
 */
import 'server-only';
import type { z } from 'zod';
import { getFeed, runProvider, type ProviderRun } from '@/lib/feeds';
import { distanceKm, greatCirclePoints, type LngLatTuple } from '@/lib/geo';
import { httpJson, HttpError } from '@/lib/http';
import type { FlightDetailResponse, FlightLink } from '@/lib/schemas/flight-paths';
import type { FreshnessState, Providers } from '@/lib/types';
import type { FlightRecord } from '@/features/aviation/adsb';
import type { TrackPoint } from '@/features/aviation/trace';
import { aircraftDetail, adsbdbBucket } from '@/features/aviation/server/aircraft';
import { fetchAdsbJson } from '@/features/aviation/server/providers';
import { flightRoute, type FlightRoute } from '@/features/aviation/server/route-lookup';
import { honestFlights } from '@/features/aviation/server/view';
import { classifyIdent, type IdentGuess } from '../lib/idents';
import { angleDiff, etaMs, flyingRoute, headingAlong, onCorridor, pathIntoFrame, positionOnPath, progressOn, reverseLegReason, reverseLegReject } from '../lib/geometry';
import { localTimeIso } from '../lib/time';
import { emptyWeather } from '../lib/metar';
import { findAirport, openFlights, vrsIndex, type AirportRecord } from './data';
import { endpoint, icaoOf } from './plan';
import { stationFor, stationWeather } from './weather';

export type FlightDetail = z.infer<typeof FlightDetailResponse>;
type Link = z.infer<typeof FlightLink>;

export interface Resolved {
  callsign: string | null;
  iataFlight: string | null;
  hex: string | null;
  registration: string | null;
  live: FlightRecord | null;
  guess: IdentGuess | null;
}

export interface FlightDeps {
  /** The flights snapshot; `state` is its feed `meta.state` (absent in older callers: then not LIVE). */
  records: () => Promise<{ records: FlightRecord[] | null; run: ProviderRun; state?: FreshnessState }>;
  adsblol: (kind: 'callsign' | 'hex', value: string) => Promise<FlightRecord[]>;
  adsbdbRegistration: (reg: string) => Promise<string | null>;
  route: (cs: string, pos: { lat: number; lng: number; speedKt: number | null } | null) => Promise<FlightRoute | null>;
  aircraft: typeof aircraftDetail;
  weather: typeof stationWeather;
}

async function snapshotRecords(): Promise<{ records: FlightRecord[] | null; run: ProviderRun; state?: FreshnessState }> {
  const feed = getFeed('flights');
  if (!feed) return { records: null, run: { status: { ok: false, count: 0, ms: 0, age_s: null, error: 'no_flights_feed' }, okAt: null } };
  // The same honesty cap as /api/flights: never LIVE while the position provider is failing.
  const snap = honestFlights(feed.peek());
  const records = (snap.data as { records?: FlightRecord[] } | null)?.records ?? null;
  const at = snap.meta.fetchedAt ? Date.parse(snap.meta.fetchedAt) : null;
  return records
    ? { records, run: { status: { ok: true, count: records.length, ms: 0, age_s: 0 }, okAt: at }, state: snap.meta.state }
    : { records: null, run: { status: { ok: false, count: 0, ms: 0, age_s: null, error: 'no_flights_snapshot' }, okAt: null } };
}

async function adsbdbHexForRegistration(reg: string): Promise<string | null> {
  try {
    const res = await httpJson<{ response?: { aircraft?: { mode_s?: string } } | string }>(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(reg)}`, { timeoutMs: 8_000, retries: 0, limiter: adsbdbBucket() });
    const r = res.data?.response;
    const hex = r && typeof r === 'object' ? r.aircraft?.mode_s?.toLowerCase() : undefined;
    return hex && /^[0-9a-f]{6}$/.test(hex) ? hex : null;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

const defaultDeps: FlightDeps = {
  records: snapshotRecords,
  adsblol: async (kind, value) => (await fetchAdsbJson(`https://api.adsb.lol/v2/${kind}/${value}`, `adsblol_${kind}`, AbortSignal.timeout(12_000))).records,
  adsbdbRegistration: adsbdbHexForRegistration,
  route: (cs, pos) => flightRoute(cs, pos),
  aircraft: aircraftDetail,
  weather: stationWeather,
};

/** IATA flight number → ICAO callsign: active airlines with that designator, preferring one whose callsign is a VRS service. */
export function iataToCallsign(designator: string, number: string, live: ReadonlySet<string>): string | null {
  const airlines = openFlights().airlines;
  const chains = vrsIndex().chainOf;
  const candidates = Object.entries(airlines)
    .filter(([, a]) => a[0] === designator)
    .sort(([, x], [, y]) => y[4] - x[4])
    .map(([icao]) => `${icao}${number}`);
  return candidates.find((cs) => chains.has(cs) || live.has(cs)) ?? candidates[0] ?? null;
}

export async function resolveIdent(ident: string, records: readonly FlightRecord[] | null, deps: Pick<FlightDeps, 'adsbdbRegistration'>, providers: Record<string, ProviderRun>): Promise<Resolved | null> {
  const guesses = classifyIdent(ident);
  if (!guesses.length) return null;
  const list = records ?? [];
  const liveCs = new Set(list.map((r) => r.callsign).filter((c): c is string => !!c));
  const chains = vrsIndex().chainOf;
  const base = (g: IdentGuess): Resolved => ({ callsign: null, iataFlight: null, hex: null, registration: null, live: null, guess: g });
  let fallback: Resolved | null = null;
  for (const g of guesses) {
    if (g.kind === 'callsign') {
      const live = list.find((r) => r.callsign === g.value) ?? null;
      const r = { ...base(g), callsign: g.value, live, hex: live?.id ?? null, registration: live?.registration ?? null };
      if (live || chains.has(g.value)) return r;
      fallback ??= r;
    } else if (g.kind === 'iata') {
      const cs = iataToCallsign(g.airline!, g.number!, liveCs);
      if (!cs) continue;
      const live = list.find((r) => r.callsign === cs) ?? null;
      const r = { ...base(g), callsign: cs, iataFlight: `${g.airline}${g.number}`, live, hex: live?.id ?? null, registration: live?.registration ?? null };
      if (live || chains.has(cs)) return r;
      fallback ??= r;
    } else if (g.kind === 'hex') {
      const live = list.find((r) => r.id === g.value) ?? null;
      if (live) return { ...base(g), hex: g.value, live, callsign: live.callsign, registration: live.registration };
      fallback ??= { ...base(g), hex: g.value };
    } else {
      const norm = (s: string | null) => (s ?? '').replace(/-/g, '');
      const live = list.find((r) => r.registration && norm(r.registration) === norm(g.value)) ?? null;
      if (live) return { ...base(g), registration: live.registration, hex: live.id, live, callsign: live.callsign };
      const lookup = await runProvider(() => deps.adsbdbRegistration(g.value), (h) => (h ? 1 : 0), { allowEmpty: true });
      providers.adsbdb_registration = lookup.run;
      if (lookup.result) return { ...base(g), registration: g.value, hex: lookup.result };
      fallback ??= { ...base(g), registration: g.value };
    }
  }
  return fallback;
}

export function trackerLinks(r: Pick<Resolved, 'callsign' | 'hex' | 'iataFlight'>): Link[] {
  const links: Link[] = [];
  const cs = r.callsign && /^[A-Z0-9]{2,8}$/.test(r.callsign) ? r.callsign : null;
  const hex = r.hex && /^[0-9a-f]{6}$/.test(r.hex) ? r.hex : null;
  if (cs) links.push({ label: 'FlightAware', url: `https://www.flightaware.com/live/flight/${cs}` });
  if (hex) links.push({ label: 'ADS-B Exchange', url: `https://globe.adsbexchange.com/?icao=${hex}` });
  else if (cs) links.push({ label: 'ADS-B Exchange', url: `https://globe.adsbexchange.com/?callsign=${cs}` });
  if (cs) links.push({ label: 'RadarBox', url: `https://www.radarbox.com/data/flights/${cs}` });
  const fr = r.iataFlight ?? cs;
  if (fr) links.push({ label: 'Flightradar24', url: `https://www.flightradar24.com/data/flights/${fr.toLowerCase()}` });
  return links;
}

function airportFromRoute(a: FlightRoute['origin']): AirportRecord | null {
  if (!a) return null;
  return (a.icao ? findAirport(a.icao) : null) ?? (a.iata ? findAirport(a.iata) : null);
}

function providersAt(runs: Record<string, ProviderRun>, now: number): Providers {
  return Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, { ...r.status, age_s: r.okAt ? Math.max(0, Math.round((now - r.okAt) / 1000)) : r.status.age_s }]));
}

/** Observed departure within this distance of the route origin agrees with it. */
const DEPARTURE_KM = 60;
/** An aircraft (or a track point) within this distance of an airport is at it. */
const AT_AIRPORT_KM = 25;
/** A track point below this height ABOVE the nearer endpoint is low: a take-off or landing (else the departure was not observed). */
const DEPARTURE_ALT_FT = 3_000;
/** A coverage gap at least this long followed by a reversal of course separates two legs (round 4 B1). */
const LEG_GAP_MS = 10 * 60_000;
/** A change of track larger than this across such a gap is a turnaround, not a gap en route. */
const TURNAROUND_DEG = 120;

/** The two ends of a route with their elevations (ft AMSL, null when OurAirports has none). */
export interface RouteEnds {
  O: LngLatTuple;
  D: LngLatTuple;
  elevO?: number | null;
  elevD?: number | null;
}

export interface LegOfTrack {
  /** Where the track's observed departure is relative to the route. */
  departure: 'origin' | 'elsewhere' | 'unobserved' | 'none';
  /** The track for this leg (trimmed to the last take-off from the origin when earlier legs preceded it). */
  track: TrackPoint[];
  /** True only when an EARLIER LEG was cut: an airborne point before the take-off lies away from the origin (round 4 m2). */
  trimmed: boolean;
}

/**
 * On the ground, or below 3,000 ft above the nearer endpoint (round 4 B1: the MSL test made a
 * landing or take-off at Durango, 6,685 ft, or Mexico City, 7,316 ft, never "low").
 */
export function lowness(ends: RouteEnds): (p: TrackPoint) => boolean {
  const eO = ends.elevO ?? 0;
  const eD = ends.elevD ?? 0;
  return (p) => {
    if (p.onGround) return true;
    if (p.altFt === null) return false;
    const here: LngLatTuple = [p.lng, p.lat];
    const ground = distanceKm(here, ends.O) <= distanceKm(here, ends.D) ? eO : eD;
    return p.altFt - ground < DEPARTURE_ALT_FT;
  };
}

/**
 * Is this trace the O→D leg? The trace is searched for the LAST take-off from the origin (a low
 * point within 60 km of O followed by flight away from it): when there is one, the leg starts
 * there; earlier legs are trimmed (and said to be) only when an airborne point before it lies away
 * from O. Otherwise a first point on the ground or low near O is a departure not yet flown; a first
 * point low elsewhere (or near D) is a departure elsewhere; else it is unobserved.
 */
export function legOfTrack(track: readonly TrackPoint[], O: LngLatTuple, D: LngLatTuple, elev: { elevO?: number | null; elevD?: number | null } = {}): LegOfTrack {
  const first = track[0];
  if (!first) return { departure: 'none', track: [], trimmed: false };
  const isLow = lowness({ O, D, ...elev });
  const near = (p: TrackPoint, at: LngLatTuple, km: number) => distanceKm([p.lng, p.lat], at) <= km;
  const farApart = distanceKm(O, D) > 2 * DEPARTURE_KM;
  // Walk back to the last take-off from O: the latest low point at O with flight away from O after it.
  let awayAfter = false;
  for (let i = track.length - 1; i >= 0; i--) {
    const p = track[i]!;
    if (awayAfter && isLow(p) && near(p, O, DEPARTURE_KM)) {
      const trimmed = track.slice(0, i).some((q) => !q.onGround && !near(q, O, DEPARTURE_KM));
      return { departure: 'origin', track: track.slice(i), trimmed };
    }
    if (!p.onGround && !near(p, O, DEPARTURE_KM)) awayAfter = true;
  }
  if (isLow(first) && near(first, O, DEPARTURE_KM)) return { departure: 'origin', track: [...track], trimmed: false };
  const fromElsewhere = isLow(first) || (farApart && near(first, D, DEPARTURE_KM));
  return { departure: fromElsewhere ? 'elsewhere' : 'unobserved', track: [...track], trimmed: false };
}

/** The trace from its last low point (the latest observed take-off) on; the whole trace when it never was low. */
export function sinceLastTakeoff(track: readonly TrackPoint[], ends?: RouteEnds): TrackPoint[] {
  const isLow = ends ? lowness(ends) : (p: TrackPoint) => p.onGround || (p.altFt !== null && p.altFt < DEPARTURE_ALT_FT);
  for (let i = track.length - 1; i >= 0; i--) if (isLow(track[i]!)) return track.slice(i);
  return [...track];
}

/** The nearest observed value of `key` at index i, looking up to 10 points in direction `step`. */
function valueAt(track: readonly TrackPoint[], i: number, step: 1 | -1, key: 'trackDeg' | 'gsKt'): number | null {
  for (let k = 0, j = i; k < 10 && j >= 0 && j < track.length; k++, j += step) {
    const v = track[j]![key];
    if (v !== null) return v;
  }
  return null;
}

/**
 * A turnaround lands and turns: across the gap the aircraft ends up less than this share of the
 * distance it could have flown (at the faster of its ground speeds either side) from where it was.
 */
const TURNAROUND_DISPLACEMENT = 0.5;

/**
 * The trace after its LAST coverage gap of >= 10 min across which the observed track turned by more
 * than 120° AND the aircraft reappeared near where it vanished (round 4 B1: SKW541T flew DEN→DRO,
 * vanished for 37 min while it landed and turned around below coverage, and reappeared 28 km away
 * heading back to DEN; the DEN→DRO part is the previous leg). Round 5 m4: a trans-polar flight's
 * true course also flips ~180° across the pole, under an Arctic coverage gap — but it reappears
 * ~1,000 km on, about as far as it could fly in the gap: not a turnaround. Without a ground speed on
 * either side, the course reversal alone decides. `gapMin` is the length of that gap; the whole
 * trace and null when there is none.
 */
export function sinceTurnaroundGap(track: readonly TrackPoint[]): { track: TrackPoint[]; gapMin: number | null } {
  for (let i = track.length - 1; i > 0; i--) {
    const gap = Date.parse(track[i]!.t) - Date.parse(track[i - 1]!.t);
    if (!(gap >= LEG_GAP_MS)) continue;
    const before = valueAt(track, i - 1, -1, 'trackDeg');
    const after = valueAt(track, i, 1, 'trackDeg');
    if (before === null || after === null || angleDiff(before, after) <= TURNAROUND_DEG) continue;
    const speeds = [valueAt(track, i - 1, -1, 'gsKt'), valueAt(track, i, 1, 'gsKt')].filter((v): v is number => v !== null && v > 0);
    if (speeds.length) {
      const couldFlyKm = Math.max(...speeds) * 1.852 * (gap / 3_600_000);
      const movedKm = distanceKm([track[i - 1]!.lng, track[i - 1]!.lat], [track[i]!.lng, track[i]!.lat]);
      if (movedKm >= TURNAROUND_DISPLACEMENT * couldFlyKm) continue;
    }
    return { track: track.slice(i), gapMin: Math.round(gap / 60_000) };
  }
  return { track: [...track], gapMin: null };
}

/** Does the callsign's VRS chain fly `from` then `to` as consecutive stops (a listed leg)? */
function listedLeg(callsign: string | null, from: AirportRecord, to: AirportRecord): boolean {
  const chain = callsign ? vrsIndex().chainOf.get(callsign) : undefined;
  const [f, t] = [icaoOf(from), icaoOf(to)];
  return !!chain && chain.some((c, i) => c === f && chain[i + 1] === t);
}

const toRun = (p: Providers[string]): ProviderRun => ({ status: p, okAt: p.ok && p.age_s !== null ? Date.now() - p.age_s * 1000 : null });

/** Null when the ident cannot be read as any flight identifier. */
export async function flightDetail(ident: string, deps: FlightDeps = defaultDeps, now = Date.now()): Promise<FlightDetail | null> {
  const runs: Record<string, ProviderRun> = {};
  const sources: FlightDetail['sources'] = [];
  const snap = await deps.records();
  runs.flights = snap.run;
  const resolved = await resolveIdent(ident, snap.records, deps, runs);
  if (!resolved) return null;

  // Live position: snapshot first, else one adsb.lol lookup through aviation's shared bucket.
  let live = resolved.live;
  // The snapshot's feed state; a direct lookup that answered now is a live fetch (its record keeps its own seenAt).
  let feedState: FreshnessState | null = live ? (snap.state ?? 'recent') : null;
  if (!live && (resolved.callsign || resolved.hex)) {
    const kind = resolved.hex ? 'hex' : 'callsign';
    const value = resolved.hex ?? resolved.callsign!;
    const r = await runProvider(() => deps.adsblol(kind, value), (x) => x.length, { allowEmpty: true });
    runs[`adsblol_${kind}`] = r.run;
    live = r.result?.[0] ?? null;
    if (live) {
      feedState = 'live';
      resolved.hex ??= live.id;
      resolved.callsign ??= live.callsign;
      resolved.registration ??= live.registration;
    }
  }
  sources.push({ name: 'live position', ok: live !== null, detail: live ? `${live.source}, observed ${new Date(live.seenAt * 1000).toISOString()}` : 'not currently seen by the keyless feeds' });

  const pos = live ? { lat: live.lat, lng: live.lng, speedKt: live.gsKt } : null;
  const route = resolved.callsign ? await deps.route(resolved.callsign, pos) : null;
  if (route) for (const [k, p] of Object.entries(route.providers)) runs[`route_${k}`] = toRun(p);
  const detail = await (resolved.hex ? deps.aircraft(resolved.hex) : Promise.resolve(null));
  if (detail) for (const [k, p] of Object.entries(detail.providers)) runs[k] = toRun(p);
  let flownTrack: TrackPoint[] = detail?.track ?? [];

  let origin = route?.found ? airportFromRoute(route.origin) : null;
  let destination = route?.found ? airportFromRoute(route.destination) : null;
  if (route?.found) {
    const when = route.sourceUpdatedAt ? ` (record updated ${route.sourceUpdatedAt.slice(0, 10)})` : '';
    sources.push({ name: `route: ${route.source}`, ok: true, detail: route.stale ? `stale${when} — hexdb records can be years old` : `standing data${when}` });
  } else {
    // Round 4 m3: a registration/hex with no callsign cannot be looked up at all — not a source failure.
    const why = !resolved.callsign ? 'no callsign: route lookup not possible' : route ? 'no route on record for this callsign' : 'no route source answered';
    sources.push({ name: 'route', ok: false, detail: why });
  }

  const airborne = live !== null && !live.onGround && (live.gsKt ?? 0) > 50;
  let groundAtOrigin = false;
  // Progress/ETA only for a route the aircraft is observed flying, in the observed direction.
  let onRoute = false;
  let routeBasis: FlightDetail['routeBasis'] = origin && destination ? 'standing-data' : null;
  let routeCheck: string | null = null;
  // Corroboration (OSIRIS): the observed departure and course beat the schedule (round 3 B1). The
  // flown track is shown only when it is this leg's: a track that departed elsewhere and ended on
  // the ground at the origin is the aircraft's previous leg (R4-M1).
  if (origin && destination) {
    const codeO = origin.iata ?? origin.ident;
    const codeD = destination.iata ?? destination.ident;
    const sched = `${codeO}→${codeD}`;
    const O: LngLatTuple = [origin.lng, origin.lat];
    const D: LngLatTuple = [destination.lng, destination.lat];
    groundAtOrigin = live !== null && !airborne && distanceKm([live.lng, live.lat], O) <= AT_AIRPORT_KM;
    const ends: RouteEnds = { O, D, elevO: origin.elevationFt, elevD: destination.elevationFt };
    const isLow = lowness(ends);
    const leg = legOfTrack(flownTrack, O, D, ends);
    // Drop the part of the trace before a coverage gap + turnaround (a previous leg), and say so.
    const cutTurnaround = (t: TrackPoint[]) => {
      const cut = sinceTurnaroundGap(t);
      if (cut.gapMin !== null) sources.push({ name: 'flown track', ok: true, detail: `shown from ${cut.track[0]!.t.slice(11, 16)}Z: the trace before a ${cut.gapMin}-min coverage gap and a reversal of course is an earlier leg` });
      return cut.track;
    };
    const withhold = (detail: string) => {
      sources.push({ name: 'corroboration', ok: false, detail });
      routeCheck = detail;
      routeBasis = null;
      origin = null;
      destination = null;
    };
    if (groundAtOrigin) {
      // Not departed yet: any airborne part of the track belongs to an earlier flight.
      if (flownTrack.some((p) => !p.onGround)) {
        flownTrack = [];
        sources.push({ name: 'flown track', ok: false, detail: `previous leg of this aircraft, not this flight — not shown (aircraft is on the ground at ${codeO})` });
      }
      sources.push({ name: 'corroboration', ok: false, detail: `not yet possible: aircraft on the ground at ${codeO}, no departure observed` });
    } else if (live && airborne) {
      // An airborne aircraft's current leg IS this flight: its observed departure and course decide
      // the direction; the standing data only names the pair.
      const s = { lat: live.lat, lng: live.lng, altFt: live.altFt, gsKt: live.gsKt, trackDeg: live.trackDeg, vrFpm: live.vrFpm };
      const fwd = flyingRoute(s, O, D, { a: origin.elevationFt, b: destination.elevationFt });
      const rev = flyingRoute(s, D, O, { a: destination.elevationFt, b: origin.elevationFt });
      // A trace that ends on the ground away from where the aircraft now flies is an earlier leg:
      // this leg's departure and track were not observed.
      const end = flownTrack[flownTrack.length - 1];
      const traceEnded = end !== undefined && isLow(end) && distanceKm([end.lng, end.lat], [live.lng, live.lat]) > DEPARTURE_KM;
      if (traceEnded) {
        flownTrack = [];
        sources.push({ name: 'flown track', ok: false, detail: 'the trace ends with a landing before this leg — earlier leg not shown; this leg was not observed yet' });
      }
      const back = legOfTrack(flownTrack, D, O, { elevO: destination.elevationFt, elevD: origin.elevationFt });
      const departedO = !traceEnded && leg.departure === 'origin';
      const departedD = !traceEnded && back.departure === 'origin';
      // Both take-offs in the trace: the later one (shorter remainder) is this leg.
      const latest = departedO && departedD ? (leg.track.length <= back.track.length ? 'O' : 'D') : departedO ? 'O' : departedD ? 'D' : null;
      const offKm = Math.round(positionOnPath([live.lng, live.lat], O, D).offKm);
      // Round 5 B1: a D→O leg that no source lists is shown only when the observation fits it end to
      // end (away from D, on course for O, inside the corridor now and along the trace); otherwise the
      // aircraft may be bound for a third airport (SWA2816 "MCO→MDW" landed at RDU).
      const listedBack = listedLeg(resolved.callsign, destination, origin);
      const backReject = latest === 'D' && rev && !listedBack ? reverseLegReject(s, D, O, back.track.filter((q) => !q.onGround), { from: destination.elevationFt, to: origin.elevationFt }) : null;
      if (latest === 'O' && !fwd && rev) {
        // Round 4 B1: took off from O earlier but now flies back toward O — the landing at D and
        // the turnaround were not observed (a coverage gap), so neither direction is confirmed.
        flownTrack = cutTurnaround(leg.track);
        withhold(`departed ${codeO} earlier, now on course back toward ${codeO} — return leg or turnaround not observed; route not confirmed`);
      } else if (latest === 'O') {
        flownTrack = leg.track;
        sources.push({ name: 'corroboration', ok: true, detail: `observed departure matches the route origin ${codeO}${leg.trimmed ? ' (earlier legs trimmed from the trace)' : ''}` });
        if (fwd) onRoute = true;
        else {
          routeCheck = `departed ${codeO} but not observed on course for ${codeD} (${offKm} km off the great circle) — progress and ETA not shown`;
          sources.push({ name: 'progress', ok: false, detail: routeCheck });
        }
      } else if (latest === 'D' && rev && !backReject) {
        // Observed D→O: show the leg as flown, not the standing data's reversed direction.
        flownTrack = back.track;
        // A multi-stop VRS chain that flies D then O (AAL606 is KDFW-KJFK-KDFW) lists this leg:
        // then it is standing data, only the leg differs from the one the route lookup picked.
        const chain = resolved.callsign ? vrsIndex().chainOf.get(resolved.callsign) : undefined;
        const listed = listedBack;
        [origin, destination] = [destination, origin];
        routeBasis = listed ? 'standing-data' : 'observed-reverse';
        onRoute = true;
        routeCheck = listed
          ? `observed departure ${codeD} and course toward ${codeO}: the ${codeD}→${codeO} leg of standing-data route ${chain!.join('→')}`
          : `observed departure ${codeD} and course toward ${codeO}: shown as flown ${codeD}→${codeO}; standing data lists ${sched}`;
        sources.push({ name: 'corroboration', ok: true, detail: routeCheck });
      } else if (latest === 'D' && rev && backReject) {
        // Departed D and broadly heading back toward O, but not consistently enough to say it flies
        // D→O, a leg no source lists.
        flownTrack = back.track;
        withhold(`observed departure ${codeD}; ${reverseLegReason(backReject, codeO)} — ${codeD}→${codeO} is not listed by any source and is not confirmed (standing data lists ${sched})`);
      } else if (latest === 'D') {
        flownTrack = back.track;
        // headingAlong is null when the course could not be judged (no track, or no vertical rate
        // near an endpoint): say what was not observed, not "not on course" (round 5 minor, SWT183).
        const along = onCorridor([live.lng, live.lat], D, O) ? headingAlong(s, D, O, { a: destination.elevationFt, b: origin.elevationFt }) : false;
        const nearCode = distanceKm([live.lng, live.lat], D) <= distanceKm([live.lng, live.lat], O) ? codeD : codeO;
        const why =
          along !== null
            ? `the aircraft is not on course for ${codeO}`
            : s.trackDeg === null
              ? `course toward ${codeO} not yet established (no track observed)`
              : `course toward ${codeO} not yet established (no vertical rate observed near ${nearCode})`;
        withhold(`observed departure ${codeD} contradicts standing data ${sched}, and ${why} — route not confirmed`);
      } else if (!traceEnded && leg.departure === 'elsewhere') {
        flownTrack = sinceLastTakeoff(flownTrack, ends);
        withhold(`observed departure is not ${codeO} — contradicts standing data ${sched}; route not confirmed`);
      } else if (fwd) {
        flownTrack = cutTurnaround(flownTrack);
        onRoute = true;
        sources.push({ name: 'corroboration', ok: true, detail: `airborne inside the ${sched} corridor on course for ${codeD} (departure not observed)` });
      } else if (rev) {
        flownTrack = cutTurnaround(flownTrack);
        withhold(`airborne inside the corridor but heading toward ${codeO}, opposite to standing data ${sched}; departure not observed — route not confirmed`);
      } else {
        flownTrack = cutTurnaround(flownTrack);
        const why = onCorridor([live.lng, live.lat], O, D) ? (live.trackDeg === null ? 'no observed track' : `not on course for ${codeD}`) : `${offKm} km off the great circle`;
        withhold(`aircraft is not on standing-data route ${sched} (${why}) — route not confirmed`);
      }
    } else if (leg.departure === 'elsewhere') {
      withhold(`observed departure is not ${codeO}; route withheld`);
    } else if (leg.departure === 'origin') {
      flownTrack = leg.track;
      sources.push({ name: 'corroboration', ok: true, detail: `observed departure matches the route origin ${codeO}${leg.trimmed ? ' (earlier legs trimmed from the trace)' : ''}` });
    }
  }

  const O: LngLatTuple | null = origin ? [origin.lng, origin.lat] : null;
  const D: LngLatTuple | null = destination ? [destination.lng, destination.lat] : null;
  const plannedArc = O && D ? greatCirclePoints(O, D, 128) : [];
  let progress: number | null = null;
  let eta: number | null = null;
  let remainingLeg: [number, number][] = [];
  if (live && O && D && airborne && onRoute) {
    const here: LngLatTuple = [live.lng, live.lat];
    const pr = progressOn(here, O, D);
    progress = pr.progress;
    // From the observation time, not the request (round 4 m1).
    eta = etaMs(pr.remainingKm, live, live.seenAt * 1000);
    // Same longitude frame as the planned arc (which is unwrapped from the origin and may run past
    // ±180): otherwise a trans-Pacific remaining leg lands in another world copy (R4-B1).
    remainingLeg = pathIntoFrame(greatCirclePoints(here, D, 64), plannedArc);
  }
  const last = flownTrack[flownTrack.length - 1];
  const landed =
    !airborne && destination !== null && last !== undefined && distanceKm([last.lng, last.lat], [destination.lng, destination.lat]) <= 25 && (last.onGround || (last.altFt ?? 0) - (destination.elevationFt ?? 0) < 1500);
  const status: FlightDetail['status'] = airborne ? 'airborne' : landed ? 'landed' : groundAtOrigin ? 'scheduled' : 'unknown';

  const wx = await deps.weather([origin ? stationFor(origin) : null, destination ? stationFor(destination) : null]);
  Object.assign(runs, wx.providers);

  return {
    ident,
    resolved: { callsign: resolved.callsign, iataFlight: resolved.iataFlight, hex: resolved.hex, registration: resolved.registration ?? detail?.identity?.registration ?? null },
    status,
    origin: origin ? endpoint(origin) : null,
    destination: destination ? endpoint(destination) : null,
    plannedArc,
    flownTrack,
    remainingLeg,
    position: live
      ? { lat: live.lat, lng: live.lng, altFt: live.altFt, gsKt: live.gsKt, trackDeg: live.trackDeg, observedAt: new Date(live.seenAt * 1000).toISOString() }
      : null,
    feedState: live ? feedState : null,
    progress,
    eta: eta !== null ? new Date(eta).toISOString() : null,
    etaLocal: eta !== null && destination ? localTimeIso(destination.tz, eta) : null,
    etaTz: destination?.tz ?? null,
    routeBasis,
    routeCheck,
    routeSource: route?.found ? { name: route.source, stale: route.stale ?? false, updatedAt: route.sourceUpdatedAt ?? null } : null,
    identity: detail?.identity ?? null,
    weather: {
      origin: origin ? (wx.byStation.get(stationFor(origin) ?? '') ?? emptyWeather()) : null,
      destination: destination ? (wx.byStation.get(stationFor(destination) ?? '') ?? emptyWeather()) : null,
    },
    links: trackerLinks(resolved),
    sources,
    providers: providersAt(runs, now),
    timestamp: new Date(now).toISOString(),
  };
}

/**
 * True when nothing at all was found for the ident: no ICAO address, no live position, no route, no flown track
 * and no aircraft identity. Combined with `upstreamFailures` the route answers 404 (every source
 * answered and none knows the flight) or 503 (a source was down, so "unknown" is not established).
 */
export function nothingFound(d: FlightDetail): boolean {
  return d.resolved.hex === null && d.position === null && d.origin === null && d.destination === null && d.flownTrack.length === 0 && d.identity === null && d.routeSource == null;
}

/** Providers that failed (not skipped). The flights snapshot does not count when an adsb.lol lookup answered instead. */
export function upstreamFailures(d: FlightDetail): string[] {
  const entries = Object.entries(d.providers);
  const lookupOk = entries.some(([k, p]) => k.startsWith('adsblol_') && p.ok);
  return entries.filter(([k, p]) => !p.ok && !p.skipped && !(k === 'flights' && lookupOk)).map(([k]) => k);
}
