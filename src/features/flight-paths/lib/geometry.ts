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
    .map(({ c, off, along }) => ({ code: c.code, name: c.name, runwayM: c.runwayM!, distanceFromPathKm: round(off, 1), alongPathKm: round(along, 1) }));
}

// ── Live aircraft on a route ─────────────────────────────────────────────────────
export const CORRIDOR = { maxOffKm: 100, maxTrackDiffDeg: 35, minAltFt: 8000, minFraction: 0.02, maxFraction: 0.98 } as const;
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

const angleDiff = (x: number, y: number) => Math.abs(((x - y + 540) % 360) - 180);

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

/**
 * Corridor inference for an aircraft without a callsign match: close to the path, heading along
 * it, at cruise-ish altitude, not at either end, and passing the detour test.
 */
export function corridorMatch(s: LiveState, a: LngLatTuple, b: LngLatTuple): boolean {
  if (s.altFt === null || s.altFt <= CORRIDOR.minAltFt || s.trackDeg === null) return false;
  const p: LngLatTuple = [s.lng, s.lat];
  const total = distanceKm(a, b);
  if (total < 100) return false;
  const { offKm, alongKm } = positionOnPath(p, a, b);
  if (offKm > CORRIDOR.maxOffKm) return false;
  const f = alongKm / total;
  if (f < CORRIDOR.minFraction || f > CORRIDOR.maxFraction) return false;
  // Local bearing of the path at the aircraft's along-track point.
  const here = interpolate(a, b, f);
  const local = initialBearing(here, b);
  if (angleDiff(s.trackDeg, local) > CORRIDOR.maxTrackDiffDeg) return false;
  return onCorridor(p, a, b);
}

/**
 * ETA (ms epoch): remaining / ground speed, blended halfway toward 480 kt cruise when the aircraft
 * is slow (< 200 kt) or climbing/descending (|vr| > 1000 fpm), plus 10 min for the approach.
 * Null without a usable ground speed.
 */
export function etaMs(remainingKm: number, s: Pick<LiveState, 'gsKt' | 'vrFpm'>, now: number): number | null {
  if (s.gsKt === null || s.gsKt <= 50) return null;
  const transitional = s.gsKt < 200 || (s.vrFpm !== null && Math.abs(s.vrFpm) > 1000);
  const kts = transitional ? (s.gsKt + CRUISE_BLEND_KTS) / 2 : s.gsKt;
  return Math.round(now + (remainingKm / (kts * 1.852)) * 3_600_000 + APPROACH_MIN * 60_000);
}
