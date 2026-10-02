import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { AirportSearchResponse, ApiError } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { newMode, upstreamBody } from '@/features/flight-paths/__fixtures__/upstreams';
import photonGlastonbury from '@/features/flight-paths/__fixtures__/photon-place-Glastonbury.json';
import photonAeroZermatt from '@/features/flight-paths/__fixtures__/r6/photon-aerodrome-Zermatt.json';
import photonPlaceZermatt from '@/features/flight-paths/__fixtures__/r6/photon-place-Zermatt.json';
import { reRankAerodromes } from '@/features/flight-paths/server/airports';

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
const find = async (qs: string) => {
  const res = await search(new Request(`http://localhost/api/airports/search${qs}`), undefined);
  return { res, body: res.status === 200 ? AirportSearchResponse.parse(await res.json()) : null };
};

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
    // The recorded Photon aerodrome answer is Heathrow; round 6: for text that Heathrow does not
    // carry it is a fuzzy guess, never a result (the kept case is the reRankAerodromes test below).
    const viaPhoton = await find('?q=qqheathrowairfieldqq');
    expect(viaPhoton.body!.results).toEqual([]);
    expect(viaPhoton.body!.providers.photon?.ok).toBe(true);
    mode.current.down.add('photon.komoot.io');
    const down = await find('?q=zzqqyy&submit=1');
    expect(down.body!.providers.photon?.ok).toBe(false);
    expect(down.body!.providers.nominatim).toBeDefined();
  });

  it('R4 m7: a geocoded place fallback names the place, its country and source, and each distance', async () => {
    // Recorded Photon answer for the free-text place "Glastonbury" (a town, no airport by that name).
    mode.current.override.set('https://photon.komoot.io/api/?q=Glastonbury*', photonGlastonbury.body);
    const r = (await find('?q=Glastonbury')).body!;
    expect(r.place).toEqual({ name: 'Glastonbury', country: 'United Kingdom', lat: 51.14804, lng: -2.716577, source: 'photon' });
    expect(r.results.length).toBeGreaterThan(0);
    for (const m of r.results) {
      expect(m.matchedBy).toBe('photon');
      expect(m.distanceKm).toBeGreaterThanOrEqual(0);
      expect(m.distanceKm).toBeLessThanOrEqual(150);
    }
    const km = r.results.map((m) => m.distanceKm!);
    expect([...km].sort((x, y) => x - y)).toEqual(km);
    // Code/name matches carry no place.
    expect((await find('?q=LHR')).body!.place).toBeUndefined();
  });

  it('R6: a fuzzy Photon aerodrome hit without the typed name is dropped; the place fallback answers', async () => {
    // Recorded: Photon's aerodrome search for "Zermatt" returns only In-Amenas Zarzaitine (Algeria).
    mode.current.override.set(photonAeroZermatt._url, photonAeroZermatt.body);
    mode.current.override.set(photonPlaceZermatt._url, photonPlaceZermatt.body);
    const r = (await find('?q=Zermatt')).body!;
    expect(r.results.some((m) => m.ident === 'DAUZ' || m.isoCountry === 'DZ')).toBe(false);
    expect(r.place).toMatchObject({ name: 'Zermatt', source: 'photon' });
    expect(r.results.length).toBeGreaterThan(0);
    for (const m of r.results) {
      expect(m.isoCountry === 'CH' || m.isoCountry === 'IT' || m.isoCountry === 'FR').toBe(true);
      expect(m.distanceKm).toBeLessThanOrEqual(150);
      expect(m.osmName).toBeUndefined();
    }
  });

  it('R6: a Photon aerodrome hit that carries the typed name is kept and discloses its OSM name', async () => {
    const heathrowAero = (await import('@/features/flight-paths/__fixtures__/photon-heathrow-aerodrome.json')).body as { features: { properties: { name: string } }[] };
    const name = heathrowAero.features[0]!.properties.name;
    const m = reRankAerodromes(
      [{ name, label: 'London, England, United Kingdom', lat: 51.4680, lng: -0.4551, kind: 'aerodrome', countryCode: 'GB', bbox: null, source: 'photon' }],
      'Heathrow',
    );
    expect(m[0]).toMatchObject({ iata: 'LHR', matchedBy: 'photon', osmName: name });
    // The same hit for unrelated text is not an answer.
    expect(reRankAerodromes([{ name: 'In-Amenas Zarzaitine Airport', label: 'In Amenas, Illizi, Algeria', lat: 28.0554, lng: 9.644, kind: 'aerodrome', countryCode: 'DZ', bbox: null, source: 'photon' }], 'Zermatt')).toEqual([]);
  });

  it('SSRF: user text only ever reaches the fixed geocoder hosts, as a query parameter', async () => {
    for (const q of ['http://169.254.169.254/latest', 'localhost:8080', '10.0.0.1', 'file:///etc/passwd']) await find(`?q=${encodeURIComponent(q)}&submit=1`);
    const hosts = new Set(mode.current.calls.map((c) => new URL(c).hostname));
    for (const h of hosts) expect(['photon.komoot.io', 'nominatim.openstreetmap.org']).toContain(h);
  });

  it('400 on missing or oversized q', async () => {
    for (const bad of ['', '?q=', `?q=${'x'.repeat(81)}`, '?q=LHR&all=maybe']) {
      const { res } = await find(bad);
      expect(res.status, bad).toBe(400);
      expect(ApiError.safeParse(await res.json()).success).toBe(true);
    }
  });
});
