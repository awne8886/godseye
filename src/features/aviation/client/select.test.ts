import { describe, expect, it } from 'vitest';
import type { HitTestMap } from '@/lib/map/picking';
import type { FlightRecord } from '../adsb';
import { advanceFrame, newFrame } from './layers';
import { aircraftSelection, HIT_PX, hitTestAircraft } from './select';

const rec = (id: string, lng: number, lat: number, p: Partial<FlightRecord> = {}): FlightRecord => ({
  id, callsign: null, registration: null, typeCode: null, bucket: 'commercial', isHelicopter: false, onGround: false, lat, lng,
  altFt: 30000, altGeomFt: null, gsKt: 0, trackDeg: 90, vrFpm: 0, squawk: null, emergency: null, category: null, nacP: null,
  dbFlags: null, seenAt: 1000, source: 'adsblol_tiles', posSource: 'adsb', ...p,
});

/** 100 px per degree around (0, 0), zoom 6. */
const map: HitTestMap = {
  project: ([lng, lat]) => ({ x: 500 + lng * 100, y: 500 - lat * 100 }),
  unproject: ([x, y]) => ({ lng: (x - 500) / 100, lat: (500 - y) / 100, wrap: () => ({ lng: (x - 500) / 100, lat: (500 - y) / 100 }) }),
  getZoom: () => 6,
  getCenter: () => ({ lng: 0, lat: 0 }),
  getLayer: () => undefined,
  queryRenderedFeatures: () => [],
};

describe('aircraft selection (unchanged shape)', () => {
  it('carries kind, id, registry layer, source, observedAt from seenAt, a copy of the record and lngLat', () => {
    const r = rec('a1b2c3', 1, 2, { bucket: 'military', callsign: 'RCH123' });
    const s = aircraftSelection(r, [1, 2]);
    expect(s).toEqual({ kind: 'aircraft', id: 'a1b2c3', layer: 'military', source: 'adsblol_tiles', observedAt: '1970-01-01T00:16:40.000Z', data: { ...r }, lngLat: [1, 2] });
    expect(s.data).not.toBe(r);
  });
});

describe('aircraft CPU hit-test', () => {
  const f = newFrame([rec('near', 0.05, 0), rec('far', 0.5, 0), rec('jet', 0.02, 0.02, { bucket: 'jet' })]);
  advanceFrame(f, 1_000_000, new Set(['commercial', 'jet']), false, [0, 0]);

  it('returns the single nearest drawn aircraft within HIT_PX, with its distance', () => {
    const c = hitTestAircraft(f, { x: 504, y: 500 }, map);
    expect(c).toHaveLength(1);
    expect(c[0]!.selection.id).toBe('near');
    expect(c[0]!.layer).toBe('flights');
    expect(c[0]!.distancePx).toBeCloseTo(1, 5);
  });

  it('misses beyond HIT_PX and when nothing is drawn', () => {
    expect(hitTestAircraft(f, { x: 505, y: 500 + 3 * HIT_PX }, map)).toEqual([]);
    expect(hitTestAircraft(newFrame([]), { x: 500, y: 500 }, map)).toEqual([]);
  });

  it('only considers visible aircraft (inactive buckets are not hit)', () => {
    const g = newFrame([rec('mil', 0, 0, { bucket: 'military' })]);
    advanceFrame(g, 1_000_000, new Set(['commercial']), false, [0, 0]);
    expect(hitTestAircraft(g, { x: 500, y: 500 }, map)).toEqual([]);
  });
});
