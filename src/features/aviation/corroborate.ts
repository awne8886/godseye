/**
 * Flown-track corroboration of a standing-data leg. One rule for GET /api/flight-route (so the
 * aircraft card and Flight Watch) and the FLIGHT view (src/features/flight-paths/server/flight.ts):
 * the observed departure decides, the same `flyingRoute` decides what to WITHHOLD, and the same
 * `onCourseFor` is needed to SHOW a reversed leg, so the views give one answer. Pure and
 * isomorphic; no I/O.
 *
 * It applies to every airborne aircraft whose flown track can be read (round 5 fix pass
 * BLOCKING-1: SWA864 took off from LAS and the card still showed ONT→PHX at 96 % while the FLIGHT
 * view withheld it; 6 of 60 shown legs had a take-off away from the origin). The take-off of the
 * CURRENT leg (`legTakeoff`) is the earliest low run of that leg (`observedDeparture`), the leg
 * starting after the last coverage gap across which the course reversed (an unobserved landing and
 * turnaround: TVF8023's LYS take-off before a 299-min gap was the previous leg), and none when the trace ends on the ground or with a landing
 * away from where the aircraft now is. Then:
 *  - take-off at D, on course for O (`onCourseFor`) → the reverse leg, shown as flown;
 *  - take-off at D otherwise → withheld (it departed D for somewhere else);
 *  - take-off at O, flying back along the corridor toward O (`flyingRoute`) → withheld
 *    (turnaround not observed);
 *  - take-off at O, on the corridor with a track along it or unknown → the leg with progress;
 *  - take-off at O otherwise → the listed leg without progress (`listed`, the FLIGHT view's
 *    "departed O but not observed on course for D");
 *  - take-off elsewhere → withheld;
 *  - no take-off observed (or no flown track) → the standing data stands, unless the track points
 *    away from D (`awayFromDestination`: > 60 km from both ends, more than ~107° off the bearing
 *    to D — SWA1241 flew 214° 380 km south-west of DCA, away from DCA and not toward LAS); then
 *    withheld with the reason.
 * The lenient corridor test may only withhold; asserting a reversed leg needs the strict one.
 */
import { distanceKm, initialBearing, type LngLatTuple } from '@/lib/geo';
import { flyingRoute, positionOnPath } from '@/features/flight-paths/lib/geometry';
import {
  angleDiff,
  CONFLICT_END_KM,
  isLowPoint as isLow,
  observedDepartureAt,
  onRouteCorridor,
  trackAlong,
  type LegEnd,
  type RoutePoint,
  type RoutePosition,
  type TimedSample,
  type TrackSample,
} from './route-geometry';

export { LEG_GAP_MS, sinceTurnaround, TURNAROUND_DEG, type LegEnd, type TimedSample } from './route-geometry';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const ll = (p: RoutePoint): LngLatTuple => [p.lng, p.lat];

/** cos(track − bearing to D) below this = the track points away from D (more than ~107° off). */
export const AWAY_COS = -0.3;
/** "Toward X": the track within this many degrees of the direct bearing to X … */
export const TOWARD_MIN_DEG = 20;
/** … or wider when close: the present course, extended, passes within this distance of X. */
export const TOWARD_MISS_KM = 80;

const code = (a: LegEnd) => a.iata ?? a.icao ?? a.name ?? `${a.lat.toFixed(2)},${a.lng.toFixed(2)}`;

/** True when > 60 km from both ends and the observed track points away from `d`. False without a track. */
export function awayFromDestination(o: RoutePoint, d: RoutePoint, pos: RoutePosition | null): boolean {
  if (!pos || pos.trackDeg == null) return false;
  const here: LngLatTuple = [pos.lng, pos.lat];
  if (distanceKm(here, ll(o)) <= CONFLICT_END_KM || distanceKm(here, ll(d)) <= CONFLICT_END_KM) return false;
  return Math.cos((pos.trackDeg - initialBearing(here, ll(d))) * D2R) < AWAY_COS;
}

/**
 * The track points at `to`: within max(20°, asin(80 km / distance)) of the direct bearing. A course
 * that only runs roughly along the corridor is not "toward": UAL1789 departed IAD on 237° inside
 * the IAD–RDU corridor (the path's local bearing ~199°) while RDU bore 152°, and landed at San
 * Antonio (trace a2bbcc, 2026-10-01); UAL374 (VRS ORD-LAX) departed LAX on 100° over Arizona while
 * ORD bore ~60°, and landed at Phoenix (trace a5d31d) — the FLIGHT view had shown "flown LAX→ORD".
 */
export function headingFor(pos: Pick<RoutePosition, 'lat' | 'lng' | 'trackDeg'>, to: RoutePoint): boolean {
  if (pos.trackDeg == null) return false;
  const here: LngLatTuple = [pos.lng, pos.lat];
  const km = distanceKm(here, ll(to));
  const tol = km <= TOWARD_MISS_KM ? 90 : Math.max(TOWARD_MIN_DEG, Math.asin(TOWARD_MISS_KM / km) * R2D);
  return angleDiff(pos.trackDeg, initialBearing(here, ll(to))) <= tol;
}

/**
 * The FLIGHT view's `flyingRoute` from→to: inside the corridor and the track within 60° of the
 * path's local bearing (near an end the vertical rate decides). Enough to withhold, not to assert.
 */
export function alongCorridor(pos: RoutePosition, from: RoutePoint, to: RoutePoint): boolean {
  if (pos.trackDeg == null) return false;
  const s = { lat: pos.lat, lng: pos.lng, altFt: pos.altFt ?? null, gsKt: pos.speedKt, trackDeg: pos.trackDeg, vrFpm: pos.vrFpm ?? null };
  return flyingRoute(s, ll(from), ll(to));
}

