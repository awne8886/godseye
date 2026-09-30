import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { AirportDetailResponse, AirportSearchResponse, ApiError } from '@/lib/schemas';
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

const search = (await import('./route')).GET;
const detail = (await import('../[code]/route')).GET;
const find = async (qs: string) => {
  const res = await search(new Request(`http://localhost/api/airports/search${qs}`), undefined);
  return { res, body: res.status === 200 ? AirportSearchResponse.parse(await res.json()) : null };
};
const get = (code: string) => detail(new Request(`http://localhost/api/airports/${code}`), { params: Promise.resolve({ code }) });

describe('GET /api/airports/search', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
    mode.current = newMode();
  });

  it('exact IATA, ICAO and ident matches come first', async () => {
    const lhr = (await find('?q=LHR')).body!;
    expect(lhr.results[0]).toMatchObject({ iata: 'LHR', icao: 'EGLL', matchedBy: 'iata', tz: 'Europe/London', scheduledService: true });
    expect((await find('?q=kjfk')).body!.results[0]).toMatchObject({ iata: 'JFK', matchedBy: 'icao' });
    expect(lhr.providers.ourairports?.ok).toBe(true);
    expect(lhr.timestamp).toMatch(/Z$/);
  });

  it('London → the metro group LHR/LGW/STN/LTN/LCY/SEN; New York → JFK/EWR/LGA', async () => {
    const london = (await find('?q=London')).body!;
    expect(london.metro).toEqual({ name: 'London', codes: ['LHR', 'LGW', 'STN', 'LTN', 'LCY', 'SEN'] });
    expect(london.results.map((r) => r.matchedBy)).toEqual(Array(6).fill('metro'));
    expect((await find('?q=New%20York')).body!.metro?.codes).toEqual(['JFK', 'EWR', 'LGA']);
    expect((await find('?q=tokyo')).body!.metro?.codes).toEqual(['HND', 'NRT']);
  });

  it('fuzzy names rank scheduled large airports first, typo-tolerant, fast', async () => {
    const t0 = performance.now();
    await find('?q=heathrow'); // warm the index
    const t1 = performance.now();
    const { body } = await find('?q=heathrow');
    expect(performance.now() - t1).toBeLessThan(80);
    expect(body!.results[0]?.iata).toBe('LHR');
    expect(t1 - t0).toBeLessThan(5000);
    expect((await find('?q=schiphol')).body!.results[0]?.iata).toBe('AMS');
    expect((await find('?q=frankfurt')).body!.results[0]?.iata).toBe('FRA');
    expect(mode.current.calls).toEqual([]); // local index only
  });

  it('all=1 finds small airfields that the default index leaves out', async () => {
    const small = await find('?q=Lowell%20Field&all=1');
    expect(small.body!.results.some((r) => r.ident === '00AK' && r.type === 'small_airport')).toBe(true);
    const def = await find('?q=00AK');
    expect(def.body!.results.some((r) => r.ident === '00AK')).toBe(false);
    expect((await find('?q=00AK&all=1')).body!.results[0]).toMatchObject({ ident: '00AK', matchedBy: 'ident' });
  });

  it('unknown places fall back to Photon (aerodrome, re-ranked locally); Nominatim only on submit', async () => {
    mode.current.override.set('https://photon.komoot.io/api/?q=zzqqxx*', { type: 'FeatureCollection', features: [] });
    const none = await find('?q=zzqqxx');
    expect(none.body!.results).toEqual([]);
    expect(none.body!.providers.photon?.ok).toBe(true);
    expect(mode.current.calls.some((c) => c.includes('nominatim'))).toBe(false);
    // The recorded Photon answer for an aerodrome query is Heathrow → the local LHR record.
    const viaPhoton = await find('?q=qqheathrowairfieldqq');
    expect(viaPhoton.body!.results[0]).toMatchObject({ iata: 'LHR', matchedBy: 'photon' });
    mode.current.down.add('photon.komoot.io');
    const down = await find('?q=zzqqyy&submit=1');
    expect(down.body!.providers.photon?.ok).toBe(false);
    expect(down.body!.providers.nominatim).toBeDefined();
  });

  it('400 on missing or oversized q', async () => {
    for (const bad of ['', '?q=', `?q=${'x'.repeat(81)}`, '?q=LHR&all=maybe']) {
      const { res } = await find(bad);
      expect(res.status, bad).toBe(400);
      expect(ApiError.safeParse(await res.json()).success).toBe(true);
    }
  });
});

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
