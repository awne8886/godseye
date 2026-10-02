import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { ApiError, GeoResponse } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { catalogEntry } from '@/lib/api-catalog';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { gridCell } from '@/components/panels/recon/server/geo';

// Fixtures: Photon and Nominatim reverse for Kyiv, recorded 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
let ip = 0;
const call = (qs: string) => GET(new Request(`http://localhost/api/geo/reverse${qs}`, { headers: { 'x-forwarded-for': `9.9.${Math.floor(ip / 250)}.${ip++ % 250}` } }), undefined);

describe('GET /api/geo/reverse', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
    upstream.reset();
  });

  it('snaps to the 0.1° grid cell centre', () => {
    expect(gridCell(50.4501, 30.5234)).toEqual({ lat: 50.5, lng: 30.5, key: '50.5,30.5' });
    expect(gridCell(-33.86, 151.21).key).toBe('-33.9,151.2');
    expect(gridCell(10, 179.97).key).toBe('10.0,180.0');
  });

  it('answers from Photon for the cell and serves the whole cell from cache', async () => {
    upstream.on('photon.komoot.io/reverse', { json: fixture('photon-reverse-kyiv.json') });
    const res = await call('?lat=50.4501&lng=30.5234');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(GeoResponse.safeParse(body).success).toBe(true);
    expect(body.cell).toBe('50.5,30.5');
    expect(body.results[0]).toMatchObject({ source: 'photon', countryCode: 'UA' });
    expect(body.providers.photon).toMatchObject({ ok: true, count: 1 });
    expect(body.attribution).toContain('OpenStreetMap');
    expect(res.headers.get('cache-control')).toContain('s-maxage=600');
    // Photon was asked about the cell centre, not the raw cursor.
    expect(upstream.calls[0]!.url).toContain('lat=50.5000');
    // Another point in the same cell: no new upstream call.
    const again = await call('?lat=50.46&lng=30.47');
    expect((await again.json()).results[0].name).toBe(body.results[0].name);
    expect(upstream.calls).toHaveLength(1);
  });

  it('treats "nothing here" from Photon as truthful and does not queue Nominatim', async () => {
    upstream.on('photon.komoot.io/reverse', { json: { type: 'FeatureCollection', features: [] } });
    const res = await call('?lat=0&lng=-30');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(body.providers.photon.ok).toBe(true);
    expect(upstream.calls.some((c) => c.url.includes('nominatim'))).toBe(false);
  });

  it('falls back to the Nominatim queue when Photon fails, then reports SOURCE OFFLINE when both fail', async () => {
    upstream.on('photon.komoot.io', { error: 'timeout' });
    upstream.on('nominatim.openstreetmap.org/reverse', { json: fixture('nominatim-reverse-kyiv.json') });
    const res = await call('?lat=48.45&lng=35.05'); // a cell not seen by geocode.ts's in-memory Photon cache
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.providers.photon).toMatchObject({ ok: false, error: 'timeout' });
    expect(body.providers.nominatim.ok).toBe(true);
    expect(body.results[0].source).toBe('nominatim');

    upstream.reset();
    upstream.on('photon.komoot.io', { error: 'timeout' });
    upstream.on('nominatim.openstreetmap.org', { status: 503 });
    const off = await call('?lat=40.1&lng=10.1');
    expect(off.status).toBe(503);
    const ob = await off.json();
    expect(ApiError.safeParse(ob).success).toBe(true);
    expect(ob.error).toBe('source_offline');
    expect(ob.providers.photon.ok).toBe(false);
    expect(ob.providers.nominatim.ok).toBe(false);
    expect(off.headers.get('cache-control')).toContain('no-store');
  });

  it('rejects bad coordinates with 400 before any upstream call', async () => {
    for (const qs of ['', '?lat=91&lng=0', '?lat=0&lng=181', '?lat=abc&lng=1']) {
      const res = await call(qs);
      expect(res.status, qs).toBe(400);
    }
    expect(upstream.calls).toEqual([]);
  });

  it('uses the catalogue rate limit (default bucket)', () => {
    expect(catalogEntry('/api/geo/reverse')?.rateLimit).toBeUndefined();
  });
});
