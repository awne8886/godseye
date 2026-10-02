'use client';
/**
 * Arrival rings (§7 "pulse rings"): items that were NOT in the previous poll ring outward once from
 * their marker, the way NetworkLayer marks new malware hosts. At most MAX_ARRIVAL_RINGS at a time
 * (the newest observed first), none on the first poll (nothing is "new" then), none while the
 * timeline is replaying, and none under reduced motion. The expansion and fade are deck attribute
 * transitions run on the GPU (the `enter` value is the start), so there is no per-frame JS or React
 * work; the batch is dropped when its transition ends. Globe rules: billboard, depthCompare
 * 'always', cullMode 'none', and only rings on the camera-facing side (isFacing).
 * Owner: design-system-hud.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getFarSideCamera, isFacing, type FarSideCamera } from '@/lib/map/far-side';
import { useUiStore } from '@/lib/store';
import type { Rgba } from '@/lib/tokens';
import { useMediaQuery } from './hooks';

export const MAX_ARRIVAL_RINGS = 3;
export const ARRIVAL_RING_MS = 2400;
/** How far (px) a ring travels outward from the marker's edge. */
export const ARRIVAL_RING_GROW_PX = 26;

export interface ArrivalRing {
  key: string;
  position: [number, number];
  radiusPx: number;
}

/**
 * The items of this poll that were not in the previous one, newest observed first, capped at
 * `limit`. `prevIds` null = first poll: nothing is new.
 */
export function newArrivals<T>(prevIds: ReadonlySet<string> | null, items: readonly T[], idOf: (t: T) => string, observedMs: (t: T) => number | null, limit = MAX_ARRIVAL_RINGS): T[] {
  if (!prevIds || limit <= 0) return [];
  return items
    .filter((t) => !prevIds.has(idOf(t)))
    .sort((a, b) => (observedMs(b) ?? -Infinity) - (observedMs(a) ?? -Infinity))
    .slice(0, limit);
}

/** Settings → motion REDUCED, or SYSTEM with the OS asking for reduced motion. */
export function useReducedMotion(): boolean {
  const pref = useUiStore((s) => s.settings.motion);
  const system = useMediaQuery('(prefers-reduced-motion: reduce)');
  return pref === 'reduced' || (pref === 'system' && system);
}

export interface ArrivalRingOptions<T> {
  id: string;
  /** This poll's items (null/undefined while nothing is held: the previous set is kept). */
  items: readonly T[] | null | undefined;
  idOf: (t: T) => string;
  positionOf: (t: T) => [number, number];
  observedMs: (t: T) => number | null;
  radiusPx: (t: T) => number;
  color: Rgba;
  /** Far-side camera (null in mercator); defaults to the map host's current camera. */
  camera?: FarSideCamera | null;
}

/** The arrival-ring deck layer (always present while enabled, so transitions have a "from"), or null. */
export function useArrivalRings<T>({ id, items, idOf, positionOf, observedMs, radiusPx, color, camera }: ArrivalRingOptions<T>) {
  const reduced = useReducedMotion();
  const replaying = useUiStore((s) => s.timeCursor !== null);
  const enabled = !reduced && !replaying;
  const prev = useRef<ReadonlySet<string> | null>(null);
  const [rings, setRings] = useState<readonly ArrivalRing[]>([]);
  const fns = useRef({ idOf, positionOf, observedMs, radiusPx });
  useEffect(() => {
    fns.current = { idOf, positionOf, observedMs, radiusPx };
  });

  useEffect(() => {
    if (!items) return;
    const f = fns.current;
    const fresh = newArrivals(prev.current, items, f.idOf, f.observedMs);
    prev.current = new Set(items.map(f.idOf));
    if (!enabled || !fresh.length) return;
    setRings((cur) => {
      const room = MAX_ARRIVAL_RINGS - cur.length;
      if (room <= 0) return cur;
      const seen = new Set(cur.map((r) => r.key));
      const add = fresh.filter((t) => !seen.has(f.idOf(t))).slice(0, room);
      return add.length ? [...cur, ...add.map((t) => ({ key: f.idOf(t), position: f.positionOf(t), radiusPx: f.radiusPx(t) }))] : cur;
    });
  }, [items, enabled]);

  // The whole batch goes when its transition is over (appending only, so instances never shift).
  useEffect(() => {
    if (!rings.length) return;
    const t = setTimeout(() => setRings([]), ARRIVAL_RING_MS + 200);
    return () => clearTimeout(t);
  }, [rings]);

  const facing = useMemo(() => {
    const cam = camera === undefined ? getFarSideCamera() : camera;
    return rings.filter((r) => isFacing(r.position, cam));
  }, [rings, camera]);

  const [r, g, b, a] = color;
  return useMemo(() => {
    if (!enabled) return null;
    return new ScatterplotLayer<ArrivalRing>({
      id,
      data: facing,
      getPosition: (d) => d.position,
      // Final state: grown and transparent; `enter` starts each new ring at the marker, opaque.
      getRadius: (d) => d.radiusPx + ARRIVAL_RING_GROW_PX,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineColor: [r, g, b, 0],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      billboard: true,
      antialiasing: true,
      parameters: { cullMode: 'none', depthCompare: 'always' },
      pickable: false,
      transitions: {
        getRadius: { duration: ARRIVAL_RING_MS, enter: (to: number[]) => [Math.max(1, (to[0] ?? 0) - ARRIVAL_RING_GROW_PX)] },
        getLineColor: { duration: ARRIVAL_RING_MS, enter: () => [r, g, b, a] },
      },
      updateTriggers: { getLineColor: [r, g, b] },
    });
  }, [enabled, id, facing, r, g, b, a]);
}
