/**
 * Sprite gaps in the OpenFreeMap style, filled in code so the console stays clean (§11): the
 * `circle-11` place marker is drawn here as a signed-distance-field dot that the style tints
 * gold through `icon-color`. Owner: map-engine. Pure and unit-tested.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';

export interface RawImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Images the basemap references but its sprite does not ship. */
export const MISSING_SPRITE_IMAGES = ['circle-11'] as const;

/**
 * An SDF disc: alpha encodes distance to the edge (MapLibre reads 0.75 → edge, higher = inside,
 * 0 = `buffer` px outside), so the icon scales cleanly and takes its colour from `icon-color`.
 */
export function sdfDot(size = 22, buffer = 3): RawImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const c = (size - 1) / 2;
  const radius = c - buffer;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - c, y - c) - radius; // < 0 inside
      // 0 at `buffer` px outside, 0.75 on the edge (MapLibre's SDF cutoff), 1 at `buffer` px inside.
      const v = dist >= 0 ? Math.max(0, 0.75 * (1 - dist / buffer)) : 0.75 + 0.25 * Math.min(1, -dist / buffer);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(v * 255);
    }
  }
  return { width: size, height: size, data };
}

type ResolverMap = Pick<MapLibreMap, 'hasImage' | 'addImage' | 'setMissingStyleImageResolver'>;

/**
 * Resolve the known sprite gaps (`circle-11` → gold SDF dot at pixelRatio 2); any other missing
 * id falls through to MapLibre's `styleimagemissing` event untouched.
 */
export function installMissingImageResolver(map: ResolverMap): void {
  map.setMissingStyleImageResolver((id) => {
    if (id !== 'circle-11' || map.hasImage(id)) return;
    map.addImage(id, sdfDot(), { sdf: true, pixelRatio: 2 });
  });
}
