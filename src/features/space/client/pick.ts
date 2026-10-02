/**
 * Satellite picking against the LATEST propagated frame. Satellites move every tick, and the
 * deck layer draws them from binary attributes (no `info.object`), so a click resolves through:
 *  - `hitTestSatellites`: a CPU hit-test on the newest frame's positions, projected at the same
 *    compressed display altitude the markers are drawn at (works where GPU picking does not);
 *  - `latestPosition`: the GPU pick's catalogue index mapped onto the newest frame, so the card
 *    opens where the marker is now, not where it was when the picking buffer was drawn.
 *
 * Far side (§3): MapLibre's globe `project()` has no occlusion test, so a satellite behind the
 * globe projects inside the disk. Every candidate is re-checked with
 * `isFacing(p, camera, displayAltitudeM)` for the CURRENT camera (the frame may be up to one
 * re-filter older than the camera) and a hidden satellite never hides a visible neighbour.
 *
 * Cost (verification round 8, MAJOR): the host runs every CPU hit-tester on each animation frame
 * the pointer moves, and MapLibre's globe `project()` dominates (three calls per satellite before:
 * 33 ms of CPU per hover frame with 9k drawn satellites). `projectFrame` projects the globe centre
 * once per pass, derives the elevated point from the ground point, skips the far-side test when
 * the worker already filtered the frame with the current camera, and on the globe projects the
 * ground points with a perspective matrix fitted to (and checked against) `project()` at 25
 * points (`fitGlobeProjection`; without a verified fit, one `project()` per satellite).
 * `SatelliteScreenCache` keeps that table for one (frame, camera) pair, so every further hover or
 * click until the next 1 Hz frame or camera change is a scan over a Float32Array with a single
 * `project()` (the camera key's globe-centre probe).
 * Pure; unit-tested. Owner: layers-space.
 */
import type { HitTestMap, PickCandidate } from '@/lib/map/picking';
import { horizonAngleDeg, isFacing, type FarSideCamera } from '@/lib/map/far-side';

export interface PickFrame {
  count: number;
  /** [lng, lat, displayAltitudeMetres] × count. */
  positions: Float32Array;
  /** Catalogue index × count. */
  index: Uint32Array;
  /** The far-side camera the worker filtered this frame with (null: mercator / none yet). */
  camera?: FarSideCamera | null;
}

/** How the frame is projected: globe (with the far-side camera) or mercator. */
export interface PickView {
  globe: boolean;
  /** The far-side camera (`getFarSideCamera()`); null in mercator or before the host published it. */
  camera: FarSideCamera | null;
}

/** A satellite candidate carries the height its marker is drawn at (a far-side test must lift it by it). */
export type SatPickCandidate = PickCandidate & { altitudeM: number };

/**
 * The map surface the satellite picker projects with. The camera getters are optional (a real
 * MapLibre map has them all); they make the screen cache's camera key stricter.
 */
export type ProjectMap = Pick<HitTestMap, 'project' | 'getCenter'> & {
  getZoom?: () => number;
  getBearing?: () => number;
  getPitch?: () => number;
  getRoll?: () => number;
  getCanvas?: () => { clientWidth: number; clientHeight: number };
};

export const SAT_HIT_PX = 10;
const EARTH_RADIUS_M = 6_371_008.8;

/** Screen position of the globe centre (the origin of the radial altitude offset). */
function globeOrigin(map: ProjectMap): { x: number; y: number } {
  const c = map.getCenter();
  return map.project([c.lng, c.lat]);
}

/** `g` (a ground point on screen) lifted `altM` above the globe: radial scaling from `origin`. */
function lift(g: { x: number; y: number }, origin: { x: number; y: number }, altM: number): { x: number; y: number } {
  const k = 1 + altM / EARTH_RADIUS_M;
  return { x: origin.x + (g.x - origin.x) * k, y: origin.y + (g.y - origin.y) * k };
}

