import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import zlib from 'node:zlib';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { resetFeeds } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { MAX_RESPONSE_BYTES } from '@/lib/respond';
import { SatellitesResponse } from '@/lib/schemas';
import { celestrakRoutes, netError, upstreamRouter } from '@/features/space/__fixtures__/upstreams';
import { fx } from '@/features/space/__fixtures__';
import { resetCelestrakErrors } from '@/features/space/server/satellites';
import { COL } from '@/features/space/lib/catalog';
import { GET } from './route';

vi.mock('@/lib/http', async (orig) => ({ ...(await orig<Record<string, unknown>>()), httpJson: vi.fn() }));

const req = (qs = '', headers: Record<string, string> = {}) => new Request(`http://localhost/api/satellites${qs}`, { headers: { 'x-forwarded-for': '10.1.2.3', ...headers } });

beforeEach(() => {
  clearL1();
  resetFeeds();
  setStore(new MemoryStore());
  resetCelestrakErrors();
  vi.mocked(httpJson).mockReset();
});
afterEach(() => {
  resetFeeds();
  setStore(undefined);
});

describe('GET /api/satellites', () => {
  it('serves the columnar OMM catalogue with meta, providers, missions and counts', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter(celestrakRoutes()).impl as never);
    const res = await GET(req(), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=\d+/);
    expect(res.headers.get('etag')).toMatch(/^W\//);
    const body = await res.json();
    const parsed = SatellitesResponse.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
    expect(body.meta).toMatchObject({ feed: 'satellites', kind: 'live', state: 'live' });
    expect(body.providers.celestrak).toMatchObject({ ok: true, count: fx.active.length });
    expect(body.catalogueSource).toBe('celestrak');
    expect(body.rows.length).toBe(fx.active.length);
    expect(Object.values(body.categoryCounts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(fx.active.length);
  });

  it('filters by category and answers 304 to a matching ETag', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter(celestrakRoutes()).impl as never);
    const res = await GET(req('?category=navigation'), undefined);
    const body = await res.json();
    expect(SatellitesResponse.safeParse(body).success).toBe(true);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((r: unknown[]) => r[COL.category] === 'navigation')).toBe(true);
    expect(body.categoryCounts.navigation).toBe(body.rows.length);
    const again = await GET(req('?category=navigation', { 'if-none-match': res.headers.get('etag')! }), undefined);
    expect(again.status).toBe(304);
  });

  it('narrows to one NORAD id for the SPACE panel look-up (no full catalogue on the main thread)', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter(celestrakRoutes()).impl as never);
    const res = await GET(req('?id=25544'), undefined);
    const body = await res.json();
    expect(SatellitesResponse.safeParse(body).success).toBe(true);
    expect(body.rows.length).toBe(1);
    expect(body.rows[0][COL.noradId]).toBe(25544);
    expect(Object.values(body.categoryCounts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(1);
    expect((await GET(req('?id=abc'), undefined)).status).toBe(400);
  });

  it('negotiates brotli/gzip and stays under the 4 MB cap', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter(celestrakRoutes()).impl as never);
    const res = await GET(req('', { 'accept-encoding': 'gzip' }), undefined);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const raw = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
    expect(raw.length).toBeLessThan(MAX_RESPONSE_BYTES);
    expect(SatellitesResponse.safeParse(JSON.parse(raw.toString('utf8'))).success).toBe(true);
  });

  it('labels the SatNOGS fallback', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter({ 'GROUP=active&': netError(), 'db.satnogs.org': fx.satnogs }).impl as never);
    const body = await (await GET(req(), undefined)).json();
    expect(SatellitesResponse.safeParse(body).success).toBe(true);
    expect(body.catalogueSource).toBe('satnogs-fallback');
    expect(body.note).toMatch(/SatNOGS/);
    expect(body.providers.celestrak.ok).toBe(false);
    expect(body.providers.satnogs.ok).toBe(true);
  });

  it('503 SOURCE OFFLINE when every provider fails', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter({ 'GROUP=active&': netError(), 'db.satnogs.org': netError() }).impl as never);
    const res = await GET(req(), undefined);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('source_offline');
    expect(body.meta).toMatchObject({ feed: 'satellites', state: 'offline', lastGoodAt: null });
    expect(body.providers).toBeDefined();
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('400 on an unknown category', async () => {
    const res = await GET(req('?category=ufo'), undefined);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });
});
