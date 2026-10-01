import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import zlib from 'node:zlib';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { resetFeeds } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { MAX_RESPONSE_BYTES } from '@/lib/respond';
import { SatellitesResponse } from '@/lib/schemas';
import { celestrakRoutes, netError, upstreamRouter } from '@/features/space/__fixtures__/upstreams';
import { FUTURE_EPOCH_CAPTURED_AT, fx } from '@/features/space/__fixtures__';
import { resetCelestrakErrors } from '@/features/space/server/satellites';
import { COL, epochIso } from '@/features/space/lib/catalog';
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
  vi.useRealTimers();
});

/**
 * Size fixture: the recorded `active` sample (every 100th of 16 612 real records, 2026-09-30) tiled to
 * `n` rows with distinct NORAD ids. Test-only scale model, like src/lib/regression/a-payload-size.
 */
function tiledActive(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({ ...fx.active[i % fx.active.length]!, NORAD_CAT_ID: 100_000 + i }));
}

async function rawBody(rows: number): Promise<Buffer> {
  clearL1();
  resetFeeds();
  setStore(new MemoryStore());
  resetCelestrakErrors();
  const routes = celestrakRoutes();
  routes['GROUP=active&'] = tiledActive(rows);
  vi.mocked(httpJson).mockImplementation(upstreamRouter(routes).impl as never);
  const res = await GET(req('', { 'accept-encoding': 'gzip' }), undefined);
  expect(res.status).toBe(200);
  return zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
}

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

  it('labels the SatNOGS fallback in providers and the note, and lets caches re-ask within 5 min', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter({ 'GROUP=active&': netError(), 'db.satnogs.org': fx.satnogs }).impl as never);
    const res = await GET(req(), undefined);
    const body = await res.json();
    expect(SatellitesResponse.safeParse(body).success).toBe(true);
    expect(body.catalogueSource).toBe('satnogs-fallback');
    expect(body.note).toMatch(/SatNOGS/);
    expect(body.note).toMatch(/Next CelesTrak attempt after \d\d:\d\d UTC/);
    expect(body.providers.celestrak.ok).toBe(false);
    expect(body.providers['satnogs-fallback'].ok).toBe(true);
    expect(body.providers.satnogs).toBeUndefined();
    const maxAge = Number(/s-maxage=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(300);
  });

  it('meta.observedAt is never after fetchedAt (CelesTrak publishes CXO with a future epoch)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FUTURE_EPOCH_CAPTURED_AT);
    const routes = celestrakRoutes();
    routes['GROUP=active&'] = fx.futureEpoch;
    vi.mocked(httpJson).mockImplementation(upstreamRouter(routes).impl as never);
    const body = await (await GET(req(), undefined)).json();
    expect(SatellitesResponse.safeParse(body).success).toBe(true);
    expect(Date.parse(body.meta.observedAt)).toBeLessThanOrEqual(Date.parse(body.meta.fetchedAt));
    expect(body.meta.observedAt).toBe('2026-10-01T03:22:47.196Z');
    const cxo = body.rows.find((r: unknown[]) => r[COL.noradId] === 25867);
    expect(epochIso(cxo[COL.epoch])).toBe('2026-10-02T03:42:59.671Z');
  });

  it('serves epochs as integer ms (epochUnit "ms")', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter(celestrakRoutes()).impl as never);
    const body = await (await GET(req('?id=25544'), undefined)).json();
    expect(body.epochUnit).toBe('ms');
    expect(Number.isInteger(body.rows[0][COL.epoch])).toBe(true);
  });

  // perf round 4 m-a: the live catalogue (16 612 rows) used 71 % of the cap with ISO epochs.
  it('payload headroom: 20k rows stay under 80 % of the 4 MB cap and 24k rows under the cap', async () => {
    const at20k = (await rawBody(20_000)).length;
    expect(at20k / MAX_RESPONSE_BYTES).toBeLessThan(0.8);
    const at24k = await rawBody(24_000);
    expect(at24k.length).toBeLessThan(MAX_RESPONSE_BYTES);
    const parsed = SatellitesResponse.safeParse(JSON.parse(at24k.toString('utf8')));
    expect(parsed.success).toBe(true);
    // Today's size (16 612 rows) for the record: ≤ 68 % of the cap (was 71 %).
    const per = at20k / 20_000;
    expect((per * 16_612) / MAX_RESPONSE_BYTES).toBeLessThan(0.68);
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
