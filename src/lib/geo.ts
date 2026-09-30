/**
 * Spherical geometry shared by the map, the Flight Path Planner and server routes. Pure,
 * isomorphic, unit-tested. Coordinates are `[lng, lat]` (GeoJSON order) unless named otherwise.
 * Mean Earth radius 6371.0088 km (IUGG). Owner: lead.
 */

export const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_NM = 1.852;
export type LngLatTuple = [number, number];

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Wrap longitude into [-180, 180). */
export function normalizeLng(lng: number): number {
  const x = ((((lng + 180) % 360) + 360) % 360) - 180;
  return x === -180 && lng > 0 ? 180 : x;
}

/** Central angle between two points in radians (haversine, numerically stable). */
export function centralAngle([lng1, lat1]: LngLatTuple, [lng2, lat2]: LngLatTuple): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function distanceKm(a: LngLatTuple, b: LngLatTuple): number {
  return centralAngle(a, b) * EARTH_RADIUS_KM;
}

export const kmToNm = (km: number) => km / KM_PER_NM;
export const nmToKm = (nm: number) => nm * KM_PER_NM;

/** Initial true bearing from a to b in degrees [0, 360). */
export function initialBearing([lng1, lat1]: LngLatTuple, [lng2, lat2]: LngLatTuple): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Final bearing on arrival at b (reverse initial bearing + 180°). */
export function finalBearing(a: LngLatTuple, b: LngLatTuple): number {
  return (initialBearing(b, a) + 180) % 360;
}

/** Point at fraction f ∈ [0,1] along the great circle a→b (spherical slerp). */
export function interpolate(a: LngLatTuple, b: LngLatTuple, f: number): LngLatTuple {
  const δ = centralAngle(a, b);
  if (δ === 0) return [a[0], a[1]];
  const [λ1, φ1] = [toRad(a[0]), toRad(a[1])];
  const [λ2, φ2] = [toRad(b[0]), toRad(b[1])];
  const A = Math.sin((1 - f) * δ) / Math.sin(δ);
  const B = Math.sin(f * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))];
}

export function midpoint(a: LngLatTuple, b: LngLatTuple): LngLatTuple {
  return interpolate(a, b, 0.5);
}

/**
 * `n` points (n ≥ 2) along the great circle with longitudes UNWRAPPED (consecutive points never
 * jump by > 180°), so the line is continuous in Mercator and on the globe. May exceed ±180.
 */
export function greatCirclePoints(a: LngLatTuple, b: LngLatTuple, n = 128): LngLatTuple[] {
  const count = Math.max(2, Math.floor(n));
  const pts: LngLatTuple[] = [];
  let prevLng: number | null = null;
  for (let i = 0; i < count; i++) {
    const [lng, lat] = interpolate(a, b, i / (count - 1));
    let x = lng;
    if (prevLng !== null) {
      while (x - prevLng > 180) x -= 360;
      while (x - prevLng < -180) x += 360;
    }
    pts.push([x, lat]);
    prevLng = x;
  }
  return pts;
}

/** Number of times a (possibly unwrapped) polyline crosses the ±180° meridian. */
export function antimeridianCrossings(points: LngLatTuple[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) {
    const a = Math.floor((points[i - 1]![0] + 180) / 360);
    const b = Math.floor((points[i]![0] + 180) / 360);
    n += Math.abs(b - a);
  }
  return n;
}

/**
 * Split an unwrapped polyline into segments within [-180, 180], interpolating the exact
 * crossing latitude (for GeoJSON MultiLineString export).
 */
export function splitAtAntimeridian(points: LngLatTuple[]): LngLatTuple[][] {
  if (!points.length) return [];
  const band = (lng: number) => Math.floor((lng + 180) / 360);
  const out: LngLatTuple[][] = [];
  let k = band(points[0]![0]);
  let seg: LngLatTuple[] = [[points[0]![0] - k * 360, points[0]![1]]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const p = points[i]!;
    const kp = band(p[0]);
    if (kp !== k) {
      const east = kp > k;
      const edge = k * 360 + (east ? 180 : -180);
      const t = (edge - prev[0]) / (p[0] - prev[0]);
      const lat = prev[1] + t * (p[1] - prev[1]);
      seg.push([east ? 180 : -180, lat]);
      out.push(seg);
      seg = [[east ? -180 : 180, lat]];
      k = kp;
    }
    seg.push([p[0] - k * 360, p[1]]);
  }
  out.push(seg);
  return out.filter((s) => s.length >= 2);
}

