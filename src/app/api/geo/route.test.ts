import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { GeoResponse } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';

// Fixtures: ipwho.is and freeipapi v1 for 8.8.8.8, recorded 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (xff?: string) => GET(new Request('http://localhost/api/geo', { headers: xff ? { 'x-forwarded-for': xff } : {} }), undefined);

describe('GET /api/geo (consented visitor region)', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
    upstream.reset();
  });

  it('returns a region-level place (0.1°), never cached', async () => {
    upstream.on('ipwho.is/8.8.8.8', { json: fixture('ipwho-8.8.8.8.json') });
    const res = await call('8.8.8.8');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(GeoResponse.safeParse(body).success).toBe(true);
    expect(body.results[0]).toMatchObject({ source: 'ip', kind: 'ip-region', countryCode: 'US', lat: 37.3, lng: -121.9 });
    expect(body.providers['ipwho.is'].ok).toBe(true);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('falls back to freeipapi (v1 path) when ipwho.is fails', async () => {
    upstream.on('ipwho.is', { error: 'timeout' });
    upstream.on('free.freeipapi.com/api/v1/json/8.8.4.4', { json: fixture('freeipapi-8.8.8.8.json') });
    const body = await (await call('8.8.4.4')).json();
    expect(body.providers['ipwho.is'].ok).toBe(false);
    expect(body.providers.freeipapi.ok).toBe(true);
    expect(body.results[0].name).toBe('Mountain View');
  });

  it('answers 422 for private/local clients without calling any provider', async () => {
    for (const xff of ['10.0.0.8', '127.0.0.1', undefined]) {
      const res = await call(xff);
      expect(res.status).toBe(422);
    }
    expect(upstream.calls).toEqual([]);
  });

  it('reports SOURCE OFFLINE with provider status when both fail', async () => {
    upstream.on('ipwho.is', { status: 500 });
    upstream.on('freeipapi', { status: 500 });
    const res = await call('1.1.1.1');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(Object.keys(body.providers)).toEqual(['ipwho.is', 'freeipapi']);
  });
});
