import { describe, expect, it } from 'vitest';
import { distanceKm, nmToKm } from '@/lib/geo';
import { COVERAGE_BOXES, TILE_RADIUS_NM, coverageTiles, sweepOrder, tileUrl } from './tiles';

describe('adsb.lol coverage grid', () => {
  const tiles = coverageTiles();

  it('sizes the sweep to adsb.lol limits (60–90 tiles of ≤ 250 nm)', () => {
    expect(tiles.length).toBeGreaterThanOrEqual(60);
    expect(tiles.length).toBeLessThanOrEqual(90);
    expect(TILE_RADIUS_NM).toBeLessThanOrEqual(250);
    expect(new Set(tiles.map((t) => `${t.lat},${t.lon}`)).size).toBe(tiles.length);
  });

  it('leaves no hole inside a coverage box (every interior point is within 250 nm of a centre)', () => {
    const r = nmToKm(TILE_RADIUS_NM) + 1;
    // Interior = at least one tile radius from the box edge (centres outside a box are dropped).
    const inset = TILE_RADIUS_NM / 60;
    for (const [w, s, e, n] of COVERAGE_BOXES) {
      for (let lat = s + inset; lat < n - inset; lat += 1.5) {
        const lonInset = inset / Math.cos((lat * Math.PI) / 180);
        for (let lon = w + lonInset; lon < e - lonInset; lon += 1.5) {
          const near = tiles.some((t) => distanceKm([lon, lat], [t.lon, t.lat]) <= r);
          expect(near, `${lat},${lon}`).toBe(true);
        }
      }
    }
  });

  it('interleaves the order and keeps every tile once', () => {
    const order = sweepOrder(tiles);
    expect(order).toHaveLength(tiles.length);
    expect(new Set(order)).toEqual(new Set(tiles));
    expect(order[1]).not.toBe(tiles[1]);
  });

  it('builds the documented point URL', () => {
    expect(tileUrl({ lat: 51.47, lon: -0.45 })).toBe('https://api.adsb.lol/v2/point/51.47/-0.45/250');
  });
});
