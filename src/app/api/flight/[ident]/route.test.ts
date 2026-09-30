import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { ApiError, FlightDetailResponse } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { newMode, upstreamBody } from '@/features/flight-paths/__fixtures__/upstreams';
import { greatCircle } from '@/features/flight-paths/lib/geometry';
import adsbdbAircraft from '@/features/aviation/__fixtures__/adsbdb-aircraft-4CA1FA.json';
import hexdbRoute from '@/features/aviation/__fixtures__/hexdb-route-BAW117.json';
import hexdbEgll from '@/features/aviation/__fixtures__/hexdb-airport-EGLL.json';
import hexdbKjfk from '@/features/aviation/__fixtures__/hexdb-airport-KJFK.json';

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
const call = (ident: string) => GET(new Request(`http://localhost/api/flight/${ident}`), { params: Promise.resolve({ ident }) });
const parse = async (ident: string) => {
  const res = await call(ident);
  expect(res.status, ident).toBe(200);
  return FlightDetailResponse.parse(await res.json());
};

const mid = greatCircle([-0.461941, 51.4706], [-73.7781, 40.6413]).points[128]!;
const nowMs = Date.now();
const airborne = {
  ac: [{ hex: '4ca1fa', flight: 'BAW117  ', r: 'EI-DDH', t: 'B772', lat: mid[1], lon: mid[0], alt_baro: 37000, gs: 480, track: 268, baro_rate: 0, seen_pos: 2 }],
  now: nowMs,
  total: 1,
};

describe('GET /api/flight/{ident}', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
    mode.current = newMode();
  });

  it('BA117 and BAW117 resolve to the same flight (VRS route, METAR both ends, links)', async () => {
    const a = await parse('BA117');
    const b = await parse('BAW117');
    expect(a.resolved.callsign).toBe('BAW117');
    expect(a.resolved.iataFlight).toBe('BA117');
    expect(b.resolved.callsign).toBe('BAW117');
    expect(a.origin?.icao).toBe('EGLL');
    expect(b.destination?.icao).toBe('KJFK');
    expect(a.plannedArc.length).toBe(128);
    expect(a.status).toBe('unknown'); // not airborne in the recorded adsb.lol answer
    expect(a.position).toBeNull();
    expect(a.routeSource).toMatchObject({ name: 'vrs', stale: false });
    expect(a.weather.origin?.metar).toMatch(/^METAR EGLL/);
    expect(a.links.map((l) => l.label)).toEqual(['FlightAware', 'ADS-B Exchange', 'RadarBox', 'Flightradar24']);
    expect(a.links.find((l) => l.label === 'Flightradar24')?.url).toBe('https://www.flightradar24.com/data/flights/ba117');
    expect(a.providers.adsblol_callsign?.ok).toBe(true);
    expect(a.providers.route_vrs?.ok).toBe(true);
    expect(a.providers.flights?.ok).toBe(false);
    expect(a.sources.find((s) => s.name === 'live position')?.ok).toBe(false);
  });

  it('when airborne: 0 < progress < 1, ETA after now with the destination offset, remaining leg', async () => {
    mode.current.override.set('https://api.adsb.lol/v2/callsign/BAW117', airborne);
    mode.current.override.set('https://api.adsbdb.com/v0/aircraft/4CA1FA', adsbdbAircraft);
    const f = await parse('BAW117');
    expect(f.status).toBe('airborne');
    expect(f.resolved.hex).toBe('4ca1fa');
    expect(f.progress).toBeGreaterThan(0);
    expect(f.progress).toBeLessThan(1);
    expect(Date.parse(f.eta!)).toBeGreaterThan(Date.now());
    expect(f.etaLocal).toMatch(/-0[45]:00$/);
    expect(f.etaTz).toBe('America/New_York');
    expect(f.remainingLeg.length).toBe(64);
    expect(f.identity?.registration).toBe('EI-DDH');
    expect(f.position?.altFt).toBe(37000);
    expect(f.sources.find((s) => s.name === 'corroboration')).toMatchObject({ ok: true });
  });

  it('hex and registration idents', async () => {
    mode.current.override.set('https://api.adsb.lol/v2/hex/4ca1fa', airborne);
    const h = await parse('4ca1fa');
    expect(h.resolved).toMatchObject({ hex: '4ca1fa', callsign: 'BAW117' });
    mode.current.override.set('https://api.adsbdb.com/v0/aircraft/G-XWBA', { response: { aircraft: { mode_s: '406F2A', registration: 'G-XWBA' } } });
    const r = await parse('G-XWBA');
    expect(r.resolved).toMatchObject({ registration: 'G-XWBA', hex: '406f2a' });
    expect(r.providers.adsbdb_registration?.ok).toBe(true);
  });

  it('falls back to hexdb when VRS and adsbdb have nothing, labelling the 2012 record stale', async () => {
    mode.current.down.add('vrs-standing-data.adsb.lol');
    mode.current.override.set('https://api.adsbdb.com/v0/callsign/BAW117', { response: 'unknown callsign' });
    mode.current.override.set('https://hexdb.io/api/v1/route/icao/BAW117', hexdbRoute);
    mode.current.override.set('https://hexdb.io/api/v1/airport/icao/EGLL', hexdbEgll);
    mode.current.override.set('https://hexdb.io/api/v1/airport/icao/KJFK', hexdbKjfk);
    const f = await parse('BAW117');
    expect(f.routeSource).toMatchObject({ name: 'hexdb', stale: true });
    expect(f.sources.find((s) => s.name.startsWith('route'))?.detail).toMatch(/stale/);
  });

  it('400 for idents that are not flight identifiers', async () => {
    for (const bad of ['%3Cx%3E', 'A', 'TOOLONGIDENT1']) {
      const r = await call(bad);
      expect(r.status, bad).toBe(400);
      expect(ApiError.safeParse(await r.json()).success).toBe(true);
    }
  });
});
