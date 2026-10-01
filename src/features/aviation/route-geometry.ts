/**
 * Pure route geometry shared by GET /api/flight-route (server) and the aircraft card (client):
 * which leg of a standing-data route the aircraft is flying, whether its observed course
 * contradicts the listed direction, and progress along the great circle. No I/O.
 *
 * Honesty (§0.1, R2 round 4 BLOCKING-1): the observed direction beats the schedule. A leg is
 * chosen by a weighted score (corridor excess + a track term), never by a yes/no cut-off that a
 * perpendicular departure turn passes; a 2-airport route flown the other way is not shown as
 * listed (`directionConflict`).
 */
import { alongTrackKm, distanceKm, initialBearing, type LngLatTuple } from '@/lib/geo';

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RoutePosition {
  lat: number;
  lng: number;
  speedKt: number | null;
  /** Observed track, degrees true (picks the leg of a multi-leg route; checks the direction). */
  trackDeg?: number | null;
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
 * a 2-airport route or without a position. A round trip (KJFK-KSAN-KJFK) has two legs on one
 * corridor: the track term decides, and it still works while the aircraft has not yet turned on
 * course after take-off (DAL571 on runway heading 302 out of SAN).
 */
export function pickLeg<A extends RoutePoint>(airports: readonly A[], here: LngLatTuple | null, trackDeg: number | null = null): [A, A] {
  const first = airports[0]!;
  const last = airports[airports.length - 1]!;
  if (!here || airports.length === 2) return [first, last];
  let best: [A, A] = [first, last];
  let bestScore = Infinity;
  for (let i = 0; i < airports.length - 1; i++) {
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

/**
 * True when the observed track contradicts o→d: on the corridor, > 60 km from both ends, heading
 * toward o (within 60°: cos > 0.5) and away from d (cos < −0.3, i.e. > ~107° off). On 686 live
 * on-corridor 2-airport cases this flags exactly UAL1118 (KDEN-KCID flown westbound) and WZZ1738
 * (LFSB-LWSK flown toward Basel). False without a track.
 */
export function directionConflict(o: RoutePoint, d: RoutePoint, pos: RoutePosition | null): boolean {
  if (!pos || pos.trackDeg == null) return false;
  const here: LngLatTuple = [pos.lng, pos.lat];
  if (!onRouteCorridor(o, d, here)) return false;
  if (distanceKm(here, ll(o)) <= CONFLICT_END_KM || distanceKm(here, ll(d)) <= CONFLICT_END_KM) return false;
  const toO = Math.cos((pos.trackDeg - initialBearing(here, ll(o))) * D2R);
  const toD = Math.cos((pos.trackDeg - initialBearing(here, ll(d))) * D2R);
  return toO > 0.5 && toD < -0.3;
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

/**
 * Where the flown track (current leg, oldest first) last took off or landed: 'o' or 'd' when its
 * latest low point (on the ground, or < 3,000 ft above the nearer end's elevation) is within
 * CONFLICT_END_KM of that end; null when no low point was observed or it was elsewhere.
 */
export function lastLowEnd(track: readonly TrackSample[], o: RoutePoint & { elevationFt?: number | null }, d: RoutePoint & { elevationFt?: number | null }): 'o' | 'd' | null {
  for (let i = track.length - 1; i >= 0; i--) {
    const p = track[i]!;
    const here: LngLatTuple = [p.lng, p.lat];
    const dO = distanceKm(here, ll(o));
    const dD = distanceKm(here, ll(d));
    const ground = (dO <= dD ? o.elevationFt : d.elevationFt) ?? 0;
    const low = p.onGround || (p.altFt !== null && p.altFt - ground < LOW_AGL_FT);
    if (!low) continue;
    return dO <= CONFLICT_END_KM ? 'o' : dD <= CONFLICT_END_KM ? 'd' : null;
  }
  return null;
}
