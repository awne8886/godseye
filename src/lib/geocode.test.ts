import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from './http';

const calls: string[] = [];
vi.mock('./http', async (orig) => {
  const actual = await orig<typeof HttpModule>();
  return {
    ...actual,
    httpJson: vi.fn(async (u: URL) => {
      calls.push(u.toString());
      if (u.hostname === 'photon.komoot.io') {
        return { data: { features: [{ geometry: { coordinates: [30.52, 50.45] }, properties: { name: 'Kyiv', country: 'Ukraine', countrycode: 'ua', osm_value: 'city', extent: [30.2, 50.6, 30.8, 50.2] } }] } };
      }
      return { data: [{ lat: '50.45', lon: '30.52', display_name: 'Kyiv, Ukraine', name: 'Kyiv', addresstype: 'city', boundingbox: ['50.2', '50.6', '30.2', '30.8'], address: { country_code: 'ua' } }] };
    }),
  };
});

import { MemoryStore, setStore } from './cache';
import { geocoderStats, nominatimSearch, parseLatLng, photonSearch } from './geocode';

beforeEach(() => {
  calls.length = 0;
  setStore(new MemoryStore());
});
afterEach(() => setStore(undefined));

describe('geocoding', () => {
  it('parses "lat, lng" instantly without a network call', () => {
    expect(parseLatLng('51.5072, -0.1276')).toMatchObject({ lat: 51.5072, lng: -0.1276, source: 'coordinates' });
    expect(parseLatLng('91, 0')).toBeNull();
    expect(parseLatLng('London')).toBeNull();
  });

  it('maps Photon features (bbox west,south,east,north) and caches type-ahead', async () => {
    const a = await photonSearch('kyiv', { lat: 50, lng: 30 });
    expect(a[0]).toMatchObject({ name: 'Kyiv', countryCode: 'UA', bbox: [30.2, 50.2, 30.8, 50.6], source: 'photon' });
    await photonSearch('kyiv', { lat: 50, lng: 30 });
    expect(calls.filter((c) => c.includes('photon'))).toHaveLength(1);
  });

  it('queues Nominatim and serves repeats from the 30-day cache', async () => {
    const r = await nominatimSearch('Kyiv');
    expect(r[0]).toMatchObject({ name: 'Kyiv', countryCode: 'UA', source: 'nominatim', bbox: [30.2, 50.2, 30.8, 50.6] });
    await nominatimSearch('  kyiv ');
    expect(calls.filter((c) => c.includes('nominatim'))).toHaveLength(1);
    expect(geocoderStats()).toMatchObject({ maxQueue: 40, queueDepth: 0 });
    expect(geocoderStats().cached).toBeGreaterThanOrEqual(1);
  });
});
