'use client';
/**
 * Globe-safe drawing for the hazards point layers (visual-qa round 5 MAJOR-1). The quake, fire,
 * wildfire-event, weather and air-quality ScatterplotLayers (and the GPS-interference H3 cells,
 * which z-fought the globe mesh into hatched hexes) were depth-tested against MapLibre's globe:
 * markers came out as half-discs, broken rings or not at all, while mercator drew full discs.
 *
 * The fix is the one aviation uses (src/features/aviation/client/layers.ts ICON_PARAMETERS):
 *  - `GLOBE_POINT_PARAMETERS`: no face culling (MapLibre leaves it on after the globe pass) and
 *    `depthCompare: 'always'`, so the globe surface never clips a marker;
 *  - with the depth test gone, the far-side filter is the ONLY thing hiding points behind the
 *    limb, so every layer draws (and therefore deck-picks) only the camera-facing subset:
 *    `facingIndices()` is `isFacing()` from src/lib/map/far-side.ts for surface points
 *    (central angle from the camera ground point ≤ acos(R / (R + h_cam))), as a dot product over
 *    unit vectors computed once per snapshot;
 *  - the camera is re-read at most every CAMERA_REFILTER_MS while the map moves and once more when
 *    it settles (same cadence as aviation); mercator has no far side (camera null, all drawn).
 * CPU hit-testing (hit-test.ts) applies the same camera test, so nothing behind the globe is ever
 * drawn, hovered or opened. Owner: layers-hazards.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMapInstanceStore } from '@/lib/layer-host';
import { horizonAngleDeg, type FarSideCamera } from '@/lib/map/far-side';
import { hazardsCamera } from './camera';

/** GPU state for every hazards deck layer on the globe (and harmless in mercator). */
export const GLOBE_POINT_PARAMETERS = { cullMode: 'none', depthCompare: 'always' } as const;

/** Refilter cadence while the camera moves (ms); a settled camera is always read at once. */
export const CAMERA_REFILTER_MS = 100;

const D2R = Math.PI / 180;

/** Anything with a surface position (every hazards entity: quakes, events, AQ points, H3 cells). */
export interface LngLatItem {
  lng: number;
  lat: number;
}

/** Unit vectors (x, y, z per point) of `n` surface positions; computed once per snapshot. */
export function unitVectors(n: number, lngAt: (i: number) => number, latAt: (i: number) => number): Float64Array {
  const u = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const φ = latAt(i) * D2R;
    const λ = lngAt(i) * D2R;
    const c = Math.cos(φ);
    u[i * 3] = c * Math.cos(λ);
    u[i * 3 + 1] = c * Math.sin(λ);
    u[i * 3 + 2] = Math.sin(φ);
  }
  return u;
}

/**
 * Indices of the surface points on the camera-facing side of the globe, in data order (so the
 * draw order of a sorted layer is kept). `camera: null` (mercator, or no map yet) → null, meaning
 * "all points". A point with a non-finite position never faces (its dot product is NaN).
 */
export function facingIndices(units: Float64Array, camera: FarSideCamera | null): Uint32Array | null {
  if (!camera) return null;
  const n = Math.floor(units.length / 3);
  const cφ = Math.cos(camera.lat * D2R);
  const cx = cφ * Math.cos(camera.lng * D2R);
  const cy = cφ * Math.sin(camera.lng * D2R);
  const cz = Math.sin(camera.lat * D2R);
  const minDot = Math.cos(horizonAngleDeg(camera.altitude) * D2R);
  const out = new Uint32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (units[i * 3]! * cx + units[i * 3 + 1]! * cy + units[i * 3 + 2]! * cz >= minDot) out[k++] = i;
  }
  return out.slice(0, k);
}

/** `items` at `idx` (all of them when `idx` is null). */
export function pickIndices<T>(items: readonly T[], idx: Uint32Array | null): readonly T[] {
  if (!idx) return items;
  const out = new Array<T>(idx.length);
  for (let k = 0; k < idx.length; k++) out[k] = items[idx[k]!]!;
  return out;
}

const sameCamera = (a: FarSideCamera | null, b: FarSideCamera): boolean => !!a && a.lng === b.lng && a.lat === b.lat && a.altitude === b.altitude;

/**
 * The camera for the far-side filter: null in mercator; on the globe, read from the map when the
 * component renders (so the first frame is already filtered) and re-read at most every
 * CAMERA_REFILTER_MS while the map moves and once when it settles. A camera that did not change
 * keeps its identity, so memoised subsets (and the deck layers built from them) are not rebuilt.
 */
export function useFarSideCamera(): FarSideCamera | null {
  const map = useMapInstanceStore((s) => s.map);
  const globe = useMapInstanceStore((s) => s.projection === 'globe');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!map || !globe) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    let seen: FarSideCamera | null = null;
    const read = () => {
      last = Date.now();
      const next = hazardsCamera(map);
      if (sameCamera(seen, next)) return;
      seen = next;
      setTick((t) => t + 1);
    };
    const onMove = () => {
      if (pending) return;
      pending = setTimeout(
        () => {
          pending = undefined;
          read();
        },
        Math.max(0, CAMERA_REFILTER_MS - (Date.now() - last)),
      );
    };
    const onEnd = () => {
      if (pending) clearTimeout(pending);
      pending = undefined;
      read();
    };
    // The camera may have moved between the render and this subscription.
    read();
    map.on('move', onMove);
    map.on('moveend', onEnd);
    return () => {
      map.off('move', onMove);
      map.off('moveend', onEnd);
      if (pending) clearTimeout(pending);
    };
  }, [map, globe]);
  // `tick` is the camera version: a new value only after a camera event saw a different camera.
  return useMemo(() => (tick >= 0 && globe && map ? hazardsCamera(map) : null), [tick, globe, map]);
}

/** Memoised camera-facing subset of `items` (unit vectors once per snapshot, a dot product per camera). */
export function useFacing<T extends LngLatItem>(items: readonly T[] | undefined, camera: FarSideCamera | null): readonly T[] | undefined {
  const units = useMemo(() => (items ? unitVectors(items.length, (i) => items[i]!.lng, (i) => items[i]!.lat) : null), [items]);
  return useMemo(() => (items && units ? pickIndices(items, facingIndices(units, camera)) : items), [items, units, camera]);
}

/** `lng,lat,altitude` of the camera a subset was filtered with ('' in mercator), for e2e checks. */
export function cameraAttr(camera: FarSideCamera | null): string {
  return camera ? `${camera.lng.toFixed(3)},${camera.lat.toFixed(3)},${Math.round(camera.altitude)}` : '';
}

/**
 * Hidden diagnostics for tests and QA (never announced, never visible): how many of the layer's
 * entities are drawn after the far-side filter, of how many received, and with which camera.
 */
export function DrawnStatus({ layer, drawn, total, camera }: { layer: string; drawn: number; total: number; camera: FarSideCamera | null }) {
  return <span hidden data-testid={`hazards-drawn-${layer}`} data-drawn={drawn} data-total={total} data-camera={cameraAttr(camera)} />;
}
