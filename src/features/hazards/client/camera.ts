/**
 * The far-side camera the hazards layers filter (draw) and hit-test (pick) with: the ground point
 * under the MapLibre camera and its height, pitch- and bearing-aware.
 *
 * This is the shared `cameraFromMap()` (src/lib/map/far-side.ts). A MapLibre 6.11 Map has no
 * `transform`, so that helper derives the camera from public API (centre, zoom, pitch, bearing,
 * canvas height) via `pitchedCamera()`; a map that does expose a working transform is read directly.
 * With `depthCompare: 'always'` this filter is the only thing hiding far-side points, so it must
 * follow the real camera on a tilted globe (visual-qa round 5 MAJOR-1). One helper for every
 * module keeps the hazards layers in agreement with the host's data-far-side.
 */
import { cameraFromMap, type CameraMapLike, type FarSideCamera } from '@/lib/map/far-side';

export { pitchedCamera, type CameraMapLike } from '@/lib/map/far-side';

/** The hazards far-side camera of a MapLibre map (see the module comment). */
export function hazardsCamera(map: CameraMapLike): FarSideCamera {
  return cameraFromMap(map);
}
