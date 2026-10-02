import { describe, expect, it } from 'vitest';
import { distanceKm, pointInPolygon, type LngLatTuple } from './geo';
import { darknessRegion, solarElevation, subsolarPoint, terminatorBands, twilightAt } from './solar';

const inside = (p: LngLatTuple, g: GeoJSON.Polygon | GeoJSON.MultiPolygon) => pointInPolygon(p, g);

describe('solar geometry', () => {
  it('declination is ~0 at the March equinox and ~23.44° at the June solstice', () => {
    expect(Math.abs(subsolarPoint(Date.parse('2026-03-20T14:46:00Z')).lat)).toBeLessThan(0.1);
    expect(subsolarPoint(Date.parse('2026-06-21T08:24:00Z')).lat).toBeCloseTo(23.44, 1);
    expect(subsolarPoint(Date.parse('2026-12-21T20:50:00Z')).lat).toBeCloseTo(-23.44, 1);
  });

  it('subsolar longitude tracks UTC with the equation of time', () => {
    const noon = subsolarPoint(Date.parse('2026-11-03T12:00:00Z'));
    // Early November the equation of time is ≈ +16.4 min: solar noon at Greenwich is ≈ 11:44 UTC,
    // so by 12:00 UTC the subsolar point has moved ≈ 4.1° west.
    expect(noon.equationOfTimeMin).toBeGreaterThan(15.5);
    expect(noon.equationOfTimeMin).toBeLessThan(17);
    expect(noon.lng).toBeLessThan(-3.5);
    expect(noon.lng).toBeGreaterThan(-4.7);
    expect(Math.abs(Math.abs(subsolarPoint(Date.parse('2026-04-15T00:00:00Z')).lng) - 180)).toBeLessThan(5);
  });

  it('elevation is 90° at the subsolar point and −90° at the antisolar point', () => {
    const t = Date.parse('2026-09-30T16:00:00Z');
    const s = subsolarPoint(t);
    expect(solarElevation([s.lng, s.lat], t)).toBeCloseTo(90, 5);
    expect(solarElevation([s.lng + 180, -s.lat], t)).toBeCloseTo(-90, 5);
    expect(twilightAt([s.lng, s.lat], t)).toBe('day');
    expect(twilightAt([s.lng + 180, -s.lat], t)).toBe('night');
  });

  it('darkness regions contain the antisolar point, exclude the subsolar point, and nest', () => {
    for (const iso of ['2026-06-21T12:00:00Z', '2026-09-23T06:00:00Z', '2026-12-21T00:00:00Z', '2026-03-20T18:00:00Z']) {
      const t = Date.parse(iso);
      const s = subsolarPoint(t);
      const anti: LngLatTuple = [((s.lng + 360) % 360) - 180, -s.lat];
      const bands = terminatorBands(t, 2).features;
      expect(bands.map((b) => b.properties.band)).toEqual(['civil', 'nautical', 'astronomical', 'night']);
      for (const b of bands) {
        expect(inside(anti, b.geometry), `${iso} ${b.properties.band} antisolar`).toBe(true);
        expect(inside([s.lng, s.lat], b.geometry), `${iso} ${b.properties.band} subsolar`).toBe(false);
      }
    }
  });

  it('closes over the dark pole in solstice seasons and stays within ±180°', () => {
    const t = Date.parse('2026-06-21T12:00:00Z'); // north pole in daylight, south pole dark
    const g = darknessRegion(t, 0) as GeoJSON.Polygon;
    expect(g.type).toBe('Polygon');
    const ring = g.coordinates[0]!;
    expect(ring.some(([, lat]) => lat === -90)).toBe(true);
    for (const [lng] of ring) expect(Math.abs(lng!)).toBeLessThanOrEqual(180);
    expect(inside([0, -89], g)).toBe(true);
    expect(inside([0, 89], g)).toBe(false);
  });

  it('matches the analytic boundary: points just inside/outside the civil line', () => {
    const t = Date.parse('2026-09-30T16:00:00Z');
    const g = darknessRegion(t, -6, 0.5);
    let checked = 0;
    for (let lat = -60; lat <= 60; lat += 15) {
      for (let lng = -180; lng < 180; lng += 15) {
        const h = solarElevation([lng, lat], t);
        if (Math.abs(h + 6) < 1.5) continue; // skip points near the line (sampling tolerance)
        expect(inside([lng, lat], g), `${lng},${lat} h=${h.toFixed(1)}`).toBe(h < -6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(distanceKm([0, 0], [0, 1])).toBeGreaterThan(110);
  });
});
