import { describe, expect, it } from 'vitest';
import type { LngLatTuple } from '@/lib/geo';
import j80 from '../__fixtures__/faa-adds-ats-route-J80.json';
import quota from '../__fixtures__/faa-adds-429-in-200.json';
import { airwaysNear, arcgisErrorCode, mergeAirwayFeatures, simplifyLine, usParts } from './airways';

type Features = Parameters<typeof mergeAirwayFeatures>[0];
const features = j80.body.features as unknown as Features;

describe('FAA ADDS airways snapshot', () => {
  it('reads a 429 inside an HTTP 200 as a quota error', () => {
    expect(arcgisErrorCode(quota.body)).toBe(429);
    expect(arcgisErrorCode(j80.body)).toBeNull();
  });

  it('merges the recorded J80 segments into one simplified airway', () => {
    const merged = mergeAirwayFeatures(features);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.ident).toBe('J80');
    expect(merged[0]!.lines).toHaveLength(features.length);
    const raw = features.reduce((n, f) => n + ((f.geometry?.coordinates as unknown[]) ?? []).length, 0);
    const kept = merged[0]!.lines.reduce((n, l) => n + l.length, 0);
    expect(kept).toBeLessThan(raw);
  });

  it('simplification keeps both ends and drops collinear points', () => {
    const line: LngLatTuple[] = [[0, 0], [1, 0.001], [2, 0], [3, 1]];
    expect(simplifyLine(line, 0.01)).toEqual([[0, 0], [2, 0], [3, 1]]);
  });
});

describe('airways near a route', () => {
  const file = { airways: mergeAirwayFeatures(features) };
  const line = file.airways[0]!.lines[0]!;

  it('a path along J80 finds it; a path outside the US finds nothing', () => {
    const near = airwaysNear(file, line);
    expect(near.map((a) => a.ident)).toEqual(['J80']);
    expect(near[0]!.overlapKm).toBeGreaterThan(0);
    expect(airwaysNear(file, [[2, 48], [10, 50]])).toEqual([]);
  });

  it('only the US part of the route counts (unwrapped longitudes are wrapped first)', () => {
    expect(usParts([[-0.46, 51.47], [-30, 55], [-70, 42], [-73.78, 40.64]]).length).toBe(1);
    const shifted: LngLatTuple[] = line.map(([x, y]) => [x + 360, y]);
    expect(airwaysNear(file, shifted).map((a) => a.ident)).toEqual(['J80']);
  });

  it('a path 200 km north of the (east-west) airway misses the 50 km buffer', () => {
    const away: LngLatTuple[] = line.map(([x, y]) => [x, y + 1.8]);
    expect(airwaysNear(file, away)).toEqual([]);
  });

  it('returns only the airway lines inside the corridor', () => {
    const near = airwaysNear({ airways: mergeAirwayFeatures(features) }, line);
    const g = near[0]!.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    expect(lines.length).toBeLessThan(features.length);
  });
});
