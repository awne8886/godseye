import { describe, expect, it } from 'vitest';
import type { FlightRecord } from '../adsb';
import { advanceFrame, aggregateH3, buildLayers, newFrame } from './layers';

const rec = (id: string, lng: number, lat: number, p: Partial<FlightRecord> = {}): FlightRecord => ({
  id, callsign: null, registration: null, typeCode: null, bucket: 'commercial', isHelicopter: false, onGround: false, lat, lng,
  altFt: 30000, altGeomFt: null, gsKt: 360, trackDeg: 90, vrFpm: 0, squawk: null, emergency: null, category: null, nacP: null,
  dbFlags: null, seenAt: 1000, source: 'adsblol_tiles', posSource: 'adsb', ...p,
});

describe('aviation frame', () => {
  const records = [rec('aaaaa1', 0, 51), rec('aaaaa2', 180, 0), rec('aaaaa3', 2, 50, { bucket: 'military' }), rec('aaaaa4', 1, 51, { onGround: true })];

  it('dead-reckons (≤ 60 s) and filters by bucket and the camera-facing hemisphere', () => {
    const f = newFrame(records);
    advanceFrame(f, 1030_000, new Set(['commercial']), true, [0, 50]);
    expect([...f.visible.slice(0, f.count)]).toEqual([0, 3]); // far-side and military dropped
    expect(f.pos[0]).toBeGreaterThan(0); // moved east along track 090
    expect(f.pos[6]).toBe(1); // on the ground: not moved
    advanceFrame(f, 2000_000, new Set(['commercial', 'military']), false, [0, 50]);
    expect(f.count).toBe(4); // mercator: no far-side filter
    expect(f.frozen[0]).toBe(1);
  });

  it('aggregates visible aircraft into H3 cells without losing any', () => {
    const f = newFrame(records);
    advanceFrame(f, 1000_000, new Set(['commercial', 'military']), false, [0, 0]);
    const cells = aggregateH3(f);
    expect(cells.reduce((n, c) => n + c.count, 0)).toBe(4);
  });

  it('builds rings, trails and the H3 layer (icons need a DOM for the atlas)', () => {
    const f = newFrame([...records, rec('bbbbb1', 0, 51, { emergency: '7700', squawk: '7700' })]);
    advanceFrame(f, 1000_000, new Set(['commercial']), false, [0, 0]);
    const layers = buildLayers({
      frame: f, view: { center: [0, 0], zoom: 2, bearing: 0 }, tick: 1, dataVersion: 1, colorMode: 'altitude', theme: 'HORUS',
      watched: ['aaaaa1'], tracks: new Map([['aaaaa1', [{ t: '2026-09-30T18:00:00Z', lat: 50, lng: -1, altFt: 1000, onGround: false, gsKt: 200, trackDeg: 90 }]]]),
      selectedId: null, cells: [{ hex: '831f1dfffffffff', count: 3 }], onSelect: () => undefined,
    }) as { id: string }[];
    expect(layers.map((l) => l.id)).toEqual(['aviation-trails', 'aviation-h3', 'aviation-emergency', 'aviation-highlight']);
    expect(buildLayers({ frame: newFrame([]), view: { center: [0, 0], zoom: 2, bearing: 0 }, tick: 0, dataVersion: 0, colorMode: 'bucket', theme: 'HORUS', watched: [], tracks: new Map(), selectedId: null, cells: null, onSelect: () => undefined })).toBeNull();
  });
});
