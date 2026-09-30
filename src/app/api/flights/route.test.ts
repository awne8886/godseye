import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { ApiError, FlightsResponse } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { HttpError } from '@/lib/http';
import point from '@/features/aviation/__fixtures__/adsblol-point.json';
import mil from '@/features/aviation/__fixtures__/adsblol-mil.json';
import ladd from '@/features/aviation/__fixtures__/adsblol-ladd.json';
import pia from '@/features/aviation/__fixtures__/adsblol-pia.json';

// Upstream fixtures were recorded from live probes on 2026-09-30 (see `_captured`).
const mode = vi.hoisted(() => ({ fail: false }));

vi.mock('@/lib/ratelimit', async (orig) => {
  const actual = await orig<typeof RateLimitModule>();
  return { ...actual, providerBucket: () => ({ take: async () => undefined }) };
});

vi.mock('@/lib/http', async (orig) => {
  const actual = await orig<typeof HttpModule>();
  return {
    ...actual,
    httpJson: vi.fn(async (url: string) => {
      if (mode.fail) throw new actual.HttpError('HTTP 503', 'http', url, 503);
      const body = url.includes('/v2/mil') ? mil : url.includes('/v2/ladd') ? ladd : url.includes('/v2/pia') ? pia : url.includes('/v2/point/') ? point : null;
      if (!body) throw new actual.HttpError('HTTP 404', 'http', url, 404);
      return { data: structuredClone(body), status: 200, ok: true, notModified: false, headers: {}, body: Buffer.alloc(0), url, etag: null, lastModified: null, ms: 1, attempts: 1 };
    }),
  };
});

const { GET } = await import('./route');
const { stopTileSweeper } = await import('@/features/aviation/feeds');

const call = (qs = '') => GET(new Request(`http://localhost/api/flights${qs}`), undefined);

describe('GET /api/flights', () => {
  beforeEach(() => {
    // The recorded positions are from 18:06:50Z; run the clock 5 s later so none is pruned as old.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(point.now + 5_000);
    clearL1();
    setStore(new MemoryStore());
    mode.fail = false;
    stopTileSweeper();
  });

  afterAll(() => {
    stopTileSweeper();
    vi.useRealTimers();
  });

  it('answers 503 SOURCE OFFLINE with meta + providers when every provider fails', async () => {
    mode.fail = true;
    const res = await call();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(ApiError.safeParse(body).success).toBe(true);
    expect(body.error).toBe('source_offline');
    expect(body.meta.state).toBe('offline');
    expect(body.providers.adsblol_tiles).toMatchObject({ ok: false, error: 'http_503' });
    expect(body.providers.adsblol_mil).toMatchObject({ ok: false });
    expect(body.providers.opensky).toMatchObject({ ok: false, skipped: 'not-configured' });
    expect(body.providers.adsbfi_mil).toMatchObject({ ok: false, skipped: 'licence' });
    expect(HttpError).toBeDefined();
  });

  it('serves schema-valid compact columnar rows with providers, meta and counts', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBeTruthy();
    const body = await res.json();
    const parsed = FlightsResponse.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
    expect(body.meta).toMatchObject({ feed: 'flights', kind: 'live', state: 'live' });
    expect(body.meta.observedAt).not.toBe(body.meta.fetchedAt);
    expect(body.providers.adsblol_tiles.ok).toBe(true);
    expect(body.providers.adsblol_mil.count).toBeGreaterThan(0);
    expect(body.counts.total).toBe(body.rows.length);
    expect(body.counts.noPosition).toBeGreaterThan(0); // /v2/mil + /v2/ladd rows without lat/lon
    expect(body.counts.commercial + body.counts.private + body.counts.jet + body.counts.military).toBe(body.counts.total);
    const ids = body.rows.map((r: unknown[]) => r[0]);
    expect(new Set(ids).size).toBe(ids.length); // deduped by hex
    const cs = body.fields.indexOf('callsign');
    expect(body.rows.every((r: unknown[]) => r[cs] === null || /^[A-Z0-9]{2,8}$/.test(r[cs] as string))).toBe(true);
  });

  it('filters by bucket and bbox, and rejects bad input with 400', async () => {
    const res = await call('?bucket=military');
    const body = await res.json();
    const b = body.fields.indexOf('bucket');
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((r: number[]) => r[b] === 3)).toBe(true);

    const eu = await (await call('?bbox=-10,35,30,60')).json();
    const lng = eu.fields.indexOf('lng');
    expect(eu.rows.every((r: number[]) => r[lng]! >= -10 && r[lng]! <= 30)).toBe(true);

    expect((await call('?bucket=spaceship')).status).toBe(400);
    expect((await call('?bbox=1,2,3')).status).toBe(400);
  });

  it('negotiates brotli and answers If-None-Match with 304', async () => {
    const first = await GET(new Request('http://localhost/api/flights', { headers: { 'accept-encoding': 'br' } }), undefined);
    expect(first.headers.get('content-encoding')).toBe('br');
    const etag = first.headers.get('etag')!;
    const again = await GET(new Request('http://localhost/api/flights', { headers: { 'if-none-match': etag } }), undefined);
    expect(again.status).toBe(304);
  });
});
