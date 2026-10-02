import { describe, expect, it } from 'vitest';
import { FIRE_FIELDS, FeedEvent } from '@/lib/schemas';
import type { Earthquake, WeatherEvent } from '@/lib/types';
import { MAP_TOKENS } from '@/lib/tokens';
import { FIRE_ROW_FIELDS, aqiCategory, fireEvents, fireRadiusPx, fireRowObject, isSignificantQuake, jamLevel, magnitudeRingKm, quakeEvents, quakeRadiusPx, quakeToken, weatherEvents, weatherFootprint, weatherToken, withFootprints } from './shared';

const quake = (over: Partial<Earthquake>): Earthquake => ({
  id: 'us1',
  lat: 1,
  lng: 2,
  observedAt: '2026-09-30T10:00:00.000Z',
  source: 'usgs',
  magnitude: 3,
  magType: 'ml',
  depthKm: 10,
  place: 'Somewhere',
  url: null,
  tsunami: false,
  felt: null,
  alert: null,
  significance: 100,
  ...over,
});

describe('hazards visual scales', () => {
  it('scales rings and points monotonically with caps', () => {
    expect(magnitudeRingKm(2.5)).toBe(20);
    expect(magnitudeRingKm(4.5)).toBe(80);
    expect(magnitudeRingKm(9.5)).toBe(1200);
    expect(quakeRadiusPx(1)).toBe(2.5);
    expect(quakeRadiusPx(9)).toBe(14);
    expect(fireRadiusPx(null)).toBe(1.2);
    expect(fireRadiusPx(3600)).toBe(5);
  });
  it('only uses defined map tokens', () => {
    const tokens = [quakeToken(3), quakeToken(5), quakeToken(7), ...[null, 20, 80, 120, 180, 250, 400].map((v) => aqiCategory(v).token), ...[0.01, 0.05, 0.5].map((r) => jamLevel({ badRatio: r }).token), ...(['volcano', 'wildfire', 'flood', 'other'] as const).map((t) => weatherToken({ type: t }))];
    for (const t of tokens) expect(MAP_TOKENS).toHaveProperty(t);
    expect(aqiCategory(151).label).toBe('UNHEALTHY');
    expect(jamLevel({ badRatio: 0.2 }).label).toBe('HIGH');
  });
});

describe('Intel Feed events', () => {
  it('emits significant quakes only, with ids unique within the layer', () => {
    const items = [quake({ id: 'a', magnitude: 3 }), quake({ id: 'b', magnitude: 6.2 }), quake({ id: 'c', magnitude: 3.1, tsunami: true }), quake({ id: 'd', magnitude: 7.4, alert: 'red' }), quake({ id: 'e', magnitude: 5, observedAt: null })];
    expect(isSignificantQuake(items[0]!)).toBe(false);
    const ev = quakeEvents(items);
    expect(ev.map((e) => e.id)).toEqual(['b', 'c', 'd']);
    expect(ev.map((e) => e.severity)).toEqual(['high', 'medium', 'critical']);
    for (const e of ev) expect(FeedEvent.safeParse(e).success).toBe(true);
  });
  it('emits high-severity weather and intense fires', () => {
    const w = { id: 'w', lat: 0, lng: 0, observedAt: '2026-09-30T10:00:00.000Z', source: 'gdacs', title: 'Red flood', type: 'flood', severity: 'high', provider: 'GDACS', expiresAt: null, area: 'X', url: null, geometry: null } satisfies WeatherEvent;
    const ev = weatherEvents([w, { ...w, id: 'x', severity: 'low' }]);
    expect(ev).toHaveLength(1);
    expect(FeedEvent.safeParse(ev[0]).success).toBe(true);
    const row = fireRowObject(['N20-1', 1, 2, 3200, 400, 'high', 'D', 'NOAA20', 1790720580]);
    expect(row).toMatchObject({ id: 'N20-1', frpMw: 3200, observedAt: new Date(1790720580 * 1000).toISOString(), source: 'firms' });
    const fe = fireEvents([row, { ...row, id: 'weak', frpMw: 10 }]);
    expect(fe).toHaveLength(1);
    expect(fe[0]!.severity).toBe('high');
    expect(FeedEvent.safeParse(fe[0]).success).toBe(true);
  });
});

describe('zod-free fire column order', () => {
  it('FIRE_ROW_FIELDS mirrors the FIRE_FIELDS contract exactly', () => {
    expect([...FIRE_ROW_FIELDS]).toEqual([...FIRE_FIELDS]);
  });
});

describe('GPS-interference fills stay translucent (visual-qa M11)', () => {
  it('keeps elevated classes ≤ .35 and the low class ≤ .12', () => {
    expect(jamLevel({ badRatio: 0.5 }).alpha).toBeLessThanOrEqual(0.35);
    expect(jamLevel({ badRatio: 0.05 }).alpha).toBeLessThanOrEqual(0.35);
    expect(jamLevel({ badRatio: 0.01 }).alpha).toBeLessThanOrEqual(0.12);
  });
});

describe('weather footprints from the shared zone map', () => {
  const sq = (x: number): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
  const zones = { TXZ001: sq(0), TXZ002: { type: 'MultiPolygon', coordinates: [sq(2).coordinates, sq(4).coordinates] } as GeoJSON.MultiPolygon };
  const base: WeatherEvent = { id: 'nws-a', lat: 0.5, lng: 0.5, observedAt: '2026-10-02T00:00:00.000Z', source: 'nws', title: 'Flood Watch', type: 'flood', severity: 'low', provider: 'NOAA/NWS', expiresAt: null, area: null, url: null, geometry: null };

  it('builds the MultiPolygon of every referenced zone (same areas as inline geometry)', () => {
    const g = weatherFootprint({ ...base, zoneRefs: ['TXZ001', 'TXZ002'] }, zones)!;
    expect(g).toEqual({ type: 'MultiPolygon', coordinates: [sq(0).coordinates, sq(2).coordinates, sq(4).coordinates] });
  });
  it('keeps inline geometry (NHC cones, alert polygons, older responses)', () => {
    expect(weatherFootprint({ ...base, geometry: sq(9) }, zones)).toEqual(sq(9));
    expect(weatherFootprint({ ...base, geometry: sq(9), zoneRefs: ['TXZ001'] }, undefined)).toEqual(sq(9));
  });
  it('is null when no reference resolves, and ignores prototype keys', () => {
    expect(weatherFootprint({ ...base, zoneRefs: ['NOPE', 'constructor'] }, zones)).toBeNull();
    expect(weatherFootprint({ ...base, zoneRefs: ['TXZ001'] }, undefined)).toBeNull();
  });
  it('resolves every item and keeps the count', () => {
    const items = [{ ...base, zoneRefs: ['TXZ001'] }, { ...base, id: 'b' }, { ...base, id: 'c', geometry: sq(7) }];
    const out = withFootprints(items, zones);
    expect(out).toHaveLength(3);
    expect(out[0]!.geometry?.type).toBe('MultiPolygon');
    expect(out[1]).toBe(items[1]);
    expect(out[2]).toBe(items[2]);
  });
});
