/**
 * Pure route geometry shared by GET /api/flight-route (server) and the aircraft card (client):
 * which leg of a standing-data route the aircraft is flying and progress along the great circle.
 * No I/O. Whether the observed course contradicts the leg is decided in `corroborate.ts`.
 *
 * Honesty (§0.1, R2 round 4 BLOCKING-1): the observed direction beats the schedule. A leg is
 * chosen by a weighted score (corridor excess + a track term), never by a yes/no cut-off that a
 * perpendicular departure turn passes. A leg is never one airport to itself (R2 round 5 MINOR-3).
 */
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

/** Progress along the great circle when the aircraft is on the corridor and moving (> 50 kt). */
export function routeProgress(o: RoutePoint, d: RoutePoint, pos: RoutePosition | null): RouteProgress {
  const A = ll(o);
  const B = ll(d);
  const total = distanceKm(A, B);
  const distance = Math.round(total);
  if (!pos) return { basis: 'schedule', status: 'unknown', progress: null, distanceKm: distance };
  const here: LngLatTuple = [pos.lng, pos.lat];
  if (!onRouteCorridor(o, d, here) || total < 30) return { basis: 'schedule', status: 'unknown', progress: null, distanceKm: distance };
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
