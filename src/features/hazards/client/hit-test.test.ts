import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { nearestPoint } from './hit-test';

/** A flat fake map: 100 px per degree around (0, 0), mercator-like, zoom 6. */
function fakeMap(projection: 'globe' | 'mercator' = 'mercator'): MapLibreMap {
  return {
    getCenter: () => ({ lng: 0, lat: 0 }),
    getZoom: () => 6,
    getProjection: () => ({ type: projection }),
    project: ([lng, lat]: [number, number]) => ({ x: 500 + lng * 100, y: 500 - lat * 100 }),
  } as unknown as MapLibreMap;
}

const click = (x: number, y: number): MapMouseEvent => ({ point: { x, y }, lngLat: { lng: (x - 500) / 100, lat: (500 - y) / 100 } }) as unknown as MapMouseEvent;

describe('hazards hit testing', () => {
  const items = [
    { id: 'a', lng: 0, lat: 0, r: 5 },
    { id: 'b', lng: 0.05, lat: 0, r: 5 },
    { id: 'far', lng: 170, lat: 0, r: 5 },
  ];
  it('returns the nearest point within its radius plus slack', () => {
    const hit = nearestPoint(fakeMap(), click(504, 500), items, (i) => [i.lng, i.lat], (i) => i.r);
    expect(hit?.item.id).toBe('b');
    expect(hit?.distancePx).toBeCloseTo(1, 5);
    expect(nearestPoint(fakeMap(), click(530, 500), items, (i) => [i.lng, i.lat], (i) => i.r)).toBeNull();
  });
  it('skips points on the far side of the globe', () => {
    const farOnly = [{ id: 'far', lng: 170, lat: 0, r: 5 }];
    // A fake projection that (wrongly) maps the far point under the cursor must still not hit on a globe.
    const m = { ...fakeMap('globe'), project: () => ({ x: 500, y: 500 }), getZoom: () => 0 } as unknown as MapLibreMap;
    const e = { point: { x: 500, y: 500 }, lngLat: { lng: 170, lat: 0 } } as unknown as MapMouseEvent;
    expect(nearestPoint(m, e, farOnly, (i) => [i.lng, i.lat], (i) => i.r)).toBeNull();
    const merc = { ...m, getProjection: () => ({ type: 'mercator' }) } as unknown as MapLibreMap;
    expect(nearestPoint(merc, e, farOnly, (i) => [i.lng, i.lat], (i) => i.r)?.item.id).toBe('far');
  });
});
