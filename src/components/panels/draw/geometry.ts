/**
 * DRAW geometry: geodesic measurements with turf, circles as geodesic polygons, GeoJSON
 * import/export with validation and caps, and unit formatting. Pure (no DOM), unit-tested.
 * Owner: panels-recon.
 */
import { area as turfArea, circle as turfCircle, length as turfLength, bbox as turfBbox, centroid as turfCentroid } from '@turf/turf';

export type DrawShape = 'point' | 'line' | 'polygon' | 'circle';
export type Units = 'metric' | 'imperial' | 'aviation';

export interface DrawProps {
  id: string;
  shape: DrawShape;
  name: string;
  /** Circle centre [lng, lat] and radius (m) — the geometry is the geodesic polygon. */
  center?: [number, number];
  radiusM?: number;
  aoi?: boolean;
}

export type DrawFeature = GeoJSON.Feature<GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon, DrawProps>;

export interface Measurement {
  lengthM: number | null;
  areaM2: number | null;
  perimeterM: number | null;
  radiusM: number | null;
}

export function measure(f: DrawFeature): Measurement {
  const g = f.geometry;
  if (g.type === 'Point') return { lengthM: null, areaM2: null, perimeterM: null, radiusM: null };
  if (g.type === 'LineString') return { lengthM: turfLength(f, { units: 'kilometers' }) * 1000, areaM2: null, perimeterM: null, radiusM: null };
  const ring: GeoJSON.Feature<GeoJSON.LineString> = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: g.coordinates[0] ?? [] } };
  return {
    lengthM: null,
    areaM2: turfArea(f),
    perimeterM: turfLength(ring, { units: 'kilometers' }) * 1000,
    radiusM: f.properties.shape === 'circle' ? (f.properties.radiusM ?? null) : null,
  };
}

/** Geodesic circle (64 segments) — never a screen-space disc on the globe. */
export function circlePolygon(center: [number, number], radiusM: number, steps = 64): GeoJSON.Polygon {
  return turfCircle(center, radiusM / 1000, { steps, units: 'kilometers' }).geometry;
}

/** Great-circle distance in metres between two [lng, lat] points. */
export function distanceM(a: [number, number], b: [number, number]): number {
  return turfLength({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [a, b] } }, { units: 'kilometers' }) * 1000;
}

export function featureBbox(f: GeoJSON.Feature | GeoJSON.FeatureCollection): [number, number, number, number] {
  return turfBbox(f) as [number, number, number, number];
}

export function featureCentre(f: GeoJSON.Feature): [number, number] {
  return turfCentroid(f).geometry.coordinates as [number, number];
}

export function formatDistance(m: number, units: Units): string {
  if (units === 'metric') return m >= 1000 ? `${(m / 1000).toFixed(m >= 100_000 ? 0 : 2)} km` : `${Math.round(m)} m`;
  if (units === 'imperial') return m >= 1609.344 ? `${(m / 1609.344).toFixed(2)} mi` : `${Math.round(m / 0.3048)} ft`;
  return m >= 1852 ? `${(m / 1852).toFixed(2)} NM` : `${Math.round(m / 0.3048)} ft`;
}

export function formatArea(m2: number, units: Units): string {
  if (units === 'metric') return m2 >= 1e6 ? `${(m2 / 1e6).toFixed(m2 >= 1e8 ? 0 : 2)} km²` : `${Math.round(m2).toLocaleString('en-US')} m²`;
  if (units === 'imperial') return m2 >= 2_589_988 ? `${(m2 / 2_589_988.11).toFixed(2)} mi²` : `${(m2 / 4046.856).toFixed(2)} ac`;
  return `${(m2 / 3_429_904).toFixed(2)} NM²`;
}

// ── GeoJSON import / export ─────────────────────────────────────────────────────
export const MAX_IMPORT_FEATURES = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const isPos = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

