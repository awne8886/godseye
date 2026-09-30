/**
 * Far-side filter for billboard layers on the globe (§3). deck.gl billboards behind the globe
 * still draw and still pick, so point layers drop (or dim) entities beyond the camera's horizon.
 * The horizon is the cap of angular radius acos(R / (R + h)) around the point under the camera
 * (h = camera altitude); an entity at altitude a adds its own acos(R / (R + a)), so satellites
 * rise over the limb before surface points do.
 *
 * The host publishes the camera on every `move` (no React render); modules read it inside deck
 * accessors or filters with `isFacing(p, getFarSideCamera())`. In mercator the camera is null and
 * everything faces the viewer. Owner: map-engine. Pure and unit-tested.
 */
import { centralAngle, normalizeLng, type LngLatTuple } from '@/lib/geo';

export const EARTH_RADIUS_M = 6_371_008.8;
const DEG = 180 / Math.PI;

export interface FarSideCamera {
  /** Point on the ground directly under the camera. */
  lng: number;
  lat: number;
  /** Camera height above the surface, metres. */
  altitude: number;
}

/** Angular radius (degrees) of the horizon seen from `altitudeM` above a spherical Earth. */
export function horizonAngleDeg(altitudeM: number): number {
  if (!(altitudeM > 0)) return 0;
  if (!Number.isFinite(altitudeM)) return 90;
  return Math.acos(EARTH_RADIUS_M / (EARTH_RADIUS_M + altitudeM)) * DEG;
}

type LngLatLike = LngLatTuple | { lng: number; lat: number };

/**
 * True when `p` is on the camera-facing side of the globe. `camera: null` (mercator, or the host
 * has not published yet) always faces. `pointAltitudeM` lifts the point (aircraft, satellites).
 */
export function isFacing(p: LngLatLike, camera: FarSideCamera | null, pointAltitudeM = 0): boolean {
  if (!camera) return true;
  const [lng, lat] = Array.isArray(p) ? p : [p.lng, p.lat];
  const d = centralAngle([normalizeLng(camera.lng), camera.lat], [normalizeLng(lng), lat]) * DEG;
  return d <= horizonAngleDeg(camera.altitude) + horizonAngleDeg(pointAltitudeM);
}

let current: FarSideCamera | null = null;

/** Called by the map host on `move` (globe) and with null in mercator. */
export function setFarSideCamera(c: FarSideCamera | null): void {
  current = c;
}

export function getFarSideCamera(): FarSideCamera | null {
  return current;
}

interface TransformLike {
  getCameraLngLat?: () => { lng: number; lat: number };
  getCameraAltitude?: () => number;
}

/** Ground point and altitude of the MapLibre camera (reads the transform; pitch-aware). */
export function cameraFromMap(map: { transform?: unknown; getCenter: () => { lng: number; lat: number }; getZoom: () => number; getCanvas?: () => { clientHeight: number } }): FarSideCamera {
  const tr = map.transform as TransformLike | undefined;
  const ll = tr?.getCameraLngLat?.();
  const alt = tr?.getCameraAltitude?.();
  if (ll && typeof alt === 'number' && Number.isFinite(alt)) return { lng: normalizeLng(ll.lng), lat: ll.lat, altitude: Math.max(0, alt) };
  const c = map.getCenter();
  return { lng: normalizeLng(c.lng), lat: c.lat, altitude: altitudeForZoom(c.lat, map.getZoom(), map.getCanvas?.().clientHeight ?? 800) };
}

/**
 * Camera altitude implied by a zoom level with MapLibre's default 36.87° vertical FOV
 * (camera-to-centre distance = 1.5 × viewport height in pixels).
 */
export function altitudeForZoom(lat: number, zoom: number, viewportHeightPx: number): number {
  const mpp = (2 * Math.PI * EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  return 1.5 * viewportHeightPx * mpp;
}
