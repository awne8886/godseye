import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { AircraftDetailResponse, ApiError } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import adsbdb from '@/features/aviation/__fixtures__/adsbdb-aircraft-4CA1FA.json';
import traceFull from '@/features/aviation/__fixtures__/trace-full-4cafc4.json';
import traceRecent from '@/features/aviation/__fixtures__/trace-recent-4cafc4.json';

// Fixtures recorded from adsbdb and adsb.lol on 2026-09-30 (see `_captured`).
const mode = vi.hoisted(() => ({ fail: false, calls: [] as string[] }));

vi.mock('@/lib/ratelimit', async (orig) => {
  const actual = await orig<typeof RateLimitModule>();
  return { ...actual, providerBucket: () => ({ take: async () => undefined }) };
});

vi.mock('@/lib/http', async (orig) => {
  const actual = await orig<typeof HttpModule>();
  return {
    ...actual,
    httpJson: vi.fn(async (url: string) => {
      mode.calls.push(url);
      if (mode.fail) throw new actual.HttpError('timeout', 'timeout', url);
      const body = url.includes('adsbdb.com/v0/aircraft/4CAFC4')
        ? adsbdb
        : url.includes('trace_full_4cafc4')
          ? traceFull
          : url.includes('trace_recent_4cafc4')
            ? traceRecent
            : null;
      if (!body) throw new actual.HttpError('HTTP 404', 'http', url, 404);
      return { data: structuredClone(body), status: 200, ok: true, notModified: false, headers: {}, body: Buffer.alloc(0), url, etag: null, lastModified: null, ms: 1, attempts: 1 };
    }),
  };
});

const { GET } = await import('./route');
const call = (qs: string) => GET(new Request(`http://localhost/api/aircraft${qs}`), undefined);

describe('GET /api/aircraft', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime((traceRecent.timestamp + 600) * 1000);
    clearL1();
    setStore(new MemoryStore());
    mode.fail = false;
    mode.calls = [];
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('rejects a malformed icao24 with 400 before any upstream call', async () => {
    for (const bad of ['', '?icao24=xyz', '?icao24=4cafc', '?icao24=4cafc4g', '?icao24=../../etc']) {
      const res = await call(bad);
      expect(res.status, bad).toBe(400);
      expect(ApiError.safeParse(await res.json()).success).toBe(true);
    }
    expect(mode.calls).toEqual([]);
  });

  it('returns identity, the current leg and the position source', async () => {
    const res = await call('?icao24=4CAFC4');
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = AircraftDetailResponse.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
    expect(body.hex).toBe('4cafc4');
    expect(body.identity).toMatchObject({ registration: 'EI-DDH', typeCode: 'B772', operator: 'Alitalia' });
    expect(body.identity.photoThumbUrl).toMatch(/^https:\/\//);
    expect(body.identity.photoCredit).toContain('airport-data.com');
    expect(body.track.length).toBeGreaterThan(2);
    expect(body.track.length).toBeLessThanOrEqual(700);
    expect(body.trackSource).toBe('adsb_icao');
    expect(body.providers.adsbdb).toMatchObject({ ok: true, count: 1 });
    expect(body.providers.adsblol_trace.ok).toBe(true);
    expect(body.meta).toMatchObject({ feed: 'aircraft', kind: 'live' });
    expect(body.meta.observedAt).toBe(body.track.at(-1).t);
    expect(res.headers.get('cache-control')).toContain('s-maxage=120');
  });

  it('answers an unknown aircraft honestly (identity null, empty track)', async () => {
    const res = await call('?icao24=abcdef');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(AircraftDetailResponse.safeParse(body).success).toBe(true);
    expect(body.identity).toBeNull();
    expect(body.track).toEqual([]);
  });

  it('503s when every upstream fails', async () => {
    mode.fail = true;
    const res = await call('?icao24=aaaaaa');
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('source_offline');
  });
});
