import { describe, expect, it } from 'vitest';
import type { FeedResult } from './feeds';
import { apiError, cacheControl, compressedJson, feedJson, json, parseQuery, withRoute } from './respond';
import { z } from 'zod';

const meta = (over: Partial<FeedResult<unknown>['meta']> = {}): FeedResult<unknown>['meta'] => ({
  feed: 'earthquakes', kind: 'live', state: 'live', fetchedAt: '2026-09-30T16:00:00.000Z', observedAt: null,
  lastGoodAt: '2026-09-30T16:00:00.000Z', stale: false, ttlSeconds: 60, attribution: [], ...over,
});

describe('response helpers', () => {
  it('browsers revalidate every poll (no stale-while-revalidate); shared caches keep s-maxage; CDNs get SWR', () => {
    expect(cacheControl(60)).toBe('public, max-age=0, must-revalidate, s-maxage=60');
    expect(cacheControl(60)).not.toMatch(/stale-while-revalidate/);
    expect(cacheControl(0)).toBe('no-store, max-age=0');
    const r = json({ a: 1 }, { ttl: 15 });
    expect(r.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate, s-maxage=15');
    expect(r.headers.get('cdn-cache-control')).toBe('public, s-maxage=15, stale-while-revalidate=30');
    expect(json({ a: 1 }, { ttl: 0 }).headers.get('cdn-cache-control')).toBeNull();
  });

  it('returns {error, detail} errors with no-store', async () => {
    const r = apiError(404, 'not_found', 'Unknown airport ZZZZ');
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(await r.json()).toEqual({ error: 'not_found', detail: 'Unknown airport ZZZZ' });
  });

  it('feed responses carry meta + providers, ETags and 304s', async () => {
    const result: FeedResult<number[]> = { data: [1, 2], meta: meta(), providers: { usgs: { ok: true, count: 2, ms: 10, age_s: 3 } } };
    const r1 = await feedJson(new Request('http://x/'), result, (d) => ({ items: d }));
    const body = await r1.json();
    expect(body).toMatchObject({ items: [1, 2], meta: { feed: 'earthquakes' }, providers: { usgs: { ok: true } } });
    const etag = r1.headers.get('etag')!;
    const r2 = await feedJson(new Request('http://x/', { headers: { 'if-none-match': etag } }), result, (d) => ({ items: d }));
    expect(r2.status).toBe(304);
  });

  it('answers SOURCE OFFLINE (503) instead of an empty array when a feed has no data', async () => {
    const r = await feedJson(new Request('http://x/'), { data: null, meta: meta({ state: 'offline', fetchedAt: null, lastGoodAt: null }), providers: {} }, () => ({}));
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: 'source_offline' });
  });

  it('sends feed bodies as plain JSON with no Content-Encoding, whatever the client accepts', async () => {
    // Next >= 16.4 drops Content-Encoding from route-handler Responses: a body compressed here would
    // reach the browser as brotli bytes labelled JSON. Compression is done downstream.
    const result: FeedResult<number[]> = { data: Array.from({ length: 2000 }, (_, i) => i), meta: meta({ feed: 'cables' }), providers: {} };
    for (const accept of [undefined, 'gzip, deflate, br', 'br', 'gzip', 'zstd']) {
      const r = await feedJson(new Request('http://x/', accept ? { headers: { 'accept-encoding': accept } } : {}), result, (d) => ({ items: d }));
      expect(r.headers.get('content-encoding')).toBeNull();
      expect((await r.json()).items).toHaveLength(2000);
    }
  });

  it('never serves a stale body when per-request fields change within one ETag', async () => {
    const mk = (age: number): FeedResult<number[]> => ({ data: Array.from({ length: 2000 }, (_, i) => i), meta: meta({ feed: 'cables-age' }), providers: { tg: { ok: true, count: 1, ms: 1, age_s: age } } });
    const h = { headers: { 'accept-encoding': 'br' } };
    const a = await (await feedJson(new Request('http://x/', h), mk(0), (d) => ({ items: d }))).json();
    const b = await (await feedJson(new Request('http://x/', h), mk(308), (d) => ({ items: d }))).json();
    expect(a.providers.tg.age_s).toBe(0);
    expect(b.providers.tg.age_s).toBe(308);
  });

  it('shortens the edge TTL for stale snapshots', async () => {
    const r = await feedJson(new Request('http://x/'), { data: [1], meta: meta({ state: 'stale', stale: true, ttlSeconds: 900 }), providers: {} }, (d) => ({ items: d }));
    expect(r.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate, s-maxage=15');
    expect(r.headers.get('cdn-cache-control')).toBe('public, s-maxage=15, stale-while-revalidate=30');
  });

  it('serialises bulk payloads once per version, sends them as plain JSON and answers 304', async () => {
    let builds = 0;
    const build = () => (builds++, { rows: Array.from({ length: 1000 }, (_, i) => [i, 'x']) });
    const first = compressedJson(new Request('http://x/', { headers: { 'accept-encoding': 'gzip, br' } }), 'k', 'v1', build, 15);
    expect(first.headers.get('content-encoding')).toBeNull();
    expect((await first.json()).rows).toHaveLength(1000);
    const plain = compressedJson(new Request('http://x/'), 'k', 'v1', build, 15);
    expect(plain.headers.get('etag')).toBe(first.headers.get('etag'));
    expect(builds).toBe(1);
    const nm = compressedJson(new Request('http://x/', { headers: { 'if-none-match': plain.headers.get('etag')! } }), 'k', 'v1', build, 15);
    expect(nm.status).toBe(304);
    compressedJson(new Request('http://x/'), 'k', 'v2', build, 15);
    expect(builds).toBe(2);
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
    expect(() => withRoute('/api/not-catalogued', () => new Response())).toThrow(/not in API_CATALOG/);
    const h = withRoute('/api/stats', () => {
      throw new Error('secret stack');
    });
    const orig = console.error;
    console.error = () => undefined;
    const r = await h(new Request('http://x/', { headers: { 'x-forwarded-for': '4.4.4.4' } }), undefined);
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
      const res = await withRoute(route, ok)(new Request(`http://x${route}`, { method: 'POST', headers: { 'x-forwarded-for': '4.3.2.1' } }), undefined);
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    setRateLimitStore(undefined);
  });
});
