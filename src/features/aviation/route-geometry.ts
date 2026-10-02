/**
 * Pure route geometry shared by GET /api/flight-route (server) and the aircraft card (client):
 * which leg of a standing-data route the aircraft is flying and progress along the great circle.
 * No I/O. Whether the observed course contradicts the leg is decided in `corroborate.ts`.
 *
 * Honesty (§0.1, R2 round 4 BLOCKING-1): the observed direction beats the schedule. A leg is
 * chosen by a weighted score (corridor excess + a track term), never by a yes/no cut-off that a
 * perpendicular departure turn passes. A leg is never one airport to itself (R2 round 5 MINOR-3).
 * Progress needs the observed track to run along the leg, or no track at all (round 5 fix pass
 * MINOR-1: the FLIGHT view's direction test, `headingAlong`).
 */
import { headingAlong } from '@/features/flight-paths/lib/geometry';
import { alongTrackKm, distanceKm, initialBearing, type LngLatTuple } from '@/lib/geo';

export interface RoutePoint {
  lat: number;
  lng: number;
}

/** A route stop: a point with its codes when known. */
export interface AirportPoint extends RoutePoint {
  icao?: string | null;
  iata?: string | null;
}

export interface RoutePosition {
  lat: number;
  lng: number;
  speedKt: number | null;
  /** Observed track, degrees true (picks the leg of a multi-leg route; checks the direction). */
  trackDeg?: number | null;
  /** Observed barometric altitude (ft) and vertical rate (ft/min), when known (near an end they decide the direction). */
  altFt?: number | null;
  vrFpm?: number | null;
}

const D2R = Math.PI / 180;

export const angleDiff = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const ll = (p: RoutePoint): LngLatTuple => [p.lng, p.lat];

/**
 * Weight (km) of the track term: a track pointing straight away from the leg's destination costs
 * 2 × this, a perpendicular one 1 ×. Checked on 40 live multi-leg cases (R2 round 4: 30–80 km
 * pick all 40 correctly; 100 km breaks IGO913 on approach to VOHS).
 */
export const LEG_TRACK_WEIGHT_KM = 50;

/** Corridor excess (km) + LEG_TRACK_WEIGHT_KM × (1 − cos(track − bearing to b)). Lower is better. */
export function legScore(a: RoutePoint, b: RoutePoint, here: LngLatTuple, trackDeg: number | null): number {
  const excess = distanceKm(ll(a), here) + distanceKm(here, ll(b)) - distanceKm(ll(a), ll(b));
  if (trackDeg === null) return excess;
  return excess + LEG_TRACK_WEIGHT_KM * (1 - Math.cos(angleDiff(initialBearing(here, ll(b)), trackDeg) * D2R));
}

/**
 * For a multi-stop route, the leg with the lowest score (ties: the earlier leg); first → last for
 * a 2-airport route or without a position. Callers withhold a first → last that is one airport
 * (`sameAirport`: a round trip asked without a position). A round trip (KJFK-KSAN-KJFK) has two
 * legs on one corridor: the track term decides, and it still works while the aircraft has not yet
 * turned on course after take-off (DAL571 on runway heading 302 out of SAN).
 */
export function pickLeg<A extends AirportPoint>(airports: readonly A[], here: LngLatTuple | null, trackDeg: number | null = null): [A, A] {
  const first = airports[0]!;
  const last = airports[airports.length - 1]!;
  if (!here || airports.length === 2) return [first, last];
  let best: [A, A] = [first, last];
  let bestScore = Infinity;
  for (let i = 0; i < airports.length - 1; i++) {
    if (sameAirport(airports[i]!, airports[i + 1]!)) continue; // a repeated stop is not a leg
    const s = legScore(airports[i]!, airports[i + 1]!, here, trackDeg);
    if (s < bestScore) {
      bestScore = s;
      best = [airports[i]!, airports[i + 1]!];
    }
  }
  return best;
}

/**
 * True when the route also lists the reverse of o→d as a leg (a round trip, KSEA-KMCI-KSEA): both
 * legs lie on one corridor and score alike, so only an observed track tells them apart.
 */
export function listsReverse(airports: readonly AirportPoint[], o: AirportPoint, d: AirportPoint): boolean {
  for (let i = 0; i < airports.length - 1; i++) if (sameAirport(airports[i]!, d) && sameAirport(airports[i + 1]!, o)) return true;
  return false;
}

/** OSIRIS onCorridor rule: within 15 % + 150 km of the great-circle length. */
export function onRouteCorridor(o: RoutePoint, d: RoutePoint, here: LngLatTuple): boolean {
  const total = distanceKm(ll(o), ll(d));
  return distanceKm(ll(o), here) + distanceKm(here, ll(d)) <= total * 1.15 + 150;
}

/** Near an end the course is a departure turn or arrival vectors, not evidence of direction. */
export const CONFLICT_END_KM = 60;

