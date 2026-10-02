/**
 * Camera points on the globe (round 5, visual-qa MAJOR-1): the flat ScatterplotLayer draws with
 * `depthCompare: 'always'` so the globe surface never half-clips a disc, which makes this far-side
 * filter the ONLY thing hiding cameras behind the limb — from drawing and from picking (deck picks
 * only what it draws; the pick handler re-checks `isFacing`). Same test as `isFacing()` in
 * src/lib/map/far-side.ts for a point on the surface (altitude 0): visible when its central angle
 * from the point under the camera is within the camera's horizon acos(R / (R + h)). Done with
 * unit vectors computed once per catalogue, so a refilter is one dot product per camera.
 * `camera: null` (mercator) keeps every row. Pure; owner: layers-surveillance.
 */
import type { Cell } from '@/lib/columnar';
import { horizonAngleDeg, type FarSideCamera } from '@/lib/map/far-side';

/** Globe-safe parameters for flat camera points (CLAUDE.md globe deck rules). */
export const CCTV_POINT_PARAMETERS = { cullMode: 'none', depthCompare: 'always' } as const;

const D2R = Math.PI / 180;

/** Unit vectors (x, y, z per row) of each row's [lng, lat] at the given column indices. */
export function unitVectors(rows: readonly (readonly Cell[])[], lngIdx: number, latIdx: number): Float64Array {
  const out = new Float64Array(rows.length * 3);
  for (let i = 0; i < rows.length; i++) {
    const lng = Number(rows[i]![lngIdx]) * D2R;
    const lat = Number(rows[i]![latIdx]) * D2R;
    const c = Math.cos(lat);
    out[i * 3] = c * Math.cos(lng);
    out[i * 3 + 1] = c * Math.sin(lng);
    out[i * 3 + 2] = Math.sin(lat);
  }
  return out;
}

/**
 * The rows on the camera-facing side of the globe, in their original order. Returns `rows` itself
 * in mercator (`camera: null`) and `prev` when the selection did not change (so deck keeps its
 * attributes and React does not re-render); otherwise a new array.
 */
export function facingRows<T>(rows: readonly T[], units: Float64Array, camera: FarSideCamera | null, prev: readonly T[] | null = null): readonly T[] {
  if (!camera) return rows;
  const lat = camera.lat * D2R;
  const lng = camera.lng * D2R;
  const c = Math.cos(lat);
  const cx = c * Math.cos(lng);
  const cy = c * Math.sin(lng);
  const cz = Math.sin(lat);
  const minDot = Math.cos(horizonAngleDeg(camera.altitude) * D2R);
  const out: T[] = [];
  let same = prev !== null;
  for (let i = 0; i < rows.length; i++) {
    if (units[i * 3]! * cx + units[i * 3 + 1]! * cy + units[i * 3 + 2]! * cz < minDot) continue;
    if (same && prev![out.length] !== rows[i]) same = false;
    out.push(rows[i]!);
  }
  return same && prev!.length === out.length ? prev! : out;
}
