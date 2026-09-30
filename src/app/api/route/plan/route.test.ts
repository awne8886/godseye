import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { ApiError, RoutePlanResponse } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { newMode, upstreamBody } from '@/features/flight-paths/__fixtures__/upstreams';
import { resetWinds } from '@/features/flight-paths/server/winds';

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

const { GET } = await import('./route');
const call = (qs: string) => GET(new Request(`http://localhost/api/route/plan${qs}`), undefined);

describe('GET /api/route/plan', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
    resetWinds();
    mode.current = newMode();
    delete process.env.COMMERCIAL_DEPLOYMENT;
  });

  it('EGLL → KJFK matches the §8 shape: arc, 5,540 ± 30 km, 288 ± 2°, services, METAR both ends', async () => {
    const res = await call('?from=EGLL&to=KJFK');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=300/);
    const body = RoutePlanResponse.parse(await res.json());
    expect(body.origin.iata).toBe('LHR');
    expect(body.destination.iata).toBe('JFK');
    expect(body.greatCircle.points.length).toBeGreaterThanOrEqual(128);
    expect(Math.abs(body.greatCircle.distanceKm - 5540)).toBeLessThanOrEqual(30);
    expect(Math.abs(body.greatCircle.initialBearing - 288)).toBeLessThanOrEqual(2);
    expect(body.knownServices.length).toBeGreaterThanOrEqual(3);
    expect(body.knownServices.map((s) => s.callsign)).toContain('BAW117');
    const baw = body.knownServices.find((s) => s.callsign === 'BAW117')!;
    expect(baw.airline).toMatchObject({ icao: 'BAW', iata: 'BA', name: 'British Airways' });
    expect(baw.live).toBe(false); // no flights snapshot in this process
    expect(body.weather.origin.metar).toMatch(/^METAR EGLL/);
    expect(body.weather.destination.metar).toMatch(/^METAR KJFK/);
    expect(body.weather.origin.observedAt).not.toBeNull();
    expect(body.weather.windsAloft).toHaveLength(8);
    expect(body.weather.windsAloft[0]).toMatchObject({ level: '250hPa', speedKt: 48.9, dirDeg: 277 });
    expect(body.estimates.byClass.widebody.cruiseKts).toBe(480);
    expect(body.estimates.method).toMatch(/\+ 30 min/);
    expect(body.timezones.origin.tz).toBe('Europe/London');
    expect(body.timezones.destination.tz).toBe('America/New_York');
    expect(body.timezones.origin.localNow).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(body.timezones.offsetHours).toBe(-5);
    expect(body.daylight).toHaveLength(10);
    expect(body.pathLabels).toEqual(['GREAT-CIRCLE ESTIMATE']);
    expect(body.historicalRoutes.length).toBeGreaterThan(0);
    expect(body.diversionAirports.length).toBeGreaterThan(0);
    for (const d of body.diversionAirports) expect(d.runwayM).toBeGreaterThanOrEqual(2400);
    expect(body.providers.ourairports?.ok).toBe(true);
    expect(body.providers.vrs_routes?.count).toBe(body.knownServices.length);
    expect(body.providers.awc_metar?.ok).toBe(true);
    expect(body.providers.openmeteo?.ok).toBe(true);
    expect(body.providers.fpdb?.skipped).toBe('not-configured');
    expect(body.providers.flights?.ok).toBe(false);
    // One multi-coordinate Open-Meteo request, then served from the 1 h grid cache.
    expect(mode.current.calls.filter((c) => c.includes('open-meteo'))).toHaveLength(1);
    await call('?from=EGLL&to=KJFK');
    expect(mode.current.calls.filter((c) => c.includes('open-meteo'))).toHaveLength(1);
  });

  it('accepts IATA codes and lists the reverse services (AAL100, DAL1 fly JFK → LHR)', async () => {
    const body = RoutePlanResponse.parse(await (await call('?from=jfk&to=lhr')).json());
    const cs = body.knownServices.map((s) => s.callsign);
    expect(cs).toEqual(expect.arrayContaining(['AAL100', 'DAL1']));
  });

  it('antimeridian routes stay continuous (NRT → LAX, SYD → SCL, AKL → EZE)', async () => {
    for (const [a, b] of [['NRT', 'LAX'], ['SYD', 'SCL'], ['AKL', 'EZE']]) {
      const body = RoutePlanResponse.parse(await (await call(`?from=${a}&to=${b}`)).json());
      const pts = body.greatCircle.points;
      for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i]![0] - pts[i - 1]![0])).toBeLessThan(10);
      expect(body.greatCircle.antimeridianCrossings).toBe(1);
      expect(body.greatCircle.multiLineString.coordinates.length).toBe(2);
    }
  });

  it('SVO → LAX is polar', async () => {
    const body = RoutePlanResponse.parse(await (await call('?from=SVO&to=LAX')).json());
    expect(body.greatCircle.polar).toBe(true);
  });

  it('winds are skipped for licence on commercial deployments; AWC failures stay honest', async () => {
    process.env.COMMERCIAL_DEPLOYMENT = 'true';
    mode.current.down.add('aviationweather.gov');
    const body = RoutePlanResponse.parse(await (await call('?from=LHR&to=CDG')).json());
    expect(body.providers.openmeteo?.skipped).toBe('licence');
    expect(body.weather.windsAloft).toEqual([]);
    expect(body.providers.awc_metar?.ok).toBe(false);
    expect(body.weather.origin.metar).toBeNull();
    expect(mode.current.calls.some((c) => c.includes('open-meteo'))).toBe(false);
  });

  it('404 for an unknown airport, 400 for bad input', async () => {
    const r404 = await call('?from=ZZZZ&to=KJFK');
    expect(r404.status).toBe(404);
    expect(ApiError.parse(await r404.json()).error).toBe('not_found');
    for (const bad of ['', '?from=EGLL', '?from=EG LL&to=KJFK', '?from=<x>&to=KJFK', '?from=EGLL&to=EGLL', '?from=LHR&to=EGLL']) {
      const r = await call(bad);
      expect(r.status, bad).toBe(400);
      expect(ApiError.safeParse(await r.json()).success).toBe(true);
    }
  });
});