/** The same airport (same ICAO or IATA code, or within 1 km): never a leg's two ends. */
export function sameAirport(a: AirportPoint, b: AirportPoint): boolean {
  if (a.icao && b.icao) return a.icao === b.icao;
  if (a.iata && b.iata) return a.iata === b.iata;
  return distanceKm(ll(a), ll(b)) < 1;
}

export interface RouteProgress {
  basis: 'corridor' | 'schedule';
  status: 'airborne' | 'unknown';
  progress: number | null;
  distanceKm: number;
}

/**
 * The observed track runs along o→d (`true`), across or against it (`false`), or that is unknown
 * (`null`: no track; near an end without a vertical rate and nothing contradicting). The FLIGHT
 * view's `headingAlong`: within 60° of the path's local bearing en route.
 */
export function trackAlong(pos: RoutePosition, o: RoutePoint, d: RoutePoint): boolean | null {
  if (pos.trackDeg == null) return null;
  return headingAlong({ lat: pos.lat, lng: pos.lng, altFt: pos.altFt ?? null, gsKt: pos.speedKt, trackDeg: pos.trackDeg, vrFpm: pos.vrFpm ?? null }, ll(o), ll(d));
}

/**
 * Progress along the great circle when the aircraft is on the corridor, moving (> 50 kt) and not
 * observed tracking across or against the leg. Round 5 fix pass MINOR-1: on the corridor with the
 * track 60–107° off (DEN→ORD mid-route on a track 100° off), the leg is standing data only — the
 * FLIGHT view's direction test rejects it, so no progress is claimed.
 */
export function routeProgress(o: RoutePoint, d: RoutePoint, pos: RoutePosition | null): RouteProgress {
  const A = ll(o);
  const B = ll(d);
  const total = distanceKm(A, B);
  const distance = Math.round(total);
  if (!pos) return { basis: 'schedule', status: 'unknown', progress: null, distanceKm: distance };
  const here: LngLatTuple = [pos.lng, pos.lat];
  if (!onRouteCorridor(o, d, here) || total < 30 || trackAlong(pos, o, d) === false) return { basis: 'schedule', status: 'unknown', progress: null, distanceKm: distance };
  const along = Math.min(total, Math.max(0, alongTrackKm(here, A, B)));
  const moving = pos.speedKt !== null && pos.speedKt > 50;
  return { basis: 'corridor', status: moving ? 'airborne' : 'unknown', progress: moving ? Math.round((along / total) * 1000) / 1000 : null, distanceKm: distance };
}

/** OSIRIS: a route is rejected when the aircraft is farther than this × route length from both ends. */
export const IMPLAUSIBLE_FACTOR = 1.5;

/** True when `pos` is > 1.5 × the o→d great-circle length from both endpoints (docs/reference/03 §5). */
export function isImplausible(o: RoutePoint, d: RoutePoint, pos: Pick<RoutePosition, 'lat' | 'lng'> | null): boolean {
  if (!pos) return false;
  const here: LngLatTuple = [pos.lng, pos.lat];
  const limit = distanceKm(ll(o), ll(d)) * IMPLAUSIBLE_FACTOR;
  return distanceKm(ll(o), here) > limit && distanceKm(ll(d), here) > limit;
}

/** A track point below this height ABOVE the nearer endpoint is low: a take-off or a landing. */
export const LOW_AGL_FT = 3_000;

export interface TrackSample {
  lat: number;
  lng: number;
  altFt: number | null;
  onGround: boolean;
}

/** A leg end: an airport with an optional elevation (ft AMSL) and codes for the stated reason. */
export interface LegEnd extends AirportPoint {
  name?: string;
  elevationFt?: number | null;
}

/** Low: on the ground, or < 3,000 ft above the elevation of the nearer leg end (AGL, not MSL). */
export function isLowPoint(p: TrackSample, o: LegEnd, d: LegEnd): boolean {
  if (p.onGround) return true;
  if (p.altFt === null) return false;
  const here: LngLatTuple = [p.lng, p.lat];
  const ground = (distanceKm(here, ll(o)) <= distanceKm(here, ll(d)) ? o.elevationFt : d.elevationFt) ?? 0;
  return p.altFt - ground < LOW_AGL_FT;
}

/** A track sample with its time and observed track, when the trace has them. */
export interface TimedSample extends TrackSample {
  t?: string;
  trackDeg?: number | null;
}

/** A coverage gap at least this long … */
export const LEG_GAP_MS = 10 * 60_000;
/** … across which the observed track turned by more than this separates two legs (the FLIGHT view's `sinceTurnaroundGap`). */
export const TURNAROUND_DEG = 120;

function trackNear(track: readonly TimedSample[], i: number, step: 1 | -1): number | null {
  for (let k = 0, j = i; k < 10 && j >= 0 && j < track.length; k++, j += step) {
    const t = track[j]!.trackDeg;
    if (t != null) return t;
  }
  return null;
}

