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
 * 33 ms of CPU per hover frame with 9k drawn satellites). `projectFrame` makes ONE `project()` per
 * drawn satellite (the globe centre is projected once per pass and the elevated point is derived
 * from the ground point) and skips the far-side test when the worker already filtered the frame
 * with the current camera. `SatelliteScreenCache` keeps that table for one (frame, camera) pair,
 * so every further hover or click until the next 1 Hz frame or camera change is a scan over a
 * Float32Array with a single `project()` (the camera key's globe-centre probe).
 * Pure; unit-tested. Owner: layers-space.
 */
import type { HitTestMap, PickCandidate } from '@/lib/map/picking';
import { isFacing, type FarSideCamera } from '@/lib/map/far-side';

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

/**
 * Screen table for one frame and one camera: [elevatedX, elevatedY, groundX, groundY] per row,
 * NaN for a row behind the globe (never hit). One `project()` per facing row plus one for the
 * globe centre. The far-side test runs only when the worker filtered the frame with another
 * camera (`frame.camera`), since a camera-facing frame needs no second test.
 */
export function projectFrame(frame: PickFrame, map: ProjectMap, view: PickView): Float32Array {
  const xy = new Float32Array(frame.count * 4);
  const testFacing = view.globe && !sameCamera(frame.camera, view.camera);
  const origin = view.globe ? globeOrigin(map) : null;
  const pos = frame.positions;
  for (let k = 0; k < frame.count; k++) {
    const o = k * 4;
    if (testFacing && !frameRowFaces(frame, k, view)) {
      xy[o] = xy[o + 1] = xy[o + 2] = xy[o + 3] = Number.NaN;
      continue;
    }
    const altM = pos[k * 3 + 2]!;
    const g = map.project([pos[k * 3]!, pos[k * 3 + 1]!]);
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
