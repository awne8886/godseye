/**
 * Earth-shadow test for satellite dimming: a cylindrical umbra of Earth's radius extending away
 * from the Sun, with the Sun direction taken from the subsolar point (src/lib/solar.ts). Works on
 * geodetic lat/lng/alt so the worker needs no extra frame conversion. Pure. Owner: layers-space.
 *
 * The cylinder ignores the penumbra and oblateness (error < 1 % of an eclipse's duration for LEO),
 * which is right for "dim this dot", not for eclipse timing.
 */
import { subsolarPoint } from '@/lib/solar';

const RAD = Math.PI / 180;
export const SHADOW_EARTH_RADIUS_KM = 6371.0;

export interface SunVector {
  x: number;
  y: number;
  z: number;
}

/** Unit vector (Earth-fixed) towards the Sun at `at`. */
export function sunDirection(at: Date | number): SunVector {
  const s = subsolarPoint(at);
  const lat = s.lat * RAD;
  const lng = s.lng * RAD;
  return { x: Math.cos(lat) * Math.cos(lng), y: Math.cos(lat) * Math.sin(lng), z: Math.sin(lat) };
}

/** True when a point at (lat, lng, altKm) lies inside Earth's cylindrical shadow. */
export function inEarthShadow(latDeg: number, lngDeg: number, altKm: number, sun: SunVector): boolean {
  const r = SHADOW_EARTH_RADIUS_KM + altKm;
  const lat = latDeg * RAD;
  const lng = lngDeg * RAD;
  const x = r * Math.cos(lat) * Math.cos(lng);
  const y = r * Math.cos(lat) * Math.sin(lng);
  const z = r * Math.sin(lat);
  const along = x * sun.x + y * sun.y + z * sun.z;
  if (along >= 0) return false; // sunward half-space is always lit
  const perp2 = r * r - along * along;
  return perp2 < SHADOW_EARTH_RADIUS_KM * SHADOW_EARTH_RADIUS_KM;
}