const gapMs = (a: TimedSample, b: TimedSample): number => (a.t && b.t ? Date.parse(b.t) - Date.parse(a.t) : NaN);

/**
 * The track after its LAST coverage gap of >= 10 min across which the course reversed by more than
 * 120° (the aircraft landed and turned around below coverage: what came before is an earlier leg);
 * the whole track when there is none. Same thresholds as the FLIGHT view's `sinceTurnaroundGap`.
 */
export function sinceTurnaround<T extends TimedSample>(track: readonly T[]): readonly T[] {
  for (let i = track.length - 1; i > 0; i--) {
    if (!(gapMs(track[i - 1]!, track[i]!) >= LEG_GAP_MS)) continue;
    const before = trackNear(track, i - 1, -1);
    const after = trackNear(track, i, 1);
    if (before !== null && after !== null && angleDiff(before, after) > TURNAROUND_DEG) return track.slice(i);
  }
  return track;
}

/**
 * The current leg of a flown track (oldest first) for `observedDeparture`: after the last
 * turnaround gap (`sinceTurnaround`); from the start of the low run around the last ground sample
 * (a landing and take-off seen on the ground); after the last coverage gap of >= 10 min that is low
 * on both sides (a landing and take-off below coverage).
 */
export function departureLeg<T extends TimedSample>(track: readonly T[], o: LegEnd, d: LegEnd): readonly T[] {
  const leg = sinceTurnaround(track);
  const low = (p: T) => isLowPoint(p, o, d);
  let start = 0;
  for (let i = leg.length - 1; i >= 0; i--) {
    if (!leg[i]!.onGround) continue;
    start = i;
    while (start > 0 && low(leg[start - 1]!)) start--;
    break;
  }
  for (let i = leg.length - 1; i > start; i--) {
    if (gapMs(leg[i - 1]!, leg[i]!) >= LEG_GAP_MS && low(leg[i - 1]!) && low(leg[i]!)) {
      start = i;
      break;
    }
  }
  return start === 0 ? leg : leg.slice(start);
}

/** Where the observed departure of the current leg was: within 60 km of the leg's origin, its destination, or elsewhere. */
export type DepartureEnd = 'o' | 'd' | 'elsewhere';

export interface ObservedDeparture {
  end: DepartureEnd;
  lat: number;
  lng: number;
}

function endOf(p: RoutePoint, o: LegEnd, d: LegEnd): DepartureEnd {
  const here: LngLatTuple = [p.lng, p.lat];
  const kmO = distanceKm(here, ll(o));
  const kmD = distanceKm(here, ll(d));
  if (kmO <= CONFLICT_END_KM && kmO <= kmD) return 'o';
  if (kmD <= CONFLICT_END_KM) return 'd';
  return kmO <= CONFLICT_END_KM ? 'o' : 'elsewhere';
}

/**
 * The observed departure of the current leg (`departureLeg`) and where it was, or null when none
 * was observed. It is the EARLIEST low run of the leg (on the ground, or < 3,000 ft above the
 * nearer field's elevation), never the latest: the latest low run is the approach (a step-down or
 * go-around that climbs back above 3,000 ft AGL is not a take-off from the destination).
 *  - The run must open the leg: a leg whose first sample is already high began out of coverage, so
 *    its first low run is an approach or a low pass, not the take-off.
 *  - A run that never climbs out counts only when it holds a ground sample (seen on the ground,
 *    now climbing out); first seen low and still low could be either end of a flight.
 *  - Null when the track ends on the ground (not taken off yet).
 * The place is the run's last ground sample (the take-off roll), else its lowest airborne sample.
 * Pure; the FLIGHT view's rule (src/features/flight-paths/server/flight.ts `legOfTrack`: a first
 * point low near O is the departure from O, low elsewhere is a departure elsewhere).
 */
export function observedDepartureAt(track: readonly TimedSample[], o: LegEnd, d: LegEnd): ObservedDeparture | null {
  const leg = departureLeg(track, o, d);
  const first = leg[0];
  if (!first || leg[leg.length - 1]!.onGround || !isLowPoint(first, o, d)) return null;
  let e = 0;
  while (e + 1 < leg.length && isLowPoint(leg[e + 1]!, o, d)) e++;
  const run = leg.slice(0, e + 1);
  let at: TimedSample | null = null;
  for (const p of run) if (p.onGround) at = p;
  if (!at && e === leg.length - 1) return null;
  if (!at) for (const p of run) if (p.altFt !== null && (at === null || p.altFt < (at.altFt ?? Infinity))) at = p;
  const place = at ?? first;
  return { end: endOf(place, o, d), lat: place.lat, lng: place.lng };
}

/** `observedDepartureAt` reduced to where: 'o' | 'd' | 'elsewhere', or null when no departure was observed. */
export function observedDeparture(track: readonly TimedSample[], o: LegEnd, d: LegEnd): DepartureEnd | null {
  return observedDepartureAt(track, o, d)?.end ?? null;
}
