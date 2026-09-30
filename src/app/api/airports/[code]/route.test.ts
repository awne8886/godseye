import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { AirportDetailResponse, ApiError } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { newMode, upstreamBody } from '@/features/flight-paths/__fixtures__/upstreams';

const mode = vi.hoisted(() => ({ current: null as unknown as ReturnType<typeof newMode> }));

vi.mock('@/lib/ratelimit', async (orig) => {
  const actual = await orig<typeof RateLimitModule>();
  return { ...actual, providerBucket: () => ({ take: async () => undefined }) };
});

vi.mock('@/lib/http', async (orig) => {
  const actual = await orig<typeof HttpModule>();
  return {
    ...actual,
    httpJson: vi.fn(async (u: string | URL) => {
      const url = String(u);
      mode.current.calls.push(url);
      if (mode.current.down.has(new URL(url).hostname)) throw new actual.HttpError('HTTP 502', 'http', url, 502);
      const body = upstreamBody(url, mode.current);
      if (body === undefined) throw new actual.HttpError('HTTP 404', 'http', url, 404);
      return { data: structuredClone(body), status: 200, ok: true, notModified: false, headers: {}, body: Buffer.alloc(0), url, etag: null, lastModified: null, ms: 1, attempts: 1 };
    }),
  };
});

const detail = (await import('./route')).GET;
const get = (code: string) => detail(new Request(`http://localhost/api/airports/${code}`), { params: Promise.resolve({ code }) });

describe('GET /api/airports/{code}', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
    mode.current = newMode();
  });

  it('record, runways, METAR/TAF with observation time, local time with offset', async () => {
    const res = await get('EGLL');
    expect(res.status).toBe(200);
    const body = AirportDetailResponse.parse(await res.json());
    expect(body.airport.iata).toBe('LHR');
    expect(body.runways.length).toBeGreaterThanOrEqual(2);
    expect(body.runways.some((r) => r.leIdent === '09L' || r.heIdent === '27R')).toBe(true);
    expect(body.weather.metar).toMatch(/^METAR EGLL/);
    expect(body.weather.taf).toMatch(/^TAF EGLL/);
    expect(body.weather.observedAt).toBe('2026-09-30T19:50:00.000Z');
    expect(body.localTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(body.providers.ourairports?.ok).toBe(true);
    expect(body.providers.awc_metar?.ok).toBe(true);
  });

  it('404 {error} for ZZZZ; 400 for junk', async () => {
    const r = await get('ZZZZ');
    expect(r.status).toBe(404);
    expect(ApiError.parse(await r.json()).error).toBe('not_found');
    const bad = await get('%3Cscript%3E');
    expect(bad.status).toBe(400);
  });

  it('AWC over quota ({error} in a 200 body) is reported as a failure', async () => {
    mode.current.override.set('https://aviationweather.gov/*', { error: { code: 429 } });
    const body = AirportDetailResponse.parse(await (await get('KJFK')).json());
    expect(body.weather.metar).toBeNull();
    expect(body.providers.awc_metar?.ok).toBe(false);
  });
});
