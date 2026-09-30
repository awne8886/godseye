import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FeedResult } from './feeds';
import { apiError, cacheControl, compressedJson, feedJson, json, parseQuery, withRoute } from './respond';
import { z } from 'zod';

const meta = (over: Partial<FeedResult<unknown>['meta']> = {}): FeedResult<unknown>['meta'] => ({
  feed: 'earthquakes', kind: 'live', state: 'live', fetchedAt: '2026-09-30T16:00:00.000Z', observedAt: null,
  lastGoodAt: '2026-09-30T16:00:00.000Z', stale: false, ttlSeconds: 60, attribution: [], ...over,
});

describe('response helpers', () => {
  it('uses s-maxage + 2× stale-while-revalidate', () => {
    expect(cacheControl(60)).toBe('public, s-maxage=60, stale-while-revalidate=120');
    expect(cacheControl(0)).toBe('no-store, max-age=0');
    expect(json({ a: 1 }, { ttl: 15 }).headers.get('cache-control')).toBe('public, s-maxage=15, stale-while-revalidate=30');
  });

  it('returns {error, detail} errors with no-store', async () => {
    const r = apiError(404, 'not_found', 'Unknown airport ZZZZ');
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(await r.json()).toEqual({ error: 'not_found', detail: 'Unknown airport ZZZZ' });
  });

  it('feed responses carry meta + providers, ETags and 304s', async () => {
    const result: FeedResult<number[]> = { data: [1, 2], meta: meta(), providers: { usgs: { ok: true, count: 2, ms: 10, age_s: 3 } } };
    const r1 = feedJson(new Request('http://x/'), result, (d) => ({ items: d }));
    const body = await r1.json();
    expect(body).toMatchObject({ items: [1, 2], meta: { feed: 'earthquakes' }, providers: { usgs: { ok: true } } });
    const etag = r1.headers.get('etag')!;
    const r2 = feedJson(new Request('http://x/', { headers: { 'if-none-match': etag } }), result, (d) => ({ items: d }));
    expect(r2.status).toBe(304);
  });

  it('answers SOURCE OFFLINE (503) instead of an empty array when a feed has no data', async () => {
    const r = feedJson(new Request('http://x/'), { data: null, meta: meta({ state: 'offline', fetchedAt: null, lastGoodAt: null }), providers: {} }, () => ({}));
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: 'source_offline' });
  });

  it('shortens the edge TTL for stale snapshots', () => {
    const r = feedJson(new Request('http://x/'), { data: [1], meta: meta({ state: 'stale', stale: true, ttlSeconds: 900 }), providers: {} }, (d) => ({ items: d }));
    expect(r.headers.get('cache-control')).toBe('public, s-maxage=15, stale-while-revalidate=30');
  });

  it('precompresses bulk payloads once per version and negotiates encoding', async () => {
    let builds = 0;
    const build = () => (builds++, { rows: Array.from({ length: 1000 }, (_, i) => [i, 'x']) });
    const br = compressedJson(new Request('http://x/', { headers: { 'accept-encoding': 'gzip, br' } }), 'k', 'v1', build, 15);
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(JSON.parse(zlib.brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString()).rows).toHaveLength(1000);
    const gz = compressedJson(new Request('http://x/', { headers: { 'accept-encoding': 'gzip' } }), 'k', 'v1', build, 15);
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    const plain = compressedJson(new Request('http://x/'), 'k', 'v1', build, 15);
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(builds).toBe(1);
    const nm = compressedJson(new Request('http://x/', { headers: { 'if-none-match': plain.headers.get('etag')! } }), 'k', 'v1', build, 15);
    expect(nm.status).toBe(304);
    expect(plain.headers.get('vary')).toBe('Accept-Encoding');
  });

  it('refuses payloads over the 4 MB cap', () => {
    const r = compressedJson(new Request('http://x/'), 'huge', 'v1', () => 'x'.repeat(4 * 1024 * 1024 + 10), 15);
    expect(r.status).toBe(500);
  });

  it('validates query params with zod', async () => {
    const q = z.object({ lat: z.coerce.number().min(-90).max(90) });
    const bad = parseQuery(new Request('http://x/?lat=100'), q);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.response.status).toBe(400);
    const good = parseQuery(new Request('http://x/?lat=10'), q);
    expect(good.ok && good.data.lat).toBe(10);
  });

  it('withRoute hides internal errors behind a uniform 500', async () => {
    const h = withRoute('/api/test-boom', () => {
      throw new Error('secret stack');
    });
    const orig = console.error;
    console.error = () => undefined;
    const r = await h(new Request('http://x/', { headers: { 'x-real-ip': '4.4.4.4' } }), undefined);
    console.error = orig;
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('secret');
  });
});

describe('withRoute takes limits from the API catalogue', () => {
  it('applies the shared 5/min AI bucket across AI routes', async () => {
    const { setRateLimitStore, MemoryRateLimitStore } = await import('./ratelimit');
    setRateLimitStore(new MemoryRateLimitStore());
    const ok = () => new Response('ok');
    const routes = ['/api/ai/overview', '/api/ai/analyze', '/api/ai/briefing'];
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const route = routes[i % 3]!;
      const res = await withRoute(route, ok)(new Request(`http://x${route}`, { method: 'POST', headers: { 'x-real-ip': '4.3.2.1' } }), undefined);
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    setRateLimitStore(undefined);
  });
});
