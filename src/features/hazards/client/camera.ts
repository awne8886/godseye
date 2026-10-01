/**
 * The far-side camera the hazards layers filter (draw) and hit-test (pick) with: the ground point
 * under the MapLibre camera and its height, pitch- and bearing-aware, from public map API only.
 *
 * Why not `cameraFromMap()` (src/lib/map/far-side.ts) directly: it reads `map.transform`, which a
 * MapLibre 6.11 Map does not have, so it always falls back to the map centre and an unpitched
 * altitude. That is right at pitch 0 only; on a tilted globe (RIGHT-DRAG TO TILT, pitch ≤ 85) the
 * hazards layers then drew points from behind the limb and hid visible ones (visual-qa round 5
 * MAJOR-1: pitch 60 drew 1,380 occluded fires and hid 532 visible). With `depthCompare: 'always'`
 * this filter is the only thing hiding far-side points, so it must follow the real camera.
 *
 * Geometry (MapLibre's default 36.87° vertical FOV: camera-to-centre distance = 1.5 × viewport
 * height in pixels): with d the camera-to-centre distance in Earth radii and p the pitch, the camera
 * sits (1 + d·cos p) above the Earth's centre along the centre's normal and d·sin p behind it
 * (towards bearing + 180°). Its altitude is (hypot(1 + d·cos p, d·sin p) − 1)·R and the ground point
 * under it is γ = atan2(d·sin p, 1 + d·cos p) from the centre along bearing + 180°. Matches
 * MapLibre's `getCameraLngLat()`/`getCameraAltitude()` to within 0.1° and 0.05 % (round-5 probe).
 * A map that does expose a working transform (a future MapLibre, or the lead's fixed helper) is
 * read through `cameraFromMap()` first.
 */
import { destination, normalizeLng } from '@/lib/geo';
import { cameraFromMap, EARTH_RADIUS_M, type FarSideCamera } from '@/lib/map/far-side';

const RAD = Math.PI / 180;

/** The subset of the MapLibre Map this module reads (all public API). */
export interface CameraMapLike {
  transform?: unknown;
  getCenter: () => { lng: number; lat: number };
  getZoom: () => number;
  getPitch?: () => number;
  getBearing?: () => number;
  getCanvas?: () => { clientHeight: number };
}

interface TransformLike {
  getCameraLngLat?: () => unknown;
  getCameraAltitude?: () => unknown;
}

function hasCameraTransform(map: CameraMapLike): boolean {
  const tr = map.transform as TransformLike | undefined;
  return typeof tr?.getCameraLngLat === 'function' && typeof tr.getCameraAltitude === 'function';
}

/**
 * Camera ground point + altitude from centre, zoom, pitch, bearing and the viewport height. Pure,
 * shared with the e2e spec's independent check (it re-derives the same numbers from data-camera).
 */
export function pitchedCamera(center: { lng: number; lat: number }, zoom: number, pitchDeg: number, bearingDeg: number, viewportHeightPx: number): FarSideCamera {
  const pxPerRadian = (512 * 2 ** zoom) / (2 * Math.PI * Math.max(1e-6, Math.cos(center.lat * RAD)));
  const d = (1.5 * viewportHeightPx) / pxPerRadian;
  const p = Math.min(89.9, Math.max(0, pitchDeg || 0)) * RAD;
  const up = 1 + d * Math.cos(p);
  const back = d * Math.sin(p);
  const altitude = Math.max(0, (Math.hypot(up, back) - 1) * EARTH_RADIUS_M);
  const gamma = Math.atan2(back, up);
  if (gamma < 1e-9) return { lng: normalizeLng(center.lng), lat: center.lat, altitude };
  const [lng, lat] = destination([center.lng, center.lat], (bearingDeg || 0) + 180, (gamma * EARTH_RADIUS_M) / 1000);
  return { lng, lat, altitude };
}

/** The hazards far-side camera of a MapLibre map (see the module comment). */
export function hazardsCamera(map: CameraMapLike): FarSideCamera {
  const pitch = map.getPitch?.() ?? 0;
  // Untilted, the shared helper's centre fallback is exact (and identical to the host's data-far-side).
  if (hasCameraTransform(map) || !(pitch > 0.01)) return cameraFromMap(map);
  const c = map.getCenter();
  return pitchedCamera({ lng: normalizeLng(c.lng), lat: c.lat }, map.getZoom(), pitch, map.getBearing?.() ?? 0, map.getCanvas?.().clientHeight ?? 800);
}
