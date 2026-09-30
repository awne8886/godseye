'use client';
/**
 * Click routing for the hazards layers. One MapLibre `click` listener asks every mounted hazards
 * sub-layer for a hit at the clicked point (screen-space distance via map.project for points,
 * H3 cell lookup for gpsjam, rendered-feature queries for native polygons) and opens the hit
 * whose layer has the highest registry pickPriority (choosePick). Independent of deck's event
 * plumbing, so it behaves the same on the globe and in mercator. Owner: layers-hazards.
 */
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { isFacing } from '@/lib/geo';
import { choosePick, type LayerId } from '@/lib/layer-registry';
import { useMapInstanceStore } from '@/lib/layer-host';

export interface Hit {
  layer: LayerId;
  /** Screen distance in px (0 for area hits); the nearest hit wins within a layer. */
  distancePx: number;
  open: () => void;
}

export type HitTester = (map: MapLibreMap, e: MapMouseEvent) => Hit | null;

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
  e: MapMouseEvent,
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

/** Install the single click router for the hazards module (mounted by HazardsLayer). */
export function useHazardsClickRouter(): void {
  // Clicks only need the loaded map (set on `load`), not the first `idle` that gates adding sources.
  const map = useMapInstanceStore((s) => s.map);
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapMouseEvent) => {
      const hits: Hit[] = [];
      for (const t of TESTERS.values()) {
        try {
          const h = t(map, e);
          if (h) hits.push(h);
        } catch {
          // A layer mid-update is simply not hit this time.
        }
      }
      if (!hits.length) return;
      const top = choosePick(hits);
      if (!top) return;
      const sameLayer = hits.filter((h) => h.layer === top.layer).sort((a, b) => a.distancePx - b.distancePx);
      sameLayer[0]!.open();
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map]);
}
