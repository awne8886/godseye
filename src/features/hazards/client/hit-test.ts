'use client';
/**
 * CPU hit-testing for the hazards layers. Every mounted hazards sub-layer registers a tester
 * (screen-space distance via map.project for points, H3 cell lookup for gpsjam, rendered-feature
 * queries for native polygons); one module-level hit-tester registered with the map's click router
 * (src/lib/map/picking.ts) returns their hits as pick candidates. The map host arbitrates across
 * every module (registry pickPriority, then distance) and opens exactly one card per click.
 * Independent of deck's event plumbing, so it behaves the same on the globe and in mercator.
 * Owner: layers-hazards.
 */
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { isFacing } from '@/lib/geo';
import type { LayerId } from '@/lib/layer-registry';
import type { Selection } from '@/lib/layer-host';
import { registerHitTester, type HitTestMap, type PickCandidate } from '@/lib/map/picking';

export interface Hit {
  layer: LayerId;
  /** Screen distance in px (0 for area hits); the nearest hit wins within a layer. */
  distancePx: number;
  selection: Selection;
}

/** The pointer: screen point and its geographic position. */
export type HitEvent = Pick<MapMouseEvent, 'point' | 'lngLat'>;

export type HitTester = (map: MapLibreMap, e: HitEvent) => Hit | null;

const TESTERS = new Map<string, HitTester>();

/** Register this sub-layer's hit tester while mounted (latest closure is always used). */
export function useHitTester(key: string, tester: HitTester): void {
  const ref = useRef(tester);
  useEffect(() => {
    ref.current = tester;
  });
  useEffect(() => {
    TESTERS.set(key, (m, e) => ref.current(m, e));
    return () => {
      TESTERS.delete(key);
    };
  }, [key]);
}

/** Nearest point within `tolerancePx` of the click, skipping points on the far side of the globe. */
export function nearestPoint<T>(
  map: MapLibreMap,
  e: HitEvent,
  items: readonly T[],
  pos: (t: T) => [number, number],
  radiusPx: (t: T) => number,
  slackPx = 4,
): { item: T; distancePx: number } | null {
  const c = map.getCenter();
  const center: [number, number] = [c.lng, c.lat];
  const globe = map.getProjection?.()?.type === 'globe';
  // Cheap pre-filter in degrees around the click (generous: the projection is not linear on a globe).
  const degPerPx = 360 / (512 * 2 ** map.getZoom());
  const lat0 = e.lngLat.lat;
  const lng0 = e.lngLat.lng;
  let best: { item: T; distancePx: number } | null = null;
  for (const it of items) {
    const p = pos(it);
    const r = radiusPx(it) + slackPx;
    const window = (r + 8) * degPerPx * 3;
    if (Math.abs(p[1] - lat0) > window) continue;
    const dLng = Math.abs(((p[0] - lng0 + 540) % 360) - 180);
    if (dLng > window / Math.max(0.05, Math.cos((lat0 * Math.PI) / 180))) continue;
    if (globe && !isFacing(center, p)) continue;
    const s = map.project(p);
    const d = Math.hypot(s.x - e.point.x, s.y - e.point.y);
    if (d <= r && (!best || d < best.distancePx)) best = { item: it, distancePx: d };
  }
  return best;
}

/** Every mounted hazards tester's hit at `point`, as pick candidates (a tester mid-update misses). */
export function hazardsCandidates(map: MapLibreMap, point: { x: number; y: number }): PickCandidate[] {
  const e = { point, lngLat: map.unproject([point.x, point.y]) } as HitEvent;
  const out: PickCandidate[] = [];
  for (const t of TESTERS.values()) {
    try {
      const h = t(map, e);
      if (h) out.push({ layer: h.layer, selection: h.selection, distancePx: h.distancePx });
    } catch {
      // A layer mid-update is simply not hit this time.
    }
  }
  return out;
}

/** Register the hazards module with the map's single click/hover router (mounted by HazardsLayer). */
export function useHazardsHitTesting(): void {
  useEffect(() => registerHitTester('hazards', (point, map: HitTestMap) => hazardsCandidates(map as unknown as MapLibreMap, point)), []);
}
