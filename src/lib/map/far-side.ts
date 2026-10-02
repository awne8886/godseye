/**
 * Far-side filter for billboard layers on the globe (§3). deck.gl billboards behind the globe
 * still draw and still pick, so point layers drop (or dim) entities beyond the camera's horizon.
 * The horizon is the cap of angular radius acos(R / (R + h)) around the point under the camera
 * (h = camera altitude); an entity at altitude a adds its own acos(R / (R + a)), so satellites
 * rise over the limb before surface points do.
 *
 * The host publishes the camera on every `move` (no React render); modules read it inside deck
 * accessors or filters with `isFacing(p, getFarSideCamera())`. In mercator the camera is null and
 * everything faces the viewer. The camera is pitch- and bearing-aware (`cameraFromMap` derives it
 * from public map API; MapLibre 6.11 has no `map.transform`). Owner: map-engine. Pure and unit-tested.
 */
import { centralAngle, destination, normalizeLng, type LngLatTuple } from '@/lib/geo';

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
  getCameraLngLat?: () => { lng: number; lat: number } | undefined;
  getCameraAltitude?: () => unknown;
}

/** The public MapLibre Map API `cameraFromMap` reads (a `maplibregl.Map` satisfies it). */
export interface CameraMapLike {
  /** Not on a MapLibre 6.11 Map; read first only when a map exposes a working one. */
  transform?: unknown;
  getCenter: () => { lng: number; lat: number };
  getZoom: () => number;
  getPitch?: () => number;
  getBearing?: () => number;
  getCanvas?: () => { clientHeight: number };
}

/**
 * Ground point and altitude of the MapLibre camera, pitch- and bearing-aware. A MapLibre 6.11 Map
 * has no `transform`, so the camera is derived from public API (centre, zoom, pitch, bearing,
 * viewport height) by `pitchedCamera()`.
 */
export function cameraFromMap(map: CameraMapLike): FarSideCamera {
  const tr = map.transform as TransformLike | undefined;
  const ll = typeof tr?.getCameraLngLat === 'function' ? tr.getCameraLngLat() : undefined;
  const alt = typeof tr?.getCameraAltitude === 'function' ? tr.getCameraAltitude() : undefined;
  if (ll && typeof alt === 'number' && Number.isFinite(alt)) return { lng: normalizeLng(ll.lng), lat: ll.lat, altitude: Math.max(0, alt) };
  return pitchedCamera(map.getCenter(), map.getZoom(), map.getPitch?.() ?? 0, map.getBearing?.() ?? 0, map.getCanvas?.().clientHeight ?? 800);
}

/**
 * Camera ground point + altitude from centre, zoom, pitch (deg), bearing (deg) and viewport height.
 * MapLibre's default 36.87° vertical FOV puts the camera 1.5 × viewport height px from the centre.
 * With d that distance in Earth radii and p the pitch, the camera sits (1 + d·cos p) above the
 * Earth's centre along the centre's normal and d·sin p behind it (towards bearing + 180°):
 * altitude = (hypot(1 + d·cos p, d·sin p) − 1)·R, and the ground point under it lies
 * γ = atan2(d·sin p, 1 + d·cos p) from the centre along bearing + 180°. Pure.
 */
export function pitchedCamera(center: { lng: number; lat: number }, zoom: number, pitchDeg: number, bearingDeg: number, viewportHeightPx: number): FarSideCamera {
  const d = altitudeForZoom(center.lat, zoom, viewportHeightPx) / EARTH_RADIUS_M;
  const p = Math.min(89.9, Math.max(0, Number.isFinite(pitchDeg) ? pitchDeg : 0)) / DEG;
  const up = 1 + d * Math.cos(p);
  const back = d * Math.sin(p);
  const altitude = Math.max(0, (Math.hypot(up, back) - 1) * EARTH_RADIUS_M);
  const gamma = Math.atan2(back, up);
  if (!(gamma > 1e-9)) return { lng: normalizeLng(center.lng), lat: center.lat, altitude };
  const bearing = Number.isFinite(bearingDeg) ? bearingDeg : 0;
  const [lng, lat] = destination([center.lng, center.lat], bearing + 180, (gamma * EARTH_RADIUS_M) / 1000);
  return { lng: normalizeLng(lng), lat, altitude };
}

/**
 * Camera altitude implied by a zoom level with MapLibre's default 36.87° vertical FOV
 * (camera-to-centre distance = 1.5 × viewport height in pixels).
 */
export function altitudeForZoom(lat: number, zoom: number, viewportHeightPx: number): number {
  const mpp = (2 * Math.PI * EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  return 1.5 * viewportHeightPx * mpp;
}