/** On course for `to` from `from`: `alongCorridor` AND `headingFor` (needed to show a reversed leg). */
export function onCourseFor(pos: RoutePosition, from: RoutePoint, to: RoutePoint): boolean {
  return alongCorridor(pos, from, to) && headingFor(pos, to);
}

export interface Takeoff {
  /** Within 60 km of the leg's origin ('o') or destination ('d'); null = elsewhere. */
  end: 'o' | 'd' | null;
  lat: number;
  lng: number;
}

/**
 * The latest observed take-off in the flown track (oldest first): the last low point — on the
 * ground, or < 3,000 ft above the nearer end's elevation — that is followed by an airborne point
 * that is not low. A low point at the very end (descending now) is not a take-off. Null when no
 * take-off was observed (the trace starts airborne, or the track is empty).
 */
export function lastTakeoff(track: readonly TrackSample[], o: LegEnd, d: LegEnd): Takeoff | null {
  let airborneAfter = false;
  for (let i = track.length - 1; i >= 0; i--) {
    const p = track[i]!;
    if (!isLow(p, o, d)) {
      airborneAfter = true;
      continue;
    }
    if (!airborneAfter) continue;
    const here: LngLatTuple = [p.lng, p.lat];
    return { end: distanceKm(here, ll(o)) <= CONFLICT_END_KM ? 'o' : distanceKm(here, ll(d)) <= CONFLICT_END_KM ? 'd' : null, lat: p.lat, lng: p.lng };
  }
  return null;
}

/**
 * The observed take-off of the leg the aircraft at `pos` is flying now, or null when it was not
 * observed: the trace ends on the ground (the aircraft had not taken off yet when it was read) or
 * low more than 60 km from `pos` (it ends with a landing: an earlier leg, the FLIGHT view's
 * `traceEnded`); else the EARLIEST low run of the current leg (`observedDepartureAt` in
 * route-geometry.ts), never the latest: a low run late in the leg is the approach, and a
 * go-around or step-down that climbs back above 3,000 ft AGL is not a take-off from the destination.
 */
export function legTakeoff(track: readonly TimedSample[], o: LegEnd, d: LegEnd, pos: Pick<RoutePosition, 'lat' | 'lng'>): Takeoff | null {
  const end = track[track.length - 1];
  if (!end || end.onGround) return null;
  if (isLow(end, o, d) && distanceKm([end.lng, end.lat], [pos.lng, pos.lat]) > CONFLICT_END_KM) return null;
  const dep = observedDepartureAt(track, o, d);
  return dep ? { end: dep.end === 'elsewhere' ? null : dep.end, lat: dep.lat, lng: dep.lng } : null;
}

export type Corroboration =
  /** No take-off observed for this leg and nothing contradicts it: the standing-data answer stands. */
  | { kind: 'unobserved' }
  /** Departed the listed origin and on its corridor, track along it or unknown: the leg with progress. */
  | { kind: 'departed'; routeCheck: string }
  /** Departed the listed origin but not observed on course: the listed leg stands, progress is not shown. */
  | { kind: 'listed'; routeCheck: string }
  /** Departed the listed destination and on course for the listed origin: shown as flown d→o. */
  | { kind: 'reverse'; routeCheck: string }
  /** No leg, destination or progress is named. */
  | { kind: 'withhold'; routeCheck: string };

/**
 * Corroborate o→d for an airborne aircraft at `pos`. `track` is its flown track (current leg,
 * oldest first) or null when none could be read; `missing` says why (shown in the reason). The
 * wording follows the FLIGHT view's.
 */
export function corroborateLeg(o: LegEnd, d: LegEnd, pos: RoutePosition, track: readonly TimedSample[] | null, missing: string | null = null): Corroboration {
  const O = code(o);
  const D = code(d);
  const sched = `${O}→${D}`;
  const back = alongCorridor(pos, d, o);
  const takeoff = track?.length ? legTakeoff(track, o, d, pos) : null;
  if (takeoff?.end === 'd') {
    return back && headingFor(pos, o)
      ? { kind: 'reverse', routeCheck: `observed departure ${D} and course toward ${O}: shown as flown ${D}→${O}; standing data lists ${sched}` }
      : { kind: 'withhold', routeCheck: `observed departure ${D} contradicts standing data ${sched}, and the aircraft is not on course for ${O} — route not confirmed` };
  }
  if (takeoff?.end === 'o') {
    if (back) return { kind: 'withhold', routeCheck: `departed ${O} earlier, now on course back toward ${O} — return leg or turnaround not observed; route not confirmed` };
    const here: LngLatTuple = [pos.lng, pos.lat];
    if (onRouteCorridor(o, d, here) && trackAlong(pos, o, d) !== false) return { kind: 'departed', routeCheck: `observed departure matches the listed origin ${O}` };
    const offKm = Math.round(positionOnPath(here, ll(o), ll(d)).offKm);
    const away = awayFromDestination(o, d, pos) ? `, track pointing away from ${D}` : '';
    return { kind: 'listed', routeCheck: `departed ${O} but not observed on course for ${D} (${offKm} km off the great circle${away}) — progress not shown` };
  }
  if (takeoff) return { kind: 'withhold', routeCheck: `observed departure is not ${O} — contradicts standing data ${sched}; route not confirmed` };
  if (!awayFromDestination(o, d, pos)) return { kind: 'unobserved' };
  const unobserved = `departure not observed${missing ? ` (${missing})` : ''}`;
  return back
    ? { kind: 'withhold', routeCheck: `airborne inside the corridor but heading toward ${O}, opposite to standing data ${sched}; ${unobserved} — route not confirmed` }
    : { kind: 'withhold', routeCheck: `aircraft is not on standing-data route ${sched} (track points away from ${D}); ${unobserved} — route not confirmed` };
}
