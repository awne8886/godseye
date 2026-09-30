/**
 * Satellite picking against the LATEST propagated frame. Satellites move every tick, and the
 * deck layer draws them from binary attributes (no `info.object`), so a click resolves through:
 *  - `hitTestSatellites`: a CPU hit-test on the newest frame's positions, projected at the same
 *    compressed display altitude the markers are drawn at (works where GPU picking does not);
 *  - `latestLngLat`: the GPU pick's catalogue index mapped onto the newest frame, so the card
 *    opens where the marker is now, not where it was when the picking buffer was drawn.
 * Pure; unit-tested. Owner: layers-space.
 */
import type { HitTestMap, PickCandidate } from '@/lib/map/picking';

export interface PickFrame {
  count: number;
  /** [lng, lat, displayAltitudeMetres] × count. */
  positions: Float32Array;
  /** Catalogue index × count. */
  index: Uint32Array;
}

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

/** Where catalogue row `catIndex` is in the newest frame, or null when it is not drawn there. */
export function latestLngLat(frame: PickFrame | null, catIndex: number): [number, number] | null {
  if (!frame) return null;
  for (let k = 0; k < frame.count; k++) {
    if (frame.index[k] === catIndex) return [frame.positions[k * 3]!, frame.positions[k * 3 + 1]!];
  }
  return null;
}

/**
 * Nearest drawn satellite within SAT_HIT_PX of the pointer in the newest frame. Both the ground
 * projection and the elevated one are tested so the hit holds whichever the renderer used.
 */
export function nearestSatellite(
  frame: PickFrame | null,
  point: { x: number; y: number },
  map: Pick<HitTestMap, 'project' | 'getCenter'>,
  globe: boolean,
): { k: number; catIndex: number; lngLat: [number, number]; distancePx: number } | null {
  if (!frame || !frame.count) return null;
  let best = -1;
  let bestD = SAT_HIT_PX * SAT_HIT_PX;
  for (let k = 0; k < frame.count; k++) {
    const lng = frame.positions[k * 3]!;
    const lat = frame.positions[k * 3 + 1]!;
    const altM = frame.positions[k * 3 + 2]!;
    const e = elevatedPoint(map, lng, lat, altM, globe);
    let d = (e.x - point.x) ** 2 + (e.y - point.y) ** 2;
    if (globe) {
      const g = map.project([lng, lat]);
      d = Math.min(d, (g.x - point.x) ** 2 + (g.y - point.y) ** 2);
    }
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  if (best < 0) return null;
  return { k: best, catIndex: frame.index[best]!, lngLat: [frame.positions[best * 3]!, frame.positions[best * 3 + 1]!], distancePx: Math.sqrt(bestD) };
}

/** Hit-tester body for `registerHitTester`: `toCandidate` turns the hit into a selection. */
export function hitTestSatellites(
  frame: PickFrame | null,
  point: { x: number; y: number },
  map: Pick<HitTestMap, 'project' | 'getCenter'>,
  globe: boolean,
  toCandidate: (catIndex: number, lngLat: [number, number]) => Omit<PickCandidate, 'distancePx'> | null,
): PickCandidate[] {
  const hit = nearestSatellite(frame, point, map, globe);
  if (!hit) return [];
  const c = toCandidate(hit.catIndex, hit.lngLat);
  return c ? [{ ...c, distancePx: hit.distancePx }] : [];
}

