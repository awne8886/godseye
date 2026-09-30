import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { ApiError, FlightRouteResponse } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import vrs from '@/features/aviation/__fixtures__/vrs-BAW117.json';
import adsbdbCs from '@/features/aviation/__fixtures__/adsbdb-callsign-BAW117.json';
import hexdbRoute from '@/features/aviation/__fixtures__/hexdb-route-BAW117.json';
import egll from '@/features/aviation/__fixtures__/hexdb-airport-EGLL.json';
import kjfk from '@/features/aviation/__fixtures__/hexdb-airport-KJFK.json';

// Fixtures recorded from VRS standing data, adsbdb and hexdb on 2026-09-30 (see `_captured`).
const mode = vi.hoisted(() => ({ down: new Set<string>(), calls: [] as string[] }));

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
      const host = new URL(url).hostname;
      if (mode.down.has(host)) throw new actual.HttpError('HTTP 502', 'http', url, 502);
      const table: Record<string, unknown> = {
        'https://vrs-standing-data.adsb.lol/routes/BA/BAW117.json': vrs,
        'https://api.adsbdb.com/v0/callsign/BAW117': adsbdbCs,
        'https://hexdb.io/api/v1/route/icao/BAW117': hexdbRoute,
        'https://hexdb.io/api/v1/airport/icao/EGLL': egll,
        'https://hexdb.io/api/v1/airport/icao/KJFK': kjfk,
      };
      const body = table[url];
      if (!body) throw new actual.HttpError('HTTP 404', 'http', url, 404);
      return { data: structuredClone(body), status: 200, ok: true, notModified: false, headers: {}, body: Buffer.alloc(0), url, etag: null, lastModified: host.startsWith('vrs') ? 'Sun, 20 Sep 2026 18:48:13 GMT' : null, ms: 1, attempts: 1 };
    }),
  };
});

const { GET } = await import('./route');
const call = (qs: string) => GET(new Request(`http://localhost/api/flight-route${qs}`), undefined);

describe('GET /api/flight-route', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
    mode.down = new Set();
    mode.calls = [];
  });

  it('validates the callsign and coordinates', async () => {
    for (const bad of ['', '?callsign=', '?callsign=BAW-117;', '?callsign=ABCDEFGHIJ', '?callsign=BAW117&lat=95&lng=0', '?callsign=BAW117&lat=10']) {
      const res = await call(bad);
      expect(res.status, bad).toBe(400);
      expect(ApiError.safeParse(await res.json()).success).toBe(true);
    }
  });

  it('uses VRS standing data first (trimmed, upper-cased callsign)', async () => {
    const res = await call('?callsign=%20baw117%20');
    const body = await res.json();
    expect(FlightRouteResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ callsign: 'BAW117', found: true, source: 'vrs', basis: 'schedule', status: 'unknown', stale: false });
    expect(body.origin).toMatchObject({ icao: 'EGLL', iata: 'LHR' });
    expect(body.destination).toMatchObject({ icao: 'KJFK' });
    expect(body.sourceUpdatedAt).toBe('2026-09-20T18:48:13.000Z');
    expect(body.providers.vrs.ok).toBe(true);
    expect(mode.calls.some((u) => u.includes('adsbdb'))).toBe(false);
  });

  it('reports progress on the corridor when a position is given', async () => {
    const body = await (await call('?callsign=BAW117&lat=53.5&lng=-30&speed=480')).json();
    expect(body.basis).toBe('corridor');
    expect(body.status).toBe('airborne');
    expect(body.progress).toBeGreaterThan(0.2);
    expect(body.progress).toBeLessThan(0.8);
    expect(body.distanceKm).toBeGreaterThan(5000);
  });

  it('rejects a route when the aircraft is > 1.5 × its length from both endpoints (found:false)', async () => {
    // EGLL→KJFK is ~5 540 km; the aircraft is over the south-west Pacific, > 8 300 km from both.
    const body = await (await call('?callsign=BAW117&lat=-30&lng=160&speed=450')).json();
    expect(FlightRouteResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ found: false, implausible: true, origin: null, destination: null, basis: null, progress: null });
    // Near one endpoint but off the corridor: still a (schedule-basis) route, not rejected.
    const near = await (await call('?callsign=BAW117&lat=41.9&lng=12.5&speed=450')).json();
    expect(near).toMatchObject({ found: true, basis: 'schedule' });
    expect(near.implausible).toBeUndefined();
  });

  it('falls back to adsbdb, then hexdb labelled stale with its update time', async () => {
    mode.down.add('vrs-standing-data.adsb.lol');
    const a = await (await call('?callsign=BAW117')).json();
    expect(a).toMatchObject({ found: true, source: 'adsbdb' });
    expect(a.providers.vrs).toMatchObject({ ok: false, error: 'http_502' });

    clearL1();
    setStore(new MemoryStore());
    mode.down.add('api.adsbdb.com');
    const h = await (await call('?callsign=BAW117')).json();
    expect(FlightRouteResponse.safeParse(h).success).toBe(true);
    expect(h).toMatchObject({ found: true, source: 'hexdb', stale: true, sourceUpdatedAt: '2012-04-01T18:56:03.000Z' });
    expect(h.origin.icao).toBe('EGLL');
  });

  it('answers found:false honestly when no source knows the callsign', async () => {
    const res = await call('?callsign=ZZZ999');
    const body = await res.json();
    expect(FlightRouteResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ found: false, origin: null, destination: null });
    expect(Object.keys(body.providers)).toEqual(['vrs', 'adsbdb', 'hexdb']);
  });

  it('503s when every source errors', async () => {
    mode.down = new Set(['vrs-standing-data.adsb.lol', 'api.adsbdb.com', 'hexdb.io']);
    const res = await call('?callsign=QQQ1');
    expect(res.status).toBe(503);
  });
});