function validGeometry(g: unknown): g is GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon {
  const x = g as { type?: string; coordinates?: unknown };
  if (x?.type === 'Point') return isPos(x.coordinates);
  if (x?.type === 'LineString') return Array.isArray(x.coordinates) && x.coordinates.length >= 2 && x.coordinates.every(isPos);
  if (x?.type === 'Polygon') return Array.isArray(x.coordinates) && x.coordinates.length >= 1 && x.coordinates.every((r) => Array.isArray(r) && r.length >= 4 && r.every(isPos));
  return false;
}

function explode(g: { type?: string; coordinates?: unknown }): { type: string; coordinates: unknown }[] {
  if (g?.type === 'MultiPoint') return (g.coordinates as unknown[]).map((c) => ({ type: 'Point', coordinates: c }));
  if (g?.type === 'MultiLineString') return (g.coordinates as unknown[]).map((c) => ({ type: 'LineString', coordinates: c }));
  if (g?.type === 'MultiPolygon') return (g.coordinates as unknown[]).map((c) => ({ type: 'Polygon', coordinates: c }));
  return [g as { type: string; coordinates: unknown }];
}

const SHAPE: Record<string, DrawShape> = { Point: 'point', LineString: 'line', Polygon: 'polygon' };

/**
 * Parse user GeoJSON (FeatureCollection, Feature or bare geometry). Multi-geometries are split;
 * invalid or out-of-range geometries are counted as skipped, never "repaired" into new shapes.
 */
export function parseGeoJson(text: string, makeId: (i: number) => string): { features: DrawFeature[]; skipped: number } | { error: string } {
  if (text.length > MAX_IMPORT_BYTES) return { error: `File is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB` };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { error: 'Not valid JSON' };
  }
  const d = doc as { type?: string; features?: unknown[]; geometry?: unknown; properties?: Record<string, unknown> };
  const raw: { geometry: unknown; properties: Record<string, unknown> }[] =
    d?.type === 'FeatureCollection' && Array.isArray(d.features)
      ? d.features.map((f) => ({ geometry: (f as { geometry?: unknown })?.geometry, properties: (f as { properties?: Record<string, unknown> })?.properties ?? {} }))
      : d?.type === 'Feature'
        ? [{ geometry: d.geometry, properties: d.properties ?? {} }]
        : [{ geometry: d, properties: {} }];
  const features: DrawFeature[] = [];
  let skipped = 0;
  for (const r of raw) {
    for (const g of explode((r.geometry ?? {}) as { type?: string; coordinates?: unknown })) {
      if (features.length >= MAX_IMPORT_FEATURES) {
        skipped++;
        continue;
      }
      if (!validGeometry(g)) {
        skipped++;
        continue;
      }
      const p = r.properties ?? {};
      const isCircle = p.shape === 'circle' && isPos(p.center) && typeof p.radiusM === 'number';
      features.push({
        type: 'Feature',
        geometry: g,
        properties: {
          id: makeId(features.length),
          shape: isCircle ? 'circle' : SHAPE[g.type]!,
          name: typeof p.name === 'string' ? p.name.slice(0, 80) : `${SHAPE[g.type]} ${features.length + 1}`,
          ...(isCircle ? { center: p.center as [number, number], radiusM: p.radiusM as number } : {}),
          ...(p.aoi === true ? { aoi: true } : {}),
        },
      });
    }
  }
  if (!features.length) return { error: skipped ? `No usable Point/LineString/Polygon features (${skipped} skipped)` : 'No features found' };
  return { features, skipped };
}

/** Export drawn features (with measurements in properties) as a FeatureCollection. */
export function toFeatureCollection(features: readonly DrawFeature[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => {
      const m = measure(f);
      return {
        ...f,
        properties: {
          ...f.properties,
          ...(m.lengthM !== null ? { lengthM: Math.round(m.lengthM * 10) / 10 } : {}),
          ...(m.areaM2 !== null ? { areaM2: Math.round(m.areaM2) } : {}),
          ...(m.perimeterM !== null ? { perimeterM: Math.round(m.perimeterM * 10) / 10 } : {}),
        },
      };
    }),
  };
}
