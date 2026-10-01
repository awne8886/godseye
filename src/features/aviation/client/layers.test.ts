import { describe, expect, it, vi } from 'vitest';
import type { FlightRecord } from '../adsb';
import { FROZEN_DIM, advanceFrame, aggregateH3, buildLayers, newFrame, syncColors } from './layers';
import type { Rgba } from '@/lib/tokens';
import { aircraftSelection, hitTestAircraft } from './select';
import { EARTH_RADIUS_M, horizonAngleDeg, isFacing, type FarSideCamera } from '@/lib/map/far-side';

/** MapLibre at zoom ~2 (1280×800, fov 36.87°): camera ≈ 3.68 R above the ground → horizon ≈ 77.7°. */
const cam = (lng: number, lat: number, altitude = 3.68 * EARTH_RADIUS_M): FarSideCamera => ({ lng, lat, altitude });

const rec = (id: string, lng: number, lat: number, p: Partial<FlightRecord> = {}): FlightRecord => ({
  id, callsign: null, registration: null, typeCode: null, bucket: 'commercial', isHelicopter: false, onGround: false, lat, lng,
  altFt: 30000, altGeomFt: null, gsKt: 360, trackDeg: 90, vrFpm: 0, squawk: null, emergency: null, category: null, nacP: null,
  dbFlags: null, seenAt: 1000, source: 'adsblol_tiles', posSource: 'adsb', ...p,
});

