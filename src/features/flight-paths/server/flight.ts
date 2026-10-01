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
import type { Providers } from '@/lib/types';
import type { FlightRecord } from '@/features/aviation/adsb';
import type { TrackPoint } from '@/features/aviation/trace';
import { aircraftDetail, adsbdbBucket } from '@/features/aviation/server/aircraft';
import { fetchAdsbJson } from '@/features/aviation/server/providers';
import { flightRoute, type FlightRoute } from '@/features/aviation/server/route-lookup';
import { classifyIdent, type IdentGuess } from '../lib/idents';
import { etaMs, onCorridor, pathIntoFrame, progressOn } from '../lib/geometry';
import { localTimeIso } from '../lib/time';
import { emptyWeather } from '../lib/metar';
import { findAirport, openFlights, vrsIndex, type AirportRecord } from './data';
import { endpoint } from './plan';
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
  records: () => Promise<{ records: FlightRecord[] | null; run: ProviderRun }>;
  adsblol: (kind: 'callsign' | 'hex', value: string) => Promise<FlightRecord[]>;
  adsbdbRegistration: (reg: string) => Promise<string | null>;
  route: (cs: string, pos: { lat: number; lng: number; speedKt: number | null } | null) => Promise<FlightRoute | null>;
  aircraft: typeof aircraftDetail;
  weather: typeof stationWeather;
}

