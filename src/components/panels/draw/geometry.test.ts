import { describe, expect, it } from 'vitest';
import { circlePolygon, distanceM, formatArea, formatDistance, measure, parseGeoJson, toFeatureCollection, type DrawFeature } from './geometry';

const ids = (i: number) => `t-${i}`;
const line: DrawFeature = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] }, properties: { id: 'l', shape: 'line', name: 'L' } };
// ~1° × 1° box at the equator.
const box: DrawFeature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, properties: { id: 'p', shape: 'polygon', name: 'P' } };

describe('draw measurements (turf, geodesic)', () => {
  it('measures a line: 1° of longitude at the equator ≈ 111.2 km', () => {
    expect(measure(line).lengthM! / 1000).toBeCloseTo(111.19, 1);
    expect(distanceM([0, 0], [0, 1]) / 1000).toBeCloseTo(111.19, 1);
  });

  it('measures polygon area and perimeter', () => {
    const m = measure(box);
    expect(m.areaM2! / 1e6).toBeGreaterThan(12_300);
    expect(m.areaM2! / 1e6).toBeLessThan(12_400);
    expect(m.perimeterM! / 1000).toBeCloseTo(444.7, 0);
  });

  it('builds circles as 64-segment geodesic polygons with area ≈ πr²', () => {
    const g = circlePolygon([10, 50], 10_000);
    expect(g.coordinates[0]).toHaveLength(65);
    const f: DrawFeature = { type: 'Feature', geometry: g, properties: { id: 'c', shape: 'circle', name: 'C', center: [10, 50], radiusM: 10_000 } };
    const m = measure(f);
    expect(m.radiusM).toBe(10_000);
    expect(m.areaM2! / (Math.PI * 1e8)).toBeCloseTo(1, 2);
  });

  it('formats in the visitor units', () => {
    expect(formatDistance(1500, 'metric')).toBe('1.50 km');
    expect(formatDistance(850, 'metric')).toBe('850 m');
    expect(formatDistance(3704, 'aviation')).toBe('2.00 NM');
    expect(formatDistance(3218.688, 'imperial')).toBe('2.00 mi');
    expect(formatArea(2_500_000, 'metric')).toBe('2.50 km²');
    expect(formatArea(4046.856, 'imperial')).toBe('1.00 ac');
  });
});

describe('GeoJSON round-trip', () => {
  it('exports with measurements and re-imports the same shapes', () => {
    const circle: DrawFeature = { type: 'Feature', geometry: circlePolygon([2, 48], 5000), properties: { id: 'c', shape: 'circle', name: 'Ring', center: [2, 48], radiusM: 5000, aoi: true } };
    const fc = toFeatureCollection([line, box, circle]);
    expect(fc.features[0]!.properties).toMatchObject({ lengthM: expect.any(Number) });
    expect(fc.features[1]!.properties).toMatchObject({ areaM2: expect.any(Number), perimeterM: expect.any(Number) });
    const back = parseGeoJson(JSON.stringify(fc), ids);
    if ('error' in back) throw new Error(back.error);
    expect(back.skipped).toBe(0);
    expect(back.features.map((f) => f.properties.shape)).toEqual(['line', 'polygon', 'circle']);
    expect(back.features[2]!.properties).toMatchObject({ name: 'Ring', center: [2, 48], radiusM: 5000, aoi: true });
    expect(back.features.map((f) => f.geometry)).toEqual([line.geometry, box.geometry, circle.geometry]);
  });

  it('splits multi-geometries, skips invalid/out-of-range ones and never repairs them', () => {
    const doc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[1, 1], [2, 2]] }, properties: { name: 'mp' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [200, 0] }, properties: {} },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0]] }, properties: {} },
        { type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [] }, properties: {} },
        { type: 'Feature', geometry: null, properties: {} },
      ],
    };
    const r = parseGeoJson(JSON.stringify(doc), ids);
    if ('error' in r) throw new Error(r.error);
    expect(r.features).toHaveLength(2);
    expect(r.skipped).toBe(4);
  });

  it('accepts a bare geometry or Feature, rejects junk', () => {
    expect('features' in (parseGeoJson(JSON.stringify({ type: 'Point', coordinates: [1, 2] }), ids) as object)).toBe(true);
    expect(parseGeoJson('not json', ids)).toEqual({ error: 'Not valid JSON' });
    expect(parseGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [] }), ids)).toEqual({ error: 'No features found' });
    expect(parseGeoJson('x'.repeat(6 * 1024 * 1024), ids)).toHaveProperty('error');
  });
});