describe('aviation frame', () => {
  const records = [rec('aaaaa1', 0, 51), rec('aaaaa2', 180, 0), rec('aaaaa3', 2, 50, { bucket: 'military' }), rec('aaaaa4', 1, 51, { onGround: true })];

  it('dead-reckons (≤ 60 s) and filters by bucket and the camera-facing hemisphere', () => {
    const f = newFrame(records);
    advanceFrame(f, 1030_000, new Set(['commercial']), cam(0, 50));
    expect([...f.visible.slice(0, f.count)]).toEqual([0, 3]); // far-side and military dropped
    expect(f.pos[0]).toBeGreaterThan(0); // moved east along track 090
    expect(f.pos[6]).toBe(1); // on the ground: not moved
    advanceFrame(f, 2000_000, new Set(['commercial', 'military']), null);
    expect(f.count).toBe(4); // mercator: no far-side filter
    expect(f.frozen[0]).toBe(1);
  });

  it('aggregates visible aircraft into H3 cells without losing any', () => {
    const f = newFrame(records);
    advanceFrame(f, 1000_000, new Set(['commercial', 'military']), null);
    const cells = aggregateH3(f);
    expect(cells.reduce((n, c) => n + c.count, 0)).toBe(4);
  });

  it('builds rings, trails and the H3 layer (icons need a DOM for the atlas)', () => {
    const f = newFrame([...records, rec('bbbbb1', 0, 51, { emergency: '7700', squawk: '7700' })]);
    advanceFrame(f, 1000_000, new Set(['commercial']), null);
    const layers = buildLayers({
      frame: f, view: { center: [0, 0], zoom: 2, bearing: 0 }, tick: 1, dataVersion: 1, colorMode: 'altitude', theme: 'HORUS',
      watched: ['aaaaa1'], tracks: new Map([['aaaaa1', [{ t: '2026-09-30T18:00:00Z', lat: 50, lng: -1, altFt: 1000, onGround: false, gsKt: 200, trackDeg: 90 }]]]),
      selectedId: null, cells: [{ hex: '831f1dfffffffff', count: 3 }], toSelection: aircraftSelection,
    }) as { id: string }[];
    expect(layers.map((l) => l.id)).toEqual(['aviation-trails', 'aviation-h3', 'aviation-emergency', 'aviation-highlight']);
    const trails = layers[0] as unknown as { props: { antialiasing?: boolean; parameters?: { cullMode?: string } } };
    expect(trails.props.antialiasing).toBe(true);
    expect(trails.props.parameters?.cullMode).toBe('none');
    expect(buildLayers({ frame: newFrame([]), view: { center: [0, 0], zoom: 2, bearing: 0 }, tick: 0, dataVersion: 0, colorMode: 'bucket', theme: 'HORUS', watched: [], tracks: new Map(), selectedId: null, cells: null, toSelection: aircraftSelection })).toBeNull();
  });

  it('ticks without re-running per-aircraft accessors: stable data, versions bump only on change (perf M4)', () => {
    const many = Array.from({ length: 2_000 }, (_, i) => rec(`c${String(i).padStart(5, '0')}`, (i % 40) - 20, 40 + (i % 20), { seenAt: 1000 + (i % 90) }));
    const f = newFrame(many);
    advanceFrame(f, 1010_000, new Set(['commercial']), cam(0, 50));
    const data = f.data;
    const vis = f.visVersion;
    const before = f.pos[0];
    advanceFrame(f, 1011_000, new Set(['commercial']), cam(0, 50));
    expect(f.data).toBe(data); // same deck data object → no full attribute rebuild
    expect(f.visVersion).toBe(vis);
    expect(f.pos[0]).not.toBe(before); // positions still advance
    // Crossing the 60 s cap settles an aircraft once: frozen and never advanced again.
    advanceFrame(f, 1075_000, new Set(['commercial']), cam(0, 50));
    expect(f.newlyFrozenCount).toBeGreaterThan(0);
    const settled = f.pos[0];
    advanceFrame(f, 1200_000, new Set(['commercial']), cam(0, 50));
    expect(f.pos[0]).toBe(settled);
    expect(f.frozen[0]).toBe(1);
    expect(f.staleVisible).toBe(f.count); // every drawn aircraft is now past the cap
    // A camera move that changes the visible set swaps the data object.
    advanceFrame(f, 1200_000, new Set(['commercial']), cam(180, -50));
    expect(f.data).not.toBe(data);
  });

  it('colours are patched only for the aircraft that just crossed the 60 s cap (perf m-j)', () => {
    // seenAt 1000…1089: ten aircraft cross the cap each 10 s of ticking.
    const many = Array.from({ length: 900 }, (_, i) => rec(`f${String(i).padStart(5, '0')}`, (i % 30) - 15, 40 + (i % 15), { seenAt: 1000 + (i % 90) }));
    const f = newFrame(many);
    const colorOf = vi.fn((): Rgba => [200, 100, 50, 255]);
    const want = new Set(['commercial'] as const);
    advanceFrame(f, 1050_000, want, null);
    expect(syncColors(f, 'k', colorOf)).toBe(900); // first build: every row
    const data = f.data;
    const attr = f.colorAttr!;
    expect(data.attributes?.getColor).toBe(attr);
    colorOf.mockClear();
    advanceFrame(f, 1051_000, want, null); // nobody new past the cap (ages ≤ 51 s)
    expect(syncColors(f, 'k', colorOf)).toBe(0);
    expect(colorOf).not.toHaveBeenCalled();
    expect(f.colorAttr).toBe(attr); // nothing to re-upload
    advanceFrame(f, 1070_000, want, null); // seenAt 1000…1009 are now > 60 s old
    const frozenNow = [...f.frozen].filter(Boolean).length;
    expect(frozenNow).toBe(100);
    expect(syncColors(f, 'k', colorOf)).toBe(100);
    expect(colorOf).toHaveBeenCalledTimes(100); // the patched rows only, not 900
    expect(f.data).toBe(data); // same deck data → no accessor re-runs
    expect(f.colorAttr).not.toBe(attr); // a new descriptor → deck re-uploads the colour buffer only
    expect(f.colorAttr!.value.buffer).toBe(attr.value.buffer);
    for (let k = 0; k < f.count; k++) {
      const i = f.visible[k]!;
      const rgba = [...f.colorAttr!.value.subarray(k * 4, k * 4 + 4)];
      expect(rgba).toEqual(f.frozen[i] ? [Math.round(200 * FROZEN_DIM), Math.round(100 * FROZEN_DIM), Math.round(50 * FROZEN_DIM), 255] : [200, 100, 50, 255]);
    }
    // A theme/colour-mode change (new key) rebuilds every row.
    colorOf.mockClear();
    expect(syncColors(f, 'k2', colorOf)).toBe(900);
  });

  it('hides aircraft beyond the camera horizon, not beyond 88° from the centre (R2 round 4 MAJOR-1)', () => {
    // R2 repro: camera over (110E, 15N) at zoom 2; Frankfurt at FL350 is 84.6° away — behind the limb.
    const camera = cam(110, 15);
    expect(horizonAngleDeg(camera.altitude)).toBeLessThan(80);
    const frankfurt = rec('3c6444', 8.57, 50.03, { altFt: 35000 });
    const f = newFrame([frankfurt]);
    advanceFrame(f, 1000_000, new Set(['commercial']), camera);
    expect(isFacing([8.57, 50.03], camera, 35000 * 0.3048)).toBe(false);
    expect(f.count).toBe(0);
  });

  it('agrees with isFacing() for every aircraft at several cameras (altitude lifts over the limb)', () => {
    const many: FlightRecord[] = [];
    for (let lat = -80; lat <= 80; lat += 10) for (let lng = -180; lng < 180; lng += 15) many.push(rec(`e${many.length}`, lng, lat, { altFt: (many.length % 5) * 10_000, onGround: many.length % 7 === 0 }));
    for (const c of [cam(-100, 30, 1.2 * EARTH_RADIUS_M), cam(10, 45, 2.1 * EARTH_RADIUS_M), cam(110, 15), cam(0, 89, 20 * EARTH_RADIUS_M), cam(179, -10, 0.3 * EARTH_RADIUS_M)]) {
      const f = newFrame(many);
      advanceFrame(f, 1000_000, new Set(['commercial']), c);
      const drawn = new Set([...f.visible.slice(0, f.count)]);
      const expected = many.map((r, i) => (isFacing([r.lng, r.lat], c, r.onGround ? 0 : (r.altFt ?? 0) * 0.3048) ? i : -1)).filter((i) => i >= 0);
      expect([...drawn].sort((a, b) => a - b)).toEqual(expected);
      expect(f.count).toBeLessThan(many.length);
    }
  });

  it('a far-side aircraft cannot be picked by the CPU hit-test either', () => {
    // Projected on top of the near side (the ghost's screen position): still not a candidate.
    const f = newFrame([rec('3c6444', 8.57, 50.03, { altFt: 35000 })]);
    advanceFrame(f, 1000_000, new Set(['commercial']), cam(110, 15));
    const map = { unproject: () => ({ lng: 8.57, lat: 50.03 }), project: () => ({ x: 100, y: 100 }), getZoom: () => 2 };
    expect(hitTestAircraft(f, { x: 100, y: 100 }, map as never)).toEqual([]);
    advanceFrame(f, 1000_000, new Set(['commercial']), cam(10, 48));
    expect(hitTestAircraft(f, { x: 100, y: 100 }, map as never)).toHaveLength(1);
  });

  it('matches the great-circle dead-reckoning of codec.deadReckon', async () => {
    const { deadReckon } = await import('../codec');
    const r = rec('d00001', -73.8, 40.6, { trackDeg: 47, gsKt: 480, seenAt: 1000 });
    const f = newFrame([r]);
    advanceFrame(f, 1042_000, new Set(['commercial']), null);
    const d = deadReckon(r, 1042_000);
    expect(f.pos[0]).toBeCloseTo(d.lng, 9);
    expect(f.pos[1]).toBeCloseTo(d.lat, 9);
  });
});
