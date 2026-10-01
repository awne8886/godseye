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
}

/** How the frame is projected: globe (with the far-side camera) or mercator. */
export interface PickView {
  globe: boolean;
  /** The far-side camera (`getFarSideCamera()`); null in mercator or before the host published it. */
  camera: FarSideCamera | null;
}

/** A satellite candidate carries the height its marker is drawn at (a far-side test must lift it by it). */
export type SatPickCandidate = PickCandidate & { altitudeM: number };

export const SAT_HIT_PX = 10;
const EARTH_RADIUS_M = 6_371_008.8;

/** Screen position of a marker drawn `altM` above the globe (radial scaling from the globe centre). */
export function elevatedPoint(map: Pick<HitTestMap, 'project' | 'getCenter'>, lng: number, lat: number, altM: number, globe: boolean): { x: number; y: number } {
  const g = map.project([lng, lat]);
  if (!globe || altM <= 0) return g;
  const c = map.getCenter();
  const o = map.project([c.lng, c.lat]);
  const k = 1 + altM / EARTH_RADIUS_M;
  return { x: o.x + (g.x - o.x) * k, y: o.y + (g.y - o.y) * k };
}

/** True when the marker at row `k` of `frame` is on the camera-facing side (always in mercator). */
export function frameRowFaces(frame: PickFrame, k: number, view: PickView): boolean {
  if (!view.globe) return true;
  return isFacing([frame.positions[k * 3]!, frame.positions[k * 3 + 1]!], view.camera, frame.positions[k * 3 + 2]!);
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

/**
 * Nearest drawn, camera-facing satellite within SAT_HIT_PX of the pointer in the newest frame.
 * Both the ground projection and the elevated one are tested so the hit holds whichever the
 * renderer used. Satellites behind the globe are skipped (not merely ranked lower).
 */
export function nearestSatellite(
  frame: PickFrame | null,
  point: { x: number; y: number },
  map: Pick<HitTestMap, 'project' | 'getCenter'>,
  view: PickView,
): { k: number; catIndex: number; lngLat: [number, number]; altitudeM: number; distancePx: number } | null {
  if (!frame || !frame.count) return null;
  let best = -1;
  let bestD = SAT_HIT_PX * SAT_HIT_PX;
  for (let k = 0; k < frame.count; k++) {
    if (!frameRowFaces(frame, k, view)) continue;
    const lng = frame.positions[k * 3]!;
    const lat = frame.positions[k * 3 + 1]!;
    const altM = frame.positions[k * 3 + 2]!;
    const e = elevatedPoint(map, lng, lat, altM, view.globe);
    let d = (e.x - point.x) ** 2 + (e.y - point.y) ** 2;
    if (view.globe) {
      const g = map.project([lng, lat]);
      d = Math.min(d, (g.x - point.x) ** 2 + (g.y - point.y) ** 2);
    }
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  if (best < 0) return null;
  return {
    k: best,
    catIndex: frame.index[best]!,
    lngLat: [frame.positions[best * 3]!, frame.positions[best * 3 + 1]!],
    altitudeM: frame.positions[best * 3 + 2]!,
    distancePx: Math.sqrt(bestD),
  };
}

/** Hit-tester body for `registerHitTester`: `toCandidate` turns the hit into a selection. */
export function hitTestSatellites(
  frame: PickFrame | null,
  point: { x: number; y: number },
  map: Pick<HitTestMap, 'project' | 'getCenter'>,
  view: PickView,
  toCandidate: (catIndex: number, lngLat: [number, number]) => Omit<PickCandidate, 'distancePx'> | null,
): SatPickCandidate[] {
  const hit = nearestSatellite(frame, point, map, view);
  if (!hit) return [];
  const c = toCandidate(hit.catIndex, hit.lngLat);
  return c ? [{ ...c, distancePx: hit.distancePx, altitudeM: hit.altitudeM }] : [];
}
