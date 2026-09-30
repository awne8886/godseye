import { describe, expect, it } from 'vitest';
import type { FlightRecord } from '../adsb';
import { advanceFrame, aggregateH3, buildLayers, newFrame } from './layers';
import { aircraftSelection } from './select';

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
      selectedId: null, cells: [{ hex: '831f1dfffffffff', count: 3 }], toSelection: aircraftSelection,
    }) as { id: string }[];
    expect(layers.map((l) => l.id)).toEqual(['aviation-trails', 'aviation-h3', 'aviation-emergency', 'aviation-highlight']);
    expect(buildLayers({ frame: newFrame([]), view: { center: [0, 0], zoom: 2, bearing: 0 }, tick: 0, dataVersion: 0, colorMode: 'bucket', theme: 'HORUS', watched: [], tracks: new Map(), selectedId: null, cells: null, toSelection: aircraftSelection })).toBeNull();
  });

  it('ticks without re-running per-aircraft accessors: stable data, versions bump only on change (perf M4)', () => {
    const many = Array.from({ length: 2_000 }, (_, i) => rec(`c${String(i).padStart(5, '0')}`, (i % 40) - 20, 40 + (i % 20), { seenAt: 1000 + (i % 90) }));
    const f = newFrame(many);
    advanceFrame(f, 1010_000, new Set(['commercial']), true, [0, 50]);
    const data = f.data;
    const vis = f.visVersion;
    const before = f.pos[0];
    advanceFrame(f, 1011_000, new Set(['commercial']), true, [0, 50]);
    expect(f.data).toBe(data); // same deck data object → no full attribute rebuild
    expect(f.visVersion).toBe(vis);
    expect(f.pos[0]).not.toBe(before); // positions still advance
    // Crossing the 60 s cap settles an aircraft once: frozen and never advanced again.
    const fz = f.frozenVersion;
    advanceFrame(f, 1075_000, new Set(['commercial']), true, [0, 50]);
    expect(f.frozenVersion).toBeGreaterThan(fz);
    const settled = f.pos[0];
    advanceFrame(f, 1200_000, new Set(['commercial']), true, [0, 50]);
    expect(f.pos[0]).toBe(settled);
    expect(f.frozen[0]).toBe(1);
    expect(f.staleVisible).toBe(f.count); // every drawn aircraft is now past the cap
    // A camera move that changes the visible set swaps the data object.
    advanceFrame(f, 1200_000, new Set(['commercial']), true, [180, -50]);
    expect(f.data).not.toBe(data);
  });

  it('matches the great-circle dead-reckoning of codec.deadReckon', async () => {
    const { deadReckon } = await import('../codec');
    const r = rec('d00001', -73.8, 40.6, { trackDeg: 47, gsKt: 480, seenAt: 1000 });
    const f = newFrame([r]);
    advanceFrame(f, 1042_000, new Set(['commercial']), false, [0, 0]);
    const d = deadReckon(r, 1042_000);
    expect(f.pos[0]).toBeCloseTo(d.lng, 9);
    expect(f.pos[1]).toBeCloseTo(d.lat, 9);
  });
});
