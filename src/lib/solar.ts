/**
 * Sun position and day/night geometry for the terminator layer and the route daylight samples.
 * Subsolar point from the Astronomical Almanac low-precision formulae (≈0.01° declination,
 * includes the equation of time — OSIRIS's formula did not). Darkness regions for civil (−6°),
 * nautical (−12°) and astronomical (−18°) twilight are spherical caps around the antisolar point,
 * emitted as GeoJSON that closes correctly over the poles and splits at the antimeridian.
 * Pure and isomorphic; the geometry worker calls terminatorBands() every 60 s. Owner: lead.
 */
import { centralAngle, destination, type LngLatTuple, normalizeLng } from './geo';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface SunPosition {
  /** Subsolar latitude = solar declination (degrees). */
  lat: number;
  /** Subsolar longitude (degrees, [-180, 180)). */
  lng: number;
  /** Equation of time in minutes (apparent − mean solar time). */
  equationOfTimeMin: number;
}

export function subsolarPoint(at: Date | number): SunPosition {
  const ms = typeof at === 'number' ? at : at.getTime();
  const d = ms / 86_400_000 - 10_957.5; // days since J2000.0 (2000-01-01T12:00Z)
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * DEG;
  const decl = Math.asin(Math.sin(e) * Math.sin(L)) * DEG;
  const gmstHours = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const eq = ((((q - ra) % 360) + 540) % 360) - 180; // degrees
  return { lat: decl, lng: normalizeLng(ra - gmstHours * 15), equationOfTimeMin: eq * 4 };
}

/** Solar elevation angle (degrees) at a point, ignoring refraction. */
export function solarElevation(p: LngLatTuple, at: Date | number): number {
  const s = subsolarPoint(at);
  return 90 - centralAngle(p, [s.lng, s.lat]) * DEG;
}

export type Twilight = 'day' | 'civil' | 'nautical' | 'astronomical' | 'night';

export function twilightAt(p: LngLatTuple, at: Date | number): Twilight {
  const h = solarElevation(p, at);
  if (h >= 0) return 'day';
  if (h >= -6) return 'civil';
  if (h >= -12) return 'nautical';
  if (h >= -18) return 'astronomical';
  return 'night';
}

/** Twilight thresholds (sun elevation, degrees) and their band names. */
export const TWILIGHT_BANDS = [
  { band: 'civil', elevation: 0 },
  { band: 'nautical', elevation: -6 },
  { band: 'astronomical', elevation: -12 },
  { band: 'night', elevation: -18 },
] as const;

/**
 * The region where the sun's elevation is below `elevationDeg` (≤ 0): a spherical cap around
 * the antisolar point with angular radius 90° + elevationDeg.
 */
export function darknessRegion(at: Date | number, elevationDeg: number, stepDeg = 1): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  const s = subsolarPoint(at);
  const anti: LngLatTuple = [normalizeLng(s.lng + 180), -s.lat];
  const r = 90 + elevationDeg; // degrees
  const poleLat = anti[1] >= 0 ? 90 : -90;
  const containsPole = Math.abs(anti[1]) + r >= 90 - 1e-9;

  if (containsPole) {
    // Each meridian leaves a convex cap exactly once: bisect from the pole outwards.
    const inside = (p: LngLatTuple) => centralAngle(anti, p) * DEG <= r;
    const ring: LngLatTuple[] = [];
    for (let lng = -180; lng <= 180 + 1e-9; lng += stepDeg) {
      let lo = poleLat; // inside
      let hi = -poleLat; // outside
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (inside([lng, mid])) lo = mid;
        else hi = mid;
      }
      ring.push([lng, (lo + hi) / 2]);
    }
    ring.push([180, poleLat], [-180, poleLat], ring[0]!);
    return { type: 'Polygon', coordinates: [ring] };
  }

  // Cap away from the poles: trace it, then split at the antimeridian if it crosses.
  const steps = Math.round(360 / stepDeg);
  const ring: LngLatTuple[] = [];
  let prev: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const [rawLng, lat] = destination(anti, (360 * i) / steps, r * RAD * 6371.0088);
    let lng = rawLng;
    if (prev !== null) {
      while (lng - prev > 180) lng -= 360;
      while (lng - prev < -180) lng += 360;
    }
    ring.push([lng, lat]);
    prev = lng;
  }
  ring[ring.length - 1] = ring[0]!;
  const minX = Math.min(...ring.map((p) => p[0]));
  const maxX = Math.max(...ring.map((p) => p[0]));
  if (minX >= -180 && maxX <= 180) return { type: 'Polygon', coordinates: [ring] };
  const edge = maxX > 180 ? 180 : -180;
  const shift = edge > 0 ? -360 : 360;
  const inRange = clipRing(ring, edge, edge > 0 ? 'le' : 'ge');
  const wrapped = clipRing(ring, edge, edge > 0 ? 'ge' : 'le').map(([x, y]) => [x + shift, y] as LngLatTuple);
  const polys = [inRange, wrapped].filter((p) => p.length >= 4).map((p) => [p]);
  return { type: 'MultiPolygon', coordinates: polys };
}

/** Sutherland–Hodgman clip of a closed ring against the half-plane x ≤ edge ('le') or x ≥ edge ('ge'). */
function clipRing(ring: LngLatTuple[], edge: number, keep: 'le' | 'ge'): LngLatTuple[] {
  const inside = (p: LngLatTuple) => (keep === 'le' ? p[0] <= edge : p[0] >= edge);
  const out: LngLatTuple[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (edge - a[0]) / (b[0] - a[0]);
      out.push([edge, a[1] + t * (b[1] - a[1])]);
    }
  }
  if (out.length) out.push(out[0]!);
  return out;
}

/**
 * FeatureCollection of nested darkness regions for the terminator layer: civil (sun < 0°),
 * nautical (< −6°), astronomical (< −12°) and night (< −18°). Stack them as fills with rising
 * opacity; properties.band names each one.
 */
export function terminatorBands(at: Date | number, stepDeg = 1): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { band: string; elevation: number }> {
  return {
    type: 'FeatureCollection',
    features: TWILIGHT_BANDS.map(({ band, elevation }) => ({
      type: 'Feature',
      properties: { band, elevation },
      geometry: darknessRegion(at, elevation, stepDeg),
    })),
  };
}