/** Screen position of a marker drawn `altM` above the globe (radial scaling from the globe centre). */
export function elevatedPoint(map: ProjectMap, lng: number, lat: number, altM: number, globe: boolean): { x: number; y: number } {
  const g = map.project([lng, lat]);
  if (!globe || altM <= 0) return g;
  return lift(g, globeOrigin(map), altM);
}

/** True when the marker at row `k` of `frame` is on the camera-facing side (always in mercator). */
export function frameRowFaces(frame: PickFrame, k: number, view: PickView): boolean {
  if (!view.globe) return true;
  return isFacing([frame.positions[k * 3]!, frame.positions[k * 3 + 1]!], view.camera, frame.positions[k * 3 + 2]!);
}

/** True when both far-side cameras are the same (a frame filtered with `a` needs no re-test for `b`). */
export function sameCamera(a: FarSideCamera | null | undefined, b: FarSideCamera | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.lng === b.lng && a.lat === b.lat && a.altitude === b.altitude;
}

const RAD = Math.PI / 180;
/** A fitted projection must reproduce `project()` this closely at every check point, or it is not used. */
export const FIT_TOLERANCE_PX = 0.25;

/** (lng, lat) on the unit sphere. Any fixed rigid embedding works: the fitted matrix absorbs it. */
function unitVector(lng: number, lat: number): [number, number, number] {
  const cl = Math.cos(lat * RAD);
  return [cl * Math.cos(lng * RAD), cl * Math.sin(lng * RAD), Math.sin(lat * RAD)];
}

/** The point `distDeg` of arc from (lng, lat) along `bearingDeg`. */
function offsetPoint(lng: number, lat: number, bearingDeg: number, distDeg: number): [number, number] {
  const p1 = lat * RAD;
  const d = distDeg * RAD;
  const t = bearingDeg * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = lng * RAD + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((((l2 / RAD + 540) % 360) + 360) % 360) - 180, p2 / RAD];
}

/** Solve the n×n system `m x = b` in place (Gaussian elimination, partial pivoting); null if singular. */
function solve(m: Float64Array, b: Float64Array, n: number): Float64Array | null {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r * n + c]!) > Math.abs(m[p * n + c]!)) p = r;
    if (!(Math.abs(m[p * n + c]!) > 1e-12)) return null;
    if (p !== c) {
      for (let k = 0; k < n; k++) [m[c * n + k], m[p * n + k]] = [m[p * n + k]!, m[c * n + k]!];
      [b[c], b[p]] = [b[p]!, b[c]!];
    }
    for (let r = c + 1; r < n; r++) {
      const f = m[r * n + c]! / m[c * n + c]!;
      if (f === 0) continue;
      for (let k = c; k < n; k++) m[r * n + k]! -= f * m[c * n + k]!;
      b[r]! -= f * b[c]!;
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < n; k++) s -= m[r * n + k]! * x[k]!;
    x[r] = s / m[r * n + r]!;
  }
  return x;
}

/** Screen point of the unit-sphere vector `v` under the 3×4 matrix `p` (row-major), or null behind the camera. */
function applyFit(p: Float64Array, v: readonly [number, number, number]): { x: number; y: number } | null {
  const w = p[8]! * v[0] + p[9]! * v[1] + p[10]! * v[2] + p[11]!;
  if (!(w > 1e-9)) return null;
  return { x: (p[0]! * v[0] + p[1]! * v[1] + p[2]! * v[2] + p[3]!) / w, y: (p[4]! * v[0] + p[5]! * v[1] + p[6]! * v[2] + p[7]!) / w };
}