async function snapshotRecords(): Promise<{ records: FlightRecord[] | null; run: ProviderRun }> {
  const feed = getFeed('flights');
  if (!feed) return { records: null, run: { status: { ok: false, count: 0, ms: 0, age_s: null, error: 'no_flights_feed' }, okAt: null } };
  const snap = feed.peek();
  const records = (snap.data as { records?: FlightRecord[] } | null)?.records ?? null;
  const at = snap.meta.fetchedAt ? Date.parse(snap.meta.fetchedAt) : null;
  return records
    ? { records, run: { status: { ok: true, count: records.length, ms: 0, age_s: 0 }, okAt: at } }
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
/** A first track point below this is the take-off (else the departure was not observed). */
const DEPARTURE_ALT_FT = 3_000;

export interface LegOfTrack {
  /** Where the track's observed departure is relative to the route. */
  departure: 'origin' | 'elsewhere' | 'unobserved' | 'none';
  /** The track for this leg (trimmed to the last take-off from the origin when earlier legs preceded it). */
  track: TrackPoint[];
  trimmed: boolean;
}

const isLow = (p: TrackPoint) => p.onGround || (p.altFt !== null && p.altFt < DEPARTURE_ALT_FT);

/**
 * Is this trace the O→D leg? The first point, when on the ground or low, is the observed departure; a
 * track that starts near the destination is the inbound leg. A departure elsewhere is trimmed to the
 * last low point at the origin followed by flight away from it (a take-off, not an approach), when there is one.
 */
export function legOfTrack(track: readonly TrackPoint[], O: LngLatTuple, D: LngLatTuple): LegOfTrack {
  const first = track[0];
  if (!first) return { departure: 'none', track: [], trimmed: false };
  const near = (p: TrackPoint, at: LngLatTuple, km: number) => distanceKm([p.lng, p.lat], at) <= km;
  const farApart = distanceKm(O, D) > 2 * DEPARTURE_KM;
  if (isLow(first) && near(first, O, DEPARTURE_KM)) return { departure: 'origin', track: [...track], trimmed: false };
  const fromElsewhere = isLow(first) || (farApart && near(first, D, DEPARTURE_KM));
  if (!fromElsewhere) return { departure: 'unobserved', track: [...track], trimmed: false };
  for (let i = track.length - 1; i > 0; i--) {
    const p = track[i]!;
    if (isLow(p) && near(p, O, DEPARTURE_KM) && track.slice(i + 1).some((q) => !q.onGround && !near(q, O, DEPARTURE_KM))) {
      return { departure: 'origin', track: track.slice(i), trimmed: true };
    }
  }
  return { departure: 'elsewhere', track: [...track], trimmed: false };
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
  if (!live && (resolved.callsign || resolved.hex)) {
    const kind = resolved.hex ? 'hex' : 'callsign';
    const value = resolved.hex ?? resolved.callsign!;
    const r = await runProvider(() => deps.adsblol(kind, value), (x) => x.length, { allowEmpty: true });
    runs[`adsblol_${kind}`] = r.run;
    live = r.result?.[0] ?? null;
    if (live) {
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
    sources.push({ name: 'route', ok: false, detail: route ? 'no route on record for this callsign' : 'no route source answered' });
  }

  const airborne = live !== null && !live.onGround && (live.gsKt ?? 0) > 50;
  let groundAtOrigin = false;
  // Corroboration (OSIRIS): the observed departure beats the schedule. The flown track is shown only
  // when it is this leg's: a track that departed elsewhere is the aircraft's previous leg (R4-M1).
  if (origin && destination) {
    const code = origin.iata ?? origin.ident;
    const O: LngLatTuple = [origin.lng, origin.lat];
    const D: LngLatTuple = [destination.lng, destination.lat];
    groundAtOrigin = live !== null && !airborne && distanceKm([live.lng, live.lat], O) <= AT_AIRPORT_KM;
    const leg = legOfTrack(flownTrack, O, D);
    const inCorridor = live && airborne ? onCorridor([live.lng, live.lat], O, D) : null;
    if (groundAtOrigin) {
      // Not departed yet: any airborne part of the track belongs to an earlier flight.
      if (flownTrack.some((p) => !p.onGround)) {
        flownTrack = [];
        sources.push({ name: 'flown track', ok: false, detail: `previous leg of this aircraft, not this flight — not shown (aircraft is on the ground at ${code})` });
      }
      sources.push({ name: 'corroboration', ok: false, detail: `not yet possible: aircraft on the ground at ${code}, no departure observed` });
    } else if (leg.departure === 'elsewhere' && inCorridor !== true) {
      sources.push({ name: 'corroboration', ok: false, detail: `observed departure is not ${code}; route withheld` });
      origin = null;
      destination = null;
    } else if (leg.departure === 'elsewhere') {
      flownTrack = [];
      sources.push({ name: 'flown track', ok: false, detail: `observed departure is not ${code} — track belongs to another leg, not shown` });
      sources.push({ name: 'corroboration', ok: true, detail: 'aircraft is airborne inside the route corridor (departure not confirmed)' });
    } else if (leg.departure === 'origin') {
      flownTrack = leg.track;
      sources.push({ name: 'corroboration', ok: true, detail: `observed departure matches the route origin${leg.trimmed ? ' (earlier legs trimmed from the trace)' : ''}` });
    } else if (inCorridor) {
      sources.push({ name: 'corroboration', ok: true, detail: 'aircraft is airborne inside the route corridor (departure not observed)' });
    }
  }

  const O: LngLatTuple | null = origin ? [origin.lng, origin.lat] : null;
  const D: LngLatTuple | null = destination ? [destination.lng, destination.lat] : null;
  const plannedArc = O && D ? greatCirclePoints(O, D, 128) : [];
  let progress: number | null = null;
  let eta: number | null = null;
  let remainingLeg: [number, number][] = [];
  if (live && O && D && airborne) {
    const here: LngLatTuple = [live.lng, live.lat];
    const pr = progressOn(here, O, D);
    progress = pr.progress;
    eta = etaMs(pr.remainingKm, live, now);
    // Same longitude frame as the planned arc (which is unwrapped from the origin and may run past
    // ±180): otherwise a trans-Pacific remaining leg lands in another world copy (R4-B1).
    remainingLeg = pathIntoFrame(greatCirclePoints(here, D, 64), plannedArc);
  }
  const last = flownTrack[flownTrack.length - 1];
  const landed = !airborne && destination !== null && last !== undefined && distanceKm([last.lng, last.lat], [destination.lng, destination.lat]) <= 25 && (last.onGround || (last.altFt ?? 0) < 1500);
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
    progress,
    eta: eta !== null ? new Date(eta).toISOString() : null,
    etaLocal: eta !== null && destination ? localTimeIso(destination.tz, eta) : null,
    etaTz: destination?.tz ?? null,
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
