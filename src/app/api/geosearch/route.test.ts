import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { GeoResponse } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';

// Fixtures: Photon "Kyiv" and Nominatim search "kyiv", recorded 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
let n = 0;
const call = (qs: string) => GET(new Request(`http://localhost/api/geosearch${qs}`, { headers: { 'x-forwarded-for': `9.8.${Math.floor(n / 250)}.${n++ % 250}` } }), undefined);

describe('GET /api/geosearch', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
    upstream.reset();
  });

  it('parses "lat,lng" instantly without any upstream call', async () => {
    const res = await call('?q=' + encodeURIComponent('51.5074, -0.1278'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(GeoResponse.safeParse(body).success).toBe(true);
    expect(body.results[0]).toMatchObject({ source: 'coordinates', lat: 51.5074, lng: -0.1278 });
    expect(body.providers.coordinates.ok).toBe(true);
    expect(upstream.calls).toEqual([]);
  });

  it('serves type-ahead from Photon (cached) and never calls Nominatim without submit', async () => {
    upstream.on('photon.komoot.io/api', { json: fixture('photon-kyiv.json') });
    const res = await call('?q=Kyiv');
    const body = await res.json();
    expect(GeoResponse.safeParse(body).success).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].source).toBe('photon');
    expect(body.providers).toEqual({ photon: expect.objectContaining({ ok: true }) });
    await call('?q=Kyiv');
    expect(upstream.calls).toHaveLength(1);

    upstream.reset();
    upstream.on('photon.komoot.io/api', { json: { type: 'FeatureCollection', features: [] } });
    const empty = await (await call('?q=zzzzqqq')).json();
    expect(empty.results).toEqual([]);
    expect(upstream.calls.some((c) => c.url.includes('nominatim'))).toBe(false);
  });

  it('promotes to the Nominatim queue only on an explicit submit with no Photon answer', async () => {
    upstream.on('photon.komoot.io/api', { json: { type: 'FeatureCollection', features: [] } });
    upstream.on('nominatim.openstreetmap.org/search', { json: fixture('nominatim-search-kyiv.json') });
    const res = await call('?q=kyiv%20oblast%20hq&submit=1');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.providers.photon.ok).toBe(true);
    expect(body.providers.nominatim.ok).toBe(true);
    expect(body.results[0].source).toBe('nominatim');
  });

  it('reports SOURCE OFFLINE when Photon fails on type-ahead', async () => {
    upstream.on('photon.komoot.io', { status: 502 });
    const res = await call('?q=Lviv');
    expect(res.status).toBe(503);
    expect((await res.json()).providers.photon).toMatchObject({ ok: false, error: 'http_502' });
  });

  it('rejects an empty query', async () => {
    expect((await call('?q=')).status).toBe(400);
    expect((await call('')).status).toBe(400);
  });
});
