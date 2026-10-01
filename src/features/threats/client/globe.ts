'use client';
/**
 * Point markers on the globe for the threats, network and maritime layers (visual-qa round 5
 * MAJOR-1). Flat ScatterplotLayers depth-tested against the globe surface were half-clipped or
 * vanished (malware circles at z5–z9, ports, outages). They now draw with `depthCompare: 'always'`
 * (and `cullMode: 'none'`, see CLAUDE.md), which also means the globe no longer hides the far side:
 * every point layer therefore draws — and so picks — only the points on the camera-facing
 * hemisphere (`isFacing()` from src/lib/map/far-side.ts), refiltered at most every
 * CAMERA_REFILTER_MS while the camera moves and once when it settles. In mercator everything faces.
 * A refilter that leaves the same points visible returns the previous array, so deck rebuilds
 * nothing. Owner: layers-threats-network.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { LngLatTuple } from '@/lib/geo';
import { useMapInstanceStore } from '@/lib/layer-host';
import { cameraFromMap, getFarSideCamera, isFacing, type FarSideCamera } from '@/lib/map/far-side';

/** GPU state for every flat point layer of these modules on the globe. */
export const GLOBE_POINT_PARAMETERS = { cullMode: 'none', depthCompare: 'always' } as const;

/** Camera-driven refilters while the map moves are at least this far apart (≤ 10 Hz, as aviation). */
export const CAMERA_REFILTER_MS = 100;

// Last visibility mask per input array: an unchanged mask returns the same output array.
const lastFacing = new WeakMap<object, { mask: Uint8Array; out: readonly unknown[] }>();

function sameMask(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The items on the camera-facing side of the globe (all of them for `camera: null`, i.e. mercator).
 * Pure apart from the identity cache: the same input array and the same visible set return the
 * previous output array.
 */
export function facingSubset<T extends object>(items: readonly T[], pos: (t: T) => LngLatTuple, camera: FarSideCamera | null): readonly T[] {
  if (!camera) return items;
  const mask = new Uint8Array(items.length);
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    if (isFacing(pos(items[i]!), camera)) {
      mask[i] = 1;
      n++;
    }
  }
  const prev = lastFacing.get(items);
  if (prev && sameMask(prev.mask, mask)) return prev.out as readonly T[];
  const out = n === items.length ? items : items.filter((_, i) => mask[i] === 1);
  lastFacing.set(items, { mask, out });
  return out;
}

type MapLike = NonNullable<ReturnType<typeof useMapInstanceStore.getState>['map']>;

/** A version counter bumped (throttled) while `map` moves and once when it settles. */
function cameraVersions(map: MapLike | null) {
  let version = 0;
  return {
    subscribe(onChange: () => void): () => void {
      if (!map) return () => {};
      let pending: ReturnType<typeof setTimeout> | undefined;
      let last = 0;
      const bump = () => {
        version++;
        last = Date.now();
        onChange();
      };
      const onMove = () => {
        if (pending) return;
        pending = setTimeout(
          () => {
            pending = undefined;
            bump();
          },
          Math.max(0, CAMERA_REFILTER_MS - (Date.now() - last)),
        );
      };
      const onEnd = () => {
        if (pending) clearTimeout(pending);
        pending = undefined;
        bump();
      };
      map.on('move', onMove);
      map.on('moveend', onEnd);
      return () => {
        map.off('move', onMove);
        map.off('moveend', onEnd);
        if (pending) clearTimeout(pending);
      };
    },
    getSnapshot: () => version,
  };
}

const serverVersion = () => 0;

/**
 * The far-side camera (ground point + altitude) for this render, or null in mercator. Re-read from
 * the map at most every CAMERA_REFILTER_MS while it moves, on moveend and on a projection switch.
 */
export function useFacingCamera(): FarSideCamera | null {
  const map = useMapInstanceStore((s) => s.map);
  const projection = useMapInstanceStore((s) => s.projection);
  const source = useMemo(() => cameraVersions(map), [map]);
  const version = useSyncExternalStore(source.subscribe, source.getSnapshot, serverVersion);
  return useMemo(() => {
    void version; // a new camera after every (throttled) move
    if (projection !== 'globe') return null;
    return map ? cameraFromMap(map) : getFarSideCamera();
  }, [map, projection, version]);
}

/** `items` filtered to the camera-facing hemisphere (null while there is no data). `pos` must be stable. */
export function useFacing<T extends object>(items: readonly T[] | null | undefined, pos: (t: T) => LngLatTuple): readonly T[] | null {
  const camera = useFacingCamera();
  return useMemo(() => (items ? facingSubset(items, pos, camera) : null), [items, pos, camera]);
}

/** Position accessor for records with `lng`/`lat` (stable, for useFacing and deck getPosition). */
export const lngLatOf = (t: { lng: number; lat: number }): LngLatTuple => [t.lng, t.lat];
