import { describe, expect, it } from 'vitest';
import { displayAltM } from '../lib/orbit-math';
import { SAT_HIT_PX, elevatedPoint, hitTestSatellites, latestLngLat, nearestSatellite, type PickFrame } from './pick';

// Mercator-like test surface: 10 px per degree, centre (0,0) at screen (500,500).
const map = {
  project: ([lng, lat]: [number, number]) => ({ x: 500 + lng * 10, y: 500 - lat * 10 }),
  getCenter: () => ({ lng: 0, lat: 0 }),
};

function frame(rows: [catIndex: number, lng: number, lat: number, altKm: number][]): PickFrame {
  const positions = new Float32Array(rows.length * 3);
  const index = new Uint32Array(rows.length);
  rows.forEach(([c, lng, lat, alt], k) => {
    positions.set([lng, lat, displayAltM(alt)], k * 3);
    index[k] = c;
  });
  return { count: rows.length, positions, index };
}

describe('satellite picking uses the latest propagated position', () => {
  // The ISS (catalogue row 7) moved 3° east between two 1 Hz frames (exaggerated for the test).
  const older = frame([[7, 10, 20, 420], [2, -40, 5, 20_200]]);
  const newer = frame([[2, -40.1, 5, 20_200], [7, 13, 20, 420]]);

  it('hits the marker where the newest frame draws it, not where it was', () => {
    const now = map.project([13, 20]);
    const hit = nearestSatellite(newer, now, map, false);
    expect(hit?.catIndex).toBe(7);
    expect(hit?.lngLat[0]).toBeCloseTo(13);
    // The old screen position is 30 px away from the newest marker: no hit on stale geometry.
    expect(nearestSatellite(newer, map.project([10, 20]), map, false)).toBeNull();
  });

  it('maps a GPU pick from an older frame onto the newest position', () => {
    expect(latestLngLat(newer, 7)).toEqual([13, 20]);
    expect(latestLngLat(newer, 99)).toBeNull();
    expect(latestLngLat(null, 7)).toBeNull();
    expect(latestLngLat(older, 7)).toEqual([10, 20]);
  });

  it('on the globe, tests the elevated (display-altitude) screen point as well as the ground point', () => {
    const f = frame([[4, 30, 0, 20_200]]);
    const e = elevatedPoint(map, 30, 0, displayAltM(20_200), true);
    const g = map.project([30, 0]);
    expect(e.x).toBeGreaterThan(g.x + SAT_HIT_PX); // clearly off the ground point
    expect(nearestSatellite(f, e, map, true)?.catIndex).toBe(4);
    expect(nearestSatellite(f, g, map, true)?.catIndex).toBe(4);
    expect(nearestSatellite(f, e, map, false)).toBeNull(); // mercator: no radial offset
  });

  it('returns one candidate with its pixel distance, or none', () => {
    const c = hitTestSatellites(newer, { x: 632, y: 300 }, map, false, (catIndex, lngLat) => ({
      layer: 'satellites',
      selection: { kind: 'satellite', id: String(catIndex), layer: 'satellites', source: 'celestrak', observedAt: null, data: {}, lngLat },
    }));
    expect(c).toHaveLength(1);
    expect(c[0]!.selection.lngLat).toEqual([13, 20]);
    expect(c[0]!.distancePx).toBeCloseTo(2, 5);
    expect(hitTestSatellites(null, { x: 0, y: 0 }, map, false, () => null)).toEqual([]);
  });
});
