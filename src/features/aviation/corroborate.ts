/**
 * Flown-track corroboration of a standing-data leg (R2 round 5 BLOCKING-1). One rule for
 * GET /api/flight-route (so the aircraft card and Flight Watch) and the FLIGHT view
 * (src/features/flight-paths/server/flight.ts uses the same `onCourseFor` predicate), so the
 * views give one answer. Pure and isomorphic; no I/O.
 *
 * When it applies (`awayFromDestination`): the aircraft is more than 60 km from both ends of the
 * leg and its observed track points away from the listed destination (cos(track − bearing to D)
 * < −0.3, i.e. more than ~107° off). Being "toward the origin" is NOT required: SWA1241 (VRS
 * KSMF-KLAS-KDCA) flew 214° 380 km south-west of DCA, away from DCA and not toward LAS, and the
 * card said LAS→DCA 93 % while it was flying BWI→CLT. Then the flown track decides:
 *  - take-off observed at D, on course for O → the reverse leg, shown as flown (`reverse`);
 *  - take-off observed at D otherwise → withheld (it departed D for somewhere else);
 *  - take-off observed at O, on course back toward O → withheld (turnaround not observed);
 *  - take-off observed at O otherwise → the listed leg without progress (`listed`, the FLIGHT
 *    view's "departed O but not observed on course for D");
 *  - take-off elsewhere, not observed, or no flown track → withheld, with the reason.
 */
import { distanceKm, initialBearing, type LngLatTuple } from '@/lib/geo';
import { flyingRoute, positionOnPath } from '@/features/flight-paths/lib/geometry';
import { angleDiff, CONFLICT_END_KM, LOW_AGL_FT, type AirportPoint, type RoutePoint, type RoutePosition, type TrackSample } from './route-geometry';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const ll = (p: RoutePoint): LngLatTuple => [p.lng, p.lat];

/** cos(track − bearing to D) below this = the track points away from D (more than ~107° off). */
export const AWAY_COS = -0.3;
/** "Toward X": the track within this many degrees of the direct bearing to X … */
export const TOWARD_MIN_DEG = 20;
/** … or wider when close: the present course, extended, passes within this distance of X. */
export const TOWARD_MISS_KM = 80;

/** A leg end: an airport with an optional elevation (ft AMSL) and codes for the stated reason. */
export interface LegEnd extends AirportPoint {
  name?: string;
  elevationFt?: number | null;
}

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
 * that only runs roughly parallel to the corridor is not "toward": UAL1789 departed IAD on 237°
 * inside the IAD–RDU corridor (the path's local bearing ~199°) while RDU bore 152°, and landed at
 * San Antonio (trace a2bbcc, 2026-10-01).
 */
export function headingFor(pos: Pick<RoutePosition, 'lat' | 'lng' | 'trackDeg'>, to: RoutePoint): boolean {
  if (pos.trackDeg == null) return false;
  const here: LngLatTuple = [pos.lng, pos.lat];
  const km = distanceKm(here, ll(to));
  const tol = km <= TOWARD_MISS_KM ? 90 : Math.max(TOWARD_MIN_DEG, Math.asin(TOWARD_MISS_KM / km) * R2D);
  return angleDiff(pos.trackDeg, initialBearing(here, ll(to))) <= tol;
}

/**
 * On course for `to` from `from`: the FLIGHT view's `flyingRoute` (inside the corridor, track
 * within 60° of the path's local bearing; near an end the vertical rate decides) AND `headingFor`.
 */
export function onCourseFor(pos: RoutePosition, from: RoutePoint, to: RoutePoint): boolean {
  if (pos.trackDeg == null) return false;
  const s = { lat: pos.lat, lng: pos.lng, altFt: pos.altFt ?? null, gsKt: pos.speedKt, trackDeg: pos.trackDeg, vrFpm: pos.vrFpm ?? null };
  return flyingRoute(s, ll(from), ll(to)) && headingFor(pos, to);
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
    const here: LngLatTuple = [p.lng, p.lat];
    const dO = distanceKm(here, ll(o));
    const dD = distanceKm(here, ll(d));
    const ground = (dO <= dD ? o.elevationFt : d.elevationFt) ?? 0;
    const low = p.onGround || (p.altFt !== null && p.altFt - ground < LOW_AGL_FT);
    if (!low) {
      airborneAfter = true;
      continue;
    }
    if (!airborneAfter) continue;
    return { end: dO <= CONFLICT_END_KM ? 'o' : dD <= CONFLICT_END_KM ? 'd' : null, lat: p.lat, lng: p.lng };
  }
  return null;
}

export type Corroboration =
  /** Departed the listed origin: the listed leg stands, progress is not shown. */
  | { kind: 'listed'; routeCheck: string }
  /** Departed the listed destination and on course for the listed origin: shown as flown d→o. */
  | { kind: 'reverse'; routeCheck: string }
  /** No leg, destination or progress is named. */
  | { kind: 'withhold'; routeCheck: string };

/**
 * Corroborate o→d for an aircraft that `awayFromDestination` flagged. `track` is its flown track
 * (current leg, oldest first) or null when none could be read; `missing` says why (shown in the
 * reason). The wording follows the FLIGHT view's.
 */
export function corroborateLeg(o: LegEnd, d: LegEnd, pos: RoutePosition, track: readonly TrackSample[] | null, missing: string | null = null): Corroboration {
  const O = code(o);
  const D = code(d);
  const sched = `${O}→${D}`;
  const back = onCourseFor(pos, d, o);
  const takeoff = track?.length ? lastTakeoff(track, o, d) : null;
  if (takeoff?.end === 'd') {
    return back
      ? { kind: 'reverse', routeCheck: `observed departure ${D} and course toward ${O}: shown as flown ${D}→${O}; standing data lists ${sched}` }
      : { kind: 'withhold', routeCheck: `observed departure ${D} contradicts standing data ${sched}, and the aircraft is not on course for ${O} — route not confirmed` };
  }
  if (takeoff?.end === 'o') {
    if (back) return { kind: 'withhold', routeCheck: `departed ${O} earlier, now on course back toward ${O} — return leg or turnaround not observed; route not confirmed` };
    const offKm = Math.round(positionOnPath([pos.lng, pos.lat], ll(o), ll(d)).offKm);
    return { kind: 'listed', routeCheck: `departed ${O} but not observed on course for ${D} (${offKm} km off the great circle, track pointing away from ${D}) — progress not shown` };
  }
  if (takeoff) return { kind: 'withhold', routeCheck: `observed departure is not ${O} — contradicts standing data ${sched}; route not confirmed` };
  const unobserved = `departure not observed${missing ? ` (${missing})` : ''}`;
  return back
    ? { kind: 'withhold', routeCheck: `airborne inside the corridor but heading toward ${O}, opposite to standing data ${sched}; ${unobserved} — route not confirmed` }
    : { kind: 'withhold', routeCheck: `aircraft is not on standing-data route ${sched} (track points away from ${D}); ${unobserved} — route not confirmed` };
}