/**
 * MapLibre's globe `project()` is a perspective view of a sphere: screen = P · (unit vector, 1)
 * for one 3×4 matrix P per camera, which MapLibre 6.11 does not expose. Fit P (direct linear
 * transform, P[2][3] = 1, screen coordinates normalised) to `project()` at 19 points around the
 * map centre, inside the camera's horizon, then check it at 6 other points: if any misses
 * `project()` by more than FIT_TOLERANCE_PX (the globe→mercator transition, a steep pitch that
 * puts samples behind the camera, a non-perspective surface), return null and the caller projects
 * every row with `project()`. A fit costs 25 `project()` calls instead of one per satellite.
 */
export function fitGlobeProjection(map: ProjectMap, view: PickView): Float64Array | null {
  const c = map.getCenter();
  const capDeg = Math.min(80, view.camera ? Math.max(1, horizonAngleDeg(view.camera.altitude)) : 60);
  const sample = (fracs: readonly number[], bearings: readonly number[]) => {
    const pts: [number, number][] = [];
    for (const f of fracs) for (const b of bearings) pts.push(f === 0 ? [c.lng, c.lat] : offsetPoint(c.lng, c.lat, b, f * capDeg));
    return pts.map((ll) => ({ v: unitVector(ll[0], ll[1]), s: map.project(ll) }));
  };
  const fit = [...sample([0], [0]), ...sample([0.3, 0.6, 0.9], [0, 60, 120, 180, 240, 300])];
  const check = sample([0.45, 0.8], [30, 150, 270]);
  if (![...fit, ...check].every((q) => Number.isFinite(q.s.x) && Number.isFinite(q.s.y))) return null;
  // Normalise the screen coordinates (Hartley) so the normal equations stay well conditioned.
  let mu = 0;
  let mv = 0;
  for (const q of fit) {
    mu += q.s.x / fit.length;
    mv += q.s.y / fit.length;
  }
  let spread = 0;
  for (const q of fit) spread += Math.hypot(q.s.x - mu, q.s.y - mv) / fit.length;
  if (!(spread > 1e-6)) return null;
  const n = 11;
  const ata = new Float64Array(n * n);
  const atb = new Float64Array(n);
  const row = new Float64Array(n);
  for (const q of fit) {
    const [X, Y, Z] = q.v;
    for (const [axis, t] of [
      [0, (q.s.x - mu) / spread],
      [1, (q.s.y - mv) / spread],
    ] as const) {
      row.fill(0);
      row[axis * 4] = X;
      row[axis * 4 + 1] = Y;
      row[axis * 4 + 2] = Z;
      row[axis * 4 + 3] = 1;
      row[8] = -t * X;
      row[9] = -t * Y;
      row[10] = -t * Z;
      for (let i = 0; i < n; i++) {
        atb[i]! += row[i]! * t;
        for (let j = 0; j < n; j++) ata[i * n + j]! += row[i]! * row[j]!;
      }
    }
  }
  const x = solve(ata, atb, n);
  if (!x) return null;
  // Undo the normalisation: u = spread · u' + mu (likewise v), with the shared third row.
  const p = new Float64Array(12);
  for (let k = 0; k < 4; k++) {
    const r2 = k < 3 ? x[8 + k]! : 1;
    p[k] = spread * x[k]! + mu * r2;
    p[4 + k] = spread * x[4 + k]! + mv * r2;
    p[8 + k] = r2;
  }
  for (const q of [...fit, ...check]) {
    const s = applyFit(p, q.v);
    if (!s || Math.hypot(s.x - q.s.x, s.y - q.s.y) > FIT_TOLERANCE_PX) return null;
  }
  return p;
}

/**
 * Screen table for one frame and one camera: [elevatedX, elevatedY, groundX, groundY] per row,
 * NaN for a row behind the globe (never hit). On the globe the ground points come from the fitted
 * projection (`fitGlobeProjection`, verified against `project()`); without a fit, one `project()`
 * per facing row. The globe centre is projected once per pass. The far-side test runs only when
 * the worker filtered the frame with another camera (`frame.camera`).
 */
