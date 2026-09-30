/**
 * Region Dossier nearby adapters (R3-M1 / visual-qa M1, m4). Fixtures: the surveillance LTA
 * traffic-images probe (2026-09-30), the bundled maritime/cables reference files and a recorded
 * FIRMS-shaped row. No network.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedResult } from '@/lib/feeds';
import { CAMERA_FIELDS } from '@/lib/schemas/surveillance';
import { adaptMaritimeReference, adaptVessels, cameraFeedKeys, cablesNear, decodeColumnar, extractPoints, lineDistanceKm, mergeNearby, NEARBY_LAYERS, nearbyFromResult, toPoint } from './nearby';

const live = (data: unknown, state = 'live') => ({ data, meta: { state }, providers: {} }) as unknown as FeedResult<unknown>;
const repo = (p: string) => new URL(`../../../../../${p}`, import.meta.url);

interface Lta {
  items: { cameras: { timestamp: string; camera_id: string; location: { latitude: number; longitude: number } }[] }[];
}
const lta = JSON.parse(readFileSync(repo('src/features/surveillance/server/__fixtures__/lta-traffic-images.2026-09-30.json'), 'utf8')) as Lta;
const cameraRows = lta.items[0]!.cameras.map((c) => [`lta-${c.camera_id}`, c.location.latitude, c.location.longitude, `LTA camera ${c.camera_id}`, 'lta', 'Singapore', 'SG', 'image', null, null, null, c.timestamp, 'lta']);

afterEach(() => vi.unstubAllEnvs());

describe('R3: Region Dossier nearby layers', () => {
  it('a LIVE maritime feed is not reported as offline', () => {
    const r = nearbyFromResult(live({ ports: [{ id: 'port-singapore', lat: 1.26, lng: 103.83, name: 'Singapore' }], chokepoints: [], vessels: [] }), 1.26, 103.83, 150);
    expect(r.state).not.toBe('offline');
    expect(r.count).toBe(1);
  });
  it('cameras read a registered feed key', () => {
    expect(NEARBY_LAYERS.find((l) => l.layer === 'cameras')?.feed).not.toBe('cctv');
  });
  it('cables are aggregated', () => {
    expect(NEARBY_LAYERS.map((l) => l.layer)).toContain('cables');
  });
});

describe('camera catalogue (cctv:* feeds)', () => {
  it('decodes the columnar {fields, rows} shape', () => {
    const objs = decodeColumnar({ fields: [...CAMERA_FIELDS], rows: cameraRows })!;
    expect(objs[0]).toMatchObject({ id: 'lta-2701', lat: 1.447023728, providerId: 'lta' });
    const n = nearbyFromResult(live({ fields: [...CAMERA_FIELDS], rows: cameraRows }), 1.29, 103.85, 150);
    expect(n.count).toBe(cameraRows.length);
    expect(n.points[0]!.observedAt).toMatch(/^2026-09-30T2\d:\d\d:\d\d\.000Z$/);
  });
  it('reads the feed data (an array of Camera objects)', () => {
    const cams = decodeColumnar({ fields: [...CAMERA_FIELDS], rows: cameraRows })!;
    expect(extractPoints(cams)).toHaveLength(cameraRows.length);
    expect(nearbyFromResult(live(cams), 51.5, -0.12, 150)).toMatchObject({ count: 0, state: 'live' });
  });
  it('picks the regions around the point, only among registered feeds', () => {
    const all = ['cctv:asia', 'cctv:uk', 'cctv:europe', 'cctv:nordics', 'flights'];
    expect(cameraFeedKeys(1.29, 103.85, 150, all)).toEqual(['cctv:asia']);
    expect(cameraFeedKeys(51.5, -0.12, 150, all).sort()).toEqual(['cctv:europe', 'cctv:uk']);
    expect(cameraFeedKeys(51.5, -0.12, 150, ['flights'])).toEqual([]);
  });
  it('merges regions: counts add up, a missing region is partial, all pending is pending', () => {
    const a = { count: 2, state: 'live' as const, points: [] };
    const b = { count: 1, state: 'recent' as const, points: [] };
    expect(mergeNearby([a, b])).toMatchObject({ count: 3, state: 'recent' });
    expect(mergeNearby([a, { count: null, state: 'offline', points: [] }])).toMatchObject({ count: 2, reason: 'partial' });
    expect(mergeNearby([{ count: null, state: 'offline', points: [], reason: 'pending' }])).toMatchObject({ count: null, reason: 'pending' });
  });
});

describe('maritime and cables', () => {
  it('ports and chokepoints are REFERENCE; vessels come only from the AIS list', () => {
    const data = { ports: [{ id: 'port-sg', lat: 1.264, lng: 103.84, name: 'Singapore' }], chokepoints: [{ id: 'malacca', lat: 1.43, lng: 102.89, name: 'Strait of Malacca' }], vessels: [] };
    const def = NEARBY_LAYERS.find((l) => l.layer === 'ports')!;
    const r = nearbyFromResult(live(data), 1.29, 103.85, 150, def);
    expect(r).toMatchObject({ count: 2, state: 'reference' });
    expect(r.points.map((p) => p.title)).toEqual(['Port · Singapore', 'Chokepoint · Strait of Malacca']);
    expect(adaptVessels(data)).toEqual([]);
    expect(adaptMaritimeReference({ other: 1 })).toBeNull();
  });
  it('vessels are gated behind the ais capability; cables behind nc_sources', () => {
    expect(NEARBY_LAYERS.find((l) => l.layer === 'vessels')!.gate).toMatchObject({ capability: 'ais', reason: 'not-configured' });
    expect(NEARBY_LAYERS.find((l) => l.layer === 'cables')!.gate).toMatchObject({ capability: 'nc_sources', reason: 'licence' });
  });
  it('counts cables passing within the radius and lists landing points (bundled TeleGeography file)', () => {
    const file = JSON.parse(readFileSync(repo('public/data/cables.json'), 'utf8')) as { cables: { id: string; name: string; lines: number[][][] }[]; landingPoints: { id: string; name: string; lat: number; lng: number }[] };
    const data = { cables: file.cables.map((c) => ({ id: c.id, name: c.name, geometry: { type: 'MultiLineString', coordinates: c.lines } })), landingPoints: file.landingPoints.map((p) => ({ ...p, id: `lp-${p.id}` })) };
    const sg = cablesNear(data, 1.29, 103.85, 150)!;
    expect(sg.count).toBeGreaterThan(5);
    expect(sg.points.some((p) => p.title.startsWith('Landing point'))).toBe(true);
    expect(sg.note).toMatch(/REFERENCE/);
    // Middle of the Sahara: no cable within 150 km.
    expect(cablesNear(data, 23, 13, 150)!.count).toBe(0);
    const r = nearbyFromResult(live(data), 1.29, 103.85, 150, NEARBY_LAYERS.find((l) => l.layer === 'cables')!);
    expect(r.state).toBe('reference');
  });
  it('measures distance to a segment, not only to its vertices', () => {
    const d = lineDistanceKm(0, 0.5, { type: 'LineString', coordinates: [[0, 1], [1, 1]] })!;
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
});

describe('unknown shapes and fires', () => {
  it('an answered feed in an unknown shape is unavailable, never offline', () => {
    const r = nearbyFromResult(live({ something: 'else' }), 1, 1, 150);
    expect(r).toMatchObject({ count: null, state: 'live', reason: 'unavailable' });
    const c = nearbyFromResult(live({ nope: true }), 1, 1, 150, NEARBY_LAYERS.find((l) => l.layer === 'cables')!);
    expect(c.reason).toBe('unavailable');
  });
  it('a failed feed stays offline with count null', () => {
    expect(nearbyFromResult(live(null, 'offline'), 1, 1, 150)).toEqual({ count: null, state: 'offline', points: [] });
  });
  it('fire highlights carry observedAt from seenAt (epoch s) and a satellite/FRP title', () => {
    const p = toPoint({ id: 'N-202609301041-50.44978-30.79232', lat: 50.44978, lng: 30.79232, frpMw: 12.34, satellite: 'NOAA20', seenAt: 1790851260 }, 0)!;
    expect(p.observedAt).toBe(new Date(1790851260 * 1000).toISOString());
    expect(p.title).toBe('VIIRS NOAA20 hotspot · FRP 12.3 MW');
    expect(toPoint({ id: 'm', lat: 1, lng: 1, satellite: 'MODIS', frpMw: null, seenAt: 1790851260 }, 0)!.title).toBe('MODIS hotspot');
  });
});