/** Destination from `start` after `distKm` on initial bearing `bearingDeg`. */
export function destination([lng, lat]: LngLatTuple, bearingDeg: number, distKm: number): LngLatTuple {
  const δ = distKm / EARTH_RADIUS_KM;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [normalizeLng(toDeg(λ2)), toDeg(φ2)];
}

/** Signed cross-track distance (km) of p from the great circle a→b (+ right of track). */
export function crossTrackKm(p: LngLatTuple, a: LngLatTuple, b: LngLatTuple): number {
  const δ13 = centralAngle(a, p);
  const θ13 = toRad(initialBearing(a, p));
  const θ12 = toRad(initialBearing(a, b));
  return Math.asin(Math.sin(δ13) * Math.sin(θ13 - θ12)) * EARTH_RADIUS_KM;
}

/** Along-track distance (km) from a to the closest point to p on the great circle a→b. */
export function alongTrackKm(p: LngLatTuple, a: LngLatTuple, b: LngLatTuple): number {
  const δ13 = centralAngle(a, p);
  const δxt = crossTrackKm(p, a, b) / EARTH_RADIUS_KM;
  const cos = Math.cos(δ13) / Math.cos(δxt);
  const along = Math.acos(Math.max(-1, Math.min(1, cos))) * EARTH_RADIUS_KM;
  // Behind the start when the bearing to p points away from b.
  const diff = Math.abs(((initialBearing(a, p) - initialBearing(a, b) + 540) % 360) - 180);
  return diff > 90 ? -along : along;
}

/**
 * True when p is on the camera-facing hemisphere of a globe centred at `center`
 * (great-circle distance ≤ maxDeg). deck.gl billboards behind the globe still draw and pick,
 * so point layers filter or dim with this (§3 far-side filter).
 */
export function isFacing(center: LngLatTuple, p: LngLatTuple, maxDeg = 90): boolean {
  return toDeg(centralAngle(center, p)) <= maxDeg;
}

/** Geodesic circle polygon ring (closed), for large radii that must follow the globe. */
export function geodesicCircle(center: LngLatTuple, radiusKm: number, steps = 64): LngLatTuple[] {
  const ring: LngLatTuple[] = [];
  let prev: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const [lng, lat] = destination(center, (360 * i) / steps, radiusKm);
    let x = lng;
    if (prev !== null) {
      while (x - prev > 180) x -= 360;
      while (x - prev < -180) x += 360;
    }
    ring.push([x, lat]);
    prev = x;
  }
  ring[ring.length - 1] = [ring[0]![0], ring[0]![1]];
  return ring;
}

/** Ray-casting point-in-polygon for a ring in the same longitude frame. */
export function pointInRing([x, y]: LngLatTuple, ring: LngLatTuple[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(p: LngLatTuple, polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  const polys = polygon.type === 'Polygon' ? [polygon.coordinates] : polygon.coordinates;
  return polys.some((rings) => {
    const [outer, ...holes] = rings as LngLatTuple[][];
    return !!outer && pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h));
  });
}

/** [west, south, east, north] of a set of points (no antimeridian handling). */
export function bbox(points: LngLatTuple[]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of points) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** Parse `west,south,east,north`; returns null when malformed or out of range. */
export function parseBBox(v: string | null | undefined): [number, number, number, number] | null {
  if (!v) return null;
  const p = v.split(',').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = p as [number, number, number, number];
  if (Math.abs(w) > 180 || Math.abs(e) > 180 || s < -90 || n > 90 || s > n) return null;
  return [w, s, e, n];
}

/** True if (lng, lat) lies in bbox, handling boxes that cross the antimeridian (west > east). */
export function inBBox([lng, lat]: LngLatTuple, [w, s, e, n]: [number, number, number, number]): boolean {
  if (lat < s || lat > n) return false;
  return w <= e ? lng >= w && lng <= e : lng >= w || lng <= e;
}
