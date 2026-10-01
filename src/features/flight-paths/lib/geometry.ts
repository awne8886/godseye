/**
 * Route geometry and estimates for the Flight Path Planner (§8). Pure and isomorphic; every
 * number here is either computed from coordinates or a stated assumption (cruise speeds, the
 * +30 min block allowance, the +10 min approach allowance), never a guess dressed up as data.
 * Owner: feature-flight-paths.
 */
import {
  alongTrackKm,
  antimeridianCrossings,
  crossTrackKm,
  distanceKm,
  finalBearing,
  greatCirclePoints,
  initialBearing,
  interpolate,
  kmToNm,
  midpoint,
  normalizeLng,
  splitAtAntimeridian,
  type LngLatTuple,
} from '@/lib/geo';
import { twilightAt, type Twilight } from '@/lib/solar';

export const GREAT_CIRCLE_POINTS = 256;

export interface GreatCircle {
  points: LngLatTuple[];
  multiLineString: GeoJSON.MultiLineString;
  distanceKm: number;
  distanceNm: number;
  initialBearing: number;
  finalBearing: number;
  midpoint: LngLatTuple;
  antimeridianCrossings: number;
  polar: boolean;
}

const round = (v: number, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;
/** Bearings rounded to 0.1° but kept inside [0, 360). */
const bearing = (b: number) => {
  const r = round(b, 1);
  return r >= 360 ? 0 : r;
};

/** Great circle a→b: unwrapped points (continuous across ±180°) plus the split MultiLineString. */
export function greatCircle(a: LngLatTuple, b: LngLatTuple, n = GREAT_CIRCLE_POINTS): GreatCircle {
  const points = greatCirclePoints(a, b, n).map(([x, y]) => [round(x, 5), round(y, 5)] as LngLatTuple);
  const km = distanceKm(a, b);
  const mid = midpoint(a, b);
  return {
    points,
    multiLineString: { type: 'MultiLineString', coordinates: splitAtAntimeridian(points) },
    distanceKm: round(km, 1),
    distanceNm: round(kmToNm(km), 1),
    initialBearing: bearing(initialBearing(a, b)),
    finalBearing: bearing(finalBearing(a, b)),
    midpoint: [round(normalizeLng(mid[0]), 5), round(mid[1], 5)],
    antimeridianCrossings: antimeridianCrossings(points),
    // Polar: the path reaches beyond 66.5° (Arctic/Antarctic circle), where polar ops rules apply.
    polar: points.some(([, lat]) => Math.abs(lat) >= 66.5),
  };
}

export const CRUISE_KTS = { narrowbody: 450, widebody: 480, bizjet: 460, turboprop: 280 } as const;
export type AircraftClass = keyof typeof CRUISE_KTS;
export const BLOCK_ALLOWANCE_MIN = 30;
export const ESTIMATE_METHOD =
  'Block time = great-circle distance ÷ typical cruise ground speed (still air) + 30 min for taxi, climb and descent. Not a schedule: winds, routings and ATC change real block times.';

export function blockMinutes(km: number, cruiseKts: number): number {
  return Math.max(1, Math.round((km / (cruiseKts * 1.852)) * 60 + BLOCK_ALLOWANCE_MIN));
}

export function estimatesByClass(km: number) {
  const out = {} as Record<AircraftClass, { cruiseKts: number; blockMinutes: number }>;
  for (const [k, kts] of Object.entries(CRUISE_KTS) as [AircraftClass, number][]) out[k] = { cruiseKts: kts, blockMinutes: blockMinutes(km, kts) };
  return out;
}

export interface DaylightSample {
  fraction: number;
  isDay: boolean;
  twilight: Twilight;
}

export const DAYLIGHT_METHOD =
  'Sun elevation at 10 evenly spaced points (0 → 1) along the great circle, timed for a departure now at widebody cruise (480 kt, still air).';

/** Ten samples along a→b for a flight departing at `departAt` flying at `cruiseKts`. */
export function daylightSamples(a: LngLatTuple, b: LngLatTuple, departAt: number, cruiseKts = CRUISE_KTS.widebody): DaylightSample[] {
  const km = distanceKm(a, b);
  const airborneMs = (km / (cruiseKts * 1.852)) * 3_600_000;
  const out: DaylightSample[] = [];
  for (let i = 0; i < 10; i++) {
    const f = i / 9;
    const p = interpolate(a, b, f);
    const tw = twilightAt(p, departAt + f * airborneMs);
    out.push({ fraction: round(f, 3), isDay: tw === 'day', twilight: tw });
  }
  return out;
}

/** Evenly spaced sample points along a→b (inclusive of neither end), for winds aloft. */
export function samplePoints(a: LngLatTuple, b: LngLatTuple, n: number): { fraction: number; point: LngLatTuple }[] {
  const out: { fraction: number; point: LngLatTuple }[] = [];
  for (let i = 1; i <= n; i++) {
    const f = i / (n + 1);
    const p = interpolate(a, b, f);
    out.push({ fraction: round(f, 3), point: [normalizeLng(p[0]), p[1]] });
  }
  return out;
}

export interface PathPosition {
  /** Distance from the path (km, ≥ 0). */
  offKm: number;
  /** Distance along a→b to the closest point (km, may be < 0 or > total). */
  alongKm: number;
}

export function positionOnPath(p: LngLatTuple, a: LngLatTuple, b: LngLatTuple): PathPosition {
  return { offKm: Math.abs(crossTrackKm(p, a, b)), alongKm: alongTrackKm(p, a, b) };
}

export interface DiversionCandidate {
  code: string;
  name: string;
  lat: number;
  lng: number;
  runwayM: number | null;
}

export const DIVERSION_MIN_RUNWAY_M = 2400;
export const DIVERSION_MAX_OFF_KM = 200;
export const DIVERSION_BUCKET_KM = 300;
export const DIVERSION_METHOD = `Airports with a paved runway ≥ ${DIVERSION_MIN_RUNWAY_M} m within ${DIVERSION_MAX_OFF_KM} km of the great circle; the closest to the path in each ${DIVERSION_BUCKET_KM} km stretch (longest runway breaks ties). Planning aid only.`;

/**
 * Diversion airports along a→b: long paved runway, within 200 km of the path, strictly between the
 * ends. One per 300 km stretch (closest to the path) so the list covers the whole route.
 */
export function selectDiversions(a: LngLatTuple, b: LngLatTuple, candidates: readonly DiversionCandidate[], exclude: ReadonlySet<string> = new Set()) {
  const total = distanceKm(a, b);
  const best = new Map<number, { c: DiversionCandidate; off: number; along: number }>();
  for (const c of candidates) {
    if (exclude.has(c.code) || c.runwayM === null || c.runwayM < DIVERSION_MIN_RUNWAY_M) continue;
    const p: LngLatTuple = [c.lng, c.lat];
    // Cheap reject before the trigonometry: farther than the route length + margin from both ends.
    if (distanceKm(a, p) > total + DIVERSION_MAX_OFF_KM) continue;
    const { offKm, alongKm } = positionOnPath(p, a, b);
    if (offKm > DIVERSION_MAX_OFF_KM || alongKm <= 0 || alongKm >= total) continue;
    const bucket = Math.floor(alongKm / DIVERSION_BUCKET_KM);
    const cur = best.get(bucket);
    if (!cur || offKm < cur.off - 1e-9 || (Math.abs(offKm - cur.off) < 1e-9 && (c.runwayM ?? 0) > (cur.c.runwayM ?? 0))) best.set(bucket, { c, off: offKm, along: alongKm });
  }
  return [...best.values()]
    .sort((x, y) => x.along - y.along)
    .map(({ c, off, along }) => ({ code: c.code, name: c.name, runwayM: c.runwayM!, distanceFromPathKm: round(off, 1), alongPathKm: round(along, 1), lat: c.lat, lng: c.lng }));
}

// ── Live aircraft on a route ─────────────────────────────────────────────────────
/**
 * Corridor inference thresholds (R2-M2: tightened after live LHR→JFK showed domestic legs, cargo and
 * military traffic near the endpoints being inferred). An inferred aircraft must be near the great
 * circle, tracking along it, at cruise level for the route length, and well clear of both
 * endpoints (where every arrival/departure converges regardless of its real route).
 */
export const CORRIDOR = {
  maxOffKm: 100,
  maxTrackDiffDeg: 20,
  minFraction: 0.05,
  maxFraction: 0.95,
  /** Never closer than this to either endpoint (capped at 15 % of the route for short routes). */
  minEndKm: 400,
  minEndFraction: 0.15,
  /** Shortest route considered at all. */
  minRouteKm: 300,
  /** The present course, extended, must pass within this of the destination … */
  courseMissKm: 80,
  /** … with at least this much angular slack (oceanic tracks are not great circles). */
  minCourseDeg: 6,
} as const;

/** Minimum barometric altitude for an inferred aircraft: cruise band scaled by route length. */
export function corridorMinAltFt(routeKm: number): number {
  if (routeKm >= 1500) return 25_000;
  if (routeKm >= 700) return 18_000;
  return 10_000;
}
export const CRUISE_BLEND_KTS = 480;
export const APPROACH_MIN = 10;

export interface LiveState {
  lat: number;
  lng: number;
  altFt: number | null;
  gsKt: number | null;
  trackDeg: number | null;
  vrFpm: number | null;
}

/** Smallest angle between two bearings (0–180°). */
export const angleDiff = (x: number, y: number) => Math.abs(((x - y + 540) % 360) - 180);

/** OSIRIS corridor test: detour via the aircraft ≤ direct × 1.15 + 150 km. */
export function onCorridor(p: LngLatTuple, a: LngLatTuple, b: LngLatTuple): boolean {
  const direct = distanceKm(a, b);
  return distanceKm(a, p) + distanceKm(p, b) <= direct * 1.15 + 150;
}

/** Progress (0–1) and remaining km along a→b for an aircraft at p. */
export function progressOn(p: LngLatTuple, a: LngLatTuple, b: LngLatTuple): { progress: number; remainingKm: number; alongKm: number; totalKm: number } {
  const totalKm = distanceKm(a, b);
  const along = Math.min(totalKm, Math.max(0, alongTrackKm(p, a, b)));
  const progress = totalKm > 0 ? along / totalKm : 0;
  // Remaining = straight great-circle distance from the aircraft to the destination.
  return { progress: round(Math.min(1, Math.max(0, progress)), 4), remainingKm: round(distanceKm(p, b), 1), alongKm: along, totalKm };
}


export type CorridorReject = 'no-state' | 'short-route' | 'altitude' | 'off-path' | 'near-endpoint' | 'heading' | 'course' | 'detour';

/**
 * Corridor inference for an aircraft without a callsign match: close to the path, tracking along
 * it (±20° of the local great-circle bearing), at cruise level for the route length, clear of both
 * endpoints, and passing the detour test. Returns null on a match, else the first failed test.
 */
export function corridorReject(s: LiveState, a: LngLatTuple, b: LngLatTuple): CorridorReject | null {
  if (s.altFt === null || s.trackDeg === null) return 'no-state';
  const total = distanceKm(a, b);
  if (total < CORRIDOR.minRouteKm) return 'short-route';
  if (s.altFt < corridorMinAltFt(total)) return 'altitude';
  const p: LngLatTuple = [s.lng, s.lat];
  const { offKm, alongKm } = positionOnPath(p, a, b);
  if (offKm > CORRIDOR.maxOffKm) return 'off-path';
  const f = alongKm / total;
  if (f < CORRIDOR.minFraction || f > CORRIDOR.maxFraction) return 'near-endpoint';
  const endKm = Math.min(CORRIDOR.minEndKm, total * CORRIDOR.minEndFraction);
  if (distanceKm(p, a) < endKm || distanceKm(p, b) < endKm) return 'near-endpoint';
  // Local bearing of the path at the aircraft's along-track point.
  const here = interpolate(a, b, f);
  const local = initialBearing(here, b);
  if (angleDiff(s.trackDeg, local) > CORRIDOR.maxTrackDiffDeg) return 'heading';
  // The aircraft's present course must pass within `courseMissKm` of the destination (an
  // eastbound flight off Ireland heading for Paris tracks ~15° right of London).
  const toB = distanceKm(p, b);
  const tol = Math.max(CORRIDOR.minCourseDeg, (Math.asin(Math.min(1, CORRIDOR.courseMissKm / toB)) * 180) / Math.PI);
  if (angleDiff(s.trackDeg, initialBearing(p, b)) > tol) return 'course';
  return onCorridor(p, a, b) ? null : 'detour';
}

/** Direction test thresholds (R4 round 3, B1/M1; round 4 M1). */
export const DIRECTION = {
  /** Track within this of the local great-circle bearing toward b (airways and oceanic tracks are not great circles). */
  maxTrackDiffDeg: 60,
  /** Within this of an endpoint the path bearing says little (SIDs, holds, downwind legs): the vertical rate and the bearing to the endpoint decide. */
  terminalKm: 150,
  /** Climbing faster than this near b is a departure from b; descending faster than this near a is an arrival at a. */
  vrFpm: 500,
  /** Near b, a level aircraft tracking more than this away from b is not arriving; near a, a level one tracking less than this toward a is not departing. */
  endpointDeg: 90,
} as const;

/**
 * Is an airborne aircraft flying a→b (true), not (false), or is that unknown from what was observed
 * (null: no track; near an endpoint without a vertical rate and nothing contradicting)? En route:
 * the observed track within ±60° of the local great-circle bearing toward b. Within 150 km of an
 * endpoint (round 4 M1: a level aircraft there was "on course" whatever its track):
 *  - near b: not climbing out of it, and — unless descending — tracking within 90° of b;
 *  - near a: not descending into it, and — unless climbing — tracking more than 90° from a.
 * Says nothing about the corridor (see `onCorridor`).
 */
export function headingAlong(s: LiveState, a: LngLatTuple, b: LngLatTuple): boolean | null {
  if (s.trackDeg === null) return null;
  const p: LngLatTuple = [s.lng, s.lat];
  const total = distanceKm(a, b);
  const nearB = distanceKm(p, b) <= DIRECTION.terminalKm;
  const nearA = distanceKm(p, a) <= DIRECTION.terminalKm;
  if (nearB || nearA) {
    const climbing = s.vrFpm !== null && s.vrFpm > DIRECTION.vrFpm;
    const descending = s.vrFpm !== null && s.vrFpm < -DIRECTION.vrFpm;
    if (nearB && climbing) return false;
    if (nearA && !nearB && descending) return false;
    if (nearB && !descending && angleDiff(s.trackDeg, initialBearing(p, b)) > DIRECTION.endpointDeg) return false;
    if (nearA && !climbing && angleDiff(s.trackDeg, initialBearing(p, a)) < DIRECTION.endpointDeg) return false;
    return s.vrFpm === null ? null : true;
  }
  const f = total > 0 ? alongTrackKm(p, a, b) / total : 0;
  // Abeam the path: its local bearing; before a or past b: straight toward b.
  const local = f > 0 && f < 1 ? initialBearing(interpolate(a, b, f), b) : initialBearing(p, b);
  return angleDiff(s.trackDeg, local) <= DIRECTION.maxTrackDiffDeg;
}

/** On a→b: inside the corridor AND heading toward b (an observed direction, never assumed). */
export function flyingRoute(s: LiveState, a: LngLatTuple, b: LngLatTuple): boolean {
  return onCorridor([s.lng, s.lat], a, b) && headingAlong(s, a, b) === true;
}

export function corridorMatch(s: LiveState, a: LngLatTuple, b: LngLatTuple): boolean {
  return corridorReject(s, a, b) === null;
}

/**
 * ETA (ms epoch): remaining / ground speed, blended halfway toward 480 kt cruise when the aircraft
 * is slow (< 200 kt) or climbing/descending (|vr| > 1000 fpm), plus 10 min for the approach.
 * `from` is the OBSERVATION time of the position (round 4 m1: not the request time — a position
 * seen 2 min ago is 2 min further along). Null without a usable ground speed.
 */
export function etaMs(remainingKm: number, s: Pick<LiveState, 'gsKt' | 'vrFpm'>, from: number): number | null {
  if (s.gsKt === null || s.gsKt <= 50) return null;
  const transitional = s.gsKt < 200 || (s.vrFpm !== null && Math.abs(s.vrFpm) > 1000);
  const kts = transitional ? (s.gsKt + CRUISE_BLEND_KTS) / 2 : s.gsKt;
  return Math.round(from + (remainingKm / (kts * 1.852)) * 3_600_000 + APPROACH_MIN * 60_000);
}

// ── One longitude frame for everything drawn for a route/flight (antimeridian) ─────
/** `lng` shifted by whole turns so it lies within 180° of `ref` (same world copy). */
export function nearLng(lng: number, ref: number): number {
  return lng + 360 * Math.round((ref - lng) / 360);
}

/**
 * Unwrap a polyline so consecutive longitudes never differ by more than 180°, with the first
 * point placed in the world copy nearest `anchorLng` (when given). Latitudes are untouched.
 */
export function unwrapPath(points: readonly LngLatTuple[], anchorLng?: number): LngLatTuple[] {
  const out: LngLatTuple[] = [];
  let prev: number | null = anchorLng ?? null;
  for (const [lng, lat] of points) {
    const x = prev === null ? lng : nearLng(lng, prev);
    out.push([x, lat]);
    prev = x;
  }
  return out;
}

/** Index of the vertex of `path` nearest to `p` on the sphere (−1 for an empty path). */
export function nearestVertex(path: readonly LngLatTuple[], p: LngLatTuple): number {
  let best = -1;
  let bestKm = Infinity;
  for (let i = 0; i < path.length; i++) {
    const km = distanceKm(path[i]!, p);
    if (km < bestKm) {
      bestKm = km;
      best = i;
    }
  }
  return best;
}

/** `p` moved into the longitude frame of the (unwrapped) `path`: the copy nearest its closest vertex. */
export function intoFrame(p: LngLatTuple, path: readonly LngLatTuple[]): LngLatTuple {
  const i = nearestVertex(path, p);
  return i < 0 ? p : [nearLng(p[0], path[i]![0]), p[1]];
}

/** A polyline moved into the frame of `path`: its first point placed via `intoFrame`, the rest unwrapped from there. */
export function pathIntoFrame(points: readonly LngLatTuple[], path: readonly LngLatTuple[]): LngLatTuple[] {
  if (!points.length) return [];
  return unwrapPath(points, intoFrame(points[0]!, path)[0]);
}

/** Largest longitude step between consecutive points (a continuous line has ≤ 180). */
export function maxLngStep(points: readonly LngLatTuple[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) m = Math.max(m, Math.abs(points[i]![0] - points[i - 1]![0]));
  return m;
}

/** Bounds [[west, south], [east, north]] of an unwrapped polyline (west may be < −180, east > 180). */
export function pathBounds(points: readonly LngLatTuple[]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [[w, s], [e, n]];
}

/** Point at fraction `f` (0–1, by vertex count) along an unwrapped polyline, linearly between vertices. */
export function pointAlong(points: readonly LngLatTuple[], f: number): LngLatTuple | null {
  if (!points.length) return null;
  if (points.length === 1) return points[0]!;
  const x = Math.max(0, Math.min(1, f)) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(x));
  const t = x - i;
  const a = points[i]!;
  const b = points[i + 1]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Split a polyline into dash pieces of `on` vertices followed by a gap of `off` vertices (the
 * `[2,2]` dash of §8 on a 256-point arc). Pure geometry: every vertex comes from the input.
 */
export function dashPieces(points: readonly LngLatTuple[], on = 4, off = 3): LngLatTuple[][] {
  const out: LngLatTuple[][] = [];
  const step = on + off;
  for (let i = 0; i + 1 < points.length; i += step) out.push(points.slice(i, Math.min(points.length, i + on + 1)));
  return out.filter((d) => d.length >= 2);
}