export function projectFrame(frame: PickFrame, map: ProjectMap, view: PickView): Float32Array {
  const xy = new Float32Array(frame.count * 4);
  const testFacing = view.globe && !sameCamera(frame.camera, view.camera);
  const origin = view.globe ? globeOrigin(map) : null;
  const fitted = view.globe && frame.count > 32 ? fitGlobeProjection(map, view) : null;
  const pos = frame.positions;
  for (let k = 0; k < frame.count; k++) {
    const o = k * 4;
    if (testFacing && !frameRowFaces(frame, k, view)) {
      xy[o] = xy[o + 1] = xy[o + 2] = xy[o + 3] = Number.NaN;
      continue;
    }
    const altM = pos[k * 3 + 2]!;
    const lng = pos[k * 3]!;
    const lat = pos[k * 3 + 1]!;
    const g = (fitted && applyFit(fitted, unitVector(lng, lat))) || map.project([lng, lat]);
    const e = origin && altM > 0 ? lift(g, origin, altM) : g;
    xy[o] = e.x;
    xy[o + 1] = e.y;
    xy[o + 2] = g.x;
    xy[o + 3] = g.y;
  }
  return xy;
}

/** Row of the nearest marker within SAT_HIT_PX of `point` in a `projectFrame` table (elevated or ground point), or null. */
export function nearestInTable(xy: Float32Array, count: number, point: { x: number; y: number }): { k: number; d2: number } | null {
  let best = -1;
  let bestD = SAT_HIT_PX * SAT_HIT_PX;
  const { x, y } = point;
  for (let k = 0; k < count; k++) {
    const o = k * 4;
    const ex = xy[o]! - x;
    const ey = xy[o + 1]! - y;
    const gx = xy[o + 2]! - x;
    const gy = xy[o + 3]! - y;
    // A row behind the globe is NaN: every comparison with it is false, so it never wins.
    const d = Math.min(ex * ex + ey * ey, gx * gx + gy * gy);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best < 0 ? null : { k: best, d2: bestD };
}

/** Where catalogue row `catIndex` is drawn in the newest frame ([lng, lat, displayAltM]), or null. */
export function latestPosition(frame: PickFrame | null, catIndex: number): [number, number, number] | null {
  if (!frame) return null;
  for (let k = 0; k < frame.count; k++) {
    if (frame.index[k] === catIndex) return [frame.positions[k * 3]!, frame.positions[k * 3 + 1]!, frame.positions[k * 3 + 2]!];
  }
  return null;
}

/** Where catalogue row `catIndex` is in the newest frame, or null when it is not drawn there. */
export function latestLngLat(frame: PickFrame | null, catIndex: number): [number, number] | null {
  const p = latestPosition(frame, catIndex);
  return p ? [p[0], p[1]] : null;
}

export interface SatelliteHit {
  k: number;
  catIndex: number;
  lngLat: [number, number];
  altitudeM: number;
  distancePx: number;
}

function hitAt(frame: PickFrame, k: number, d2: number): SatelliteHit {
  return {
    k,
    catIndex: frame.index[k]!,
    lngLat: [frame.positions[k * 3]!, frame.positions[k * 3 + 1]!],
    altitudeM: frame.positions[k * 3 + 2]!,
    distancePx: Math.sqrt(d2),
  };
}

/**
 * Nearest drawn, camera-facing satellite within SAT_HIT_PX of the pointer in the newest frame.
 * Both the ground projection and the elevated one are tested so the hit holds whichever the
 * renderer used. Satellites behind the globe are skipped (not merely ranked lower).
 */
export function nearestSatellite(frame: PickFrame | null, point: { x: number; y: number }, map: ProjectMap, view: PickView): SatelliteHit | null {
  if (!frame || !frame.count) return null;
  const hit = nearestInTable(projectFrame(frame, map, view), frame.count, point);
  return hit ? hitAt(frame, hit.k, hit.d2) : null;
}

/** Number of values in a screen-cache camera key (see `cameraKey`). */
const KEY_LEN = 14;
const NO_CAMERA = Number.NEGATIVE_INFINITY;

/**
 * Everything a frame's projection depends on besides the frame: the map camera (centre, zoom,
 * bearing, pitch, roll), the viewport size, where the globe centre lands on screen (padding or any
 * other offset), the projection and the far-side camera. A getter the map lacks reads NaN in both
 * keys of a comparison (compared with Object.is), so it never invalidates on its own.
 */
function cameraKey(map: ProjectMap, view: PickView, out: Float64Array): void {
  const c = map.getCenter();
  const o = map.project([c.lng, c.lat]);
  const canvas = map.getCanvas?.();
  out[0] = c.lng;
  out[1] = c.lat;
  out[2] = o.x;
  out[3] = o.y;
  out[4] = map.getZoom?.() ?? Number.NaN;
  out[5] = map.getBearing?.() ?? Number.NaN;
  out[6] = map.getPitch?.() ?? Number.NaN;
  out[7] = map.getRoll?.() ?? Number.NaN;
  out[8] = canvas?.clientWidth ?? Number.NaN;
  out[9] = canvas?.clientHeight ?? Number.NaN;
  out[10] = view.globe ? 1 : 0;
  out[11] = view.camera?.lng ?? NO_CAMERA;
  out[12] = view.camera?.lat ?? NO_CAMERA;
  out[13] = view.camera?.altitude ?? NO_CAMERA;
}

function sameKey(a: Float64Array, b: Float64Array): boolean {
  for (let i = 0; i < KEY_LEN; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/**
 * The newest frame's screen table for the current camera, kept until either changes (the next
 * 1 Hz frame, a worker re-filter, or any camera / viewport / projection change). The host hovers
 * only while the camera is still, so a hover between two ticks never projects every satellite.
 */
export class SatelliteScreenCache {
  private frame: PickFrame | null = null;
  private xy: Float32Array | null = null;
  private readonly key = new Float64Array(KEY_LEN);
  private readonly probe = new Float64Array(KEY_LEN);
  /** Full projections of a frame so far (diagnostics and tests). */
  builds = 0;

  /** The screen table for `frame` under the map's current camera (rebuilt only when stale). */
  table(frame: PickFrame, map: ProjectMap, view: PickView): Float32Array {
    cameraKey(map, view, this.probe);
    if (this.frame !== frame || !this.xy || !sameKey(this.key, this.probe)) {
      this.xy = projectFrame(frame, map, view);
      this.frame = frame;
      this.key.set(this.probe);
      this.builds++;
    }
    return this.xy;
  }

  nearest(frame: PickFrame | null, point: { x: number; y: number }, map: ProjectMap, view: PickView): SatelliteHit | null {
    if (!frame || !frame.count) return null;
    const hit = nearestInTable(this.table(frame, map, view), frame.count, point);
    return hit ? hitAt(frame, hit.k, hit.d2) : null;
  }

  /** Drop the table (the layer unmounted). */
  clear(): void {
    this.frame = null;
    this.xy = null;
  }
}

/**
 * Hit-tester body for `registerHitTester`: `toCandidate` turns the hit into a selection. Pass the
 * layer's `SatelliteScreenCache` so repeated hovers reuse one projection of the frame.
 */
export function hitTestSatellites(
  frame: PickFrame | null,
  point: { x: number; y: number },
  map: ProjectMap,
  view: PickView,
  toCandidate: (catIndex: number, lngLat: [number, number]) => Omit<PickCandidate, 'distancePx'> | null,
  cache?: SatelliteScreenCache,
): SatPickCandidate[] {
  const hit = cache ? cache.nearest(frame, point, map, view) : nearestSatellite(frame, point, map, view);
  if (!hit) return [];
  const c = toCandidate(hit.catIndex, hit.lngLat);
  return c ? [{ ...c, distancePx: hit.distancePx, altitudeM: hit.altitudeM }] : [];
}
