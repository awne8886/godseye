import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import { ApiError, FeedMeta, RouteLiveResponse } from '@/lib/schemas';
import type { FlightRecord } from '@/features/aviation/adsb';
import type { FeedResult } from '@/lib/feeds';
import type { FlightsSnapshot } from '@/features/aviation/server/sweep';
import { greatCircle } from '@/features/flight-paths/lib/geometry';
import { initialBearing } from '@/lib/geo';

const state = vi.hoisted(() => ({ result: null as unknown }));

vi.mock('@/lib/ratelimit', async (orig) => {
  const actual = await orig<typeof RateLimitModule>();
  return { ...actual, providerBucket: () => ({ take: async () => undefined }) };
});
vi.mock('@/features/aviation/feeds', () => ({ flightsFeed: { get: async () => state.result } }));

const { GET } = await import('./route');
const call = (qs: string) => GET(new Request(`http://localhost/api/route/live${qs}`), undefined);

const NOW_S = Math.round(Date.now() / 1000);
const LHR: [number, number] = [-0.461941, 51.4706];
const JFK: [number, number] = [-73.7781, 40.6413];
const path = greatCircle(LHR, JFK).points;

function rec(id: string, callsign: string | null, at: [number, number], over: Partial<FlightRecord> = {}): FlightRecord {
  return {
    id,
    callsign,
    registration: null,
    typeCode: 'B772',
    bucket: 'commercial',
    isHelicopter: false,
    onGround: false,
    lat: at[1],
    lng: at[0],
    altFt: 37000,
    altGeomFt: null,
    gsKt: 480,
    trackDeg: 280,
    vrFpm: 0,
    squawk: null,
    emergency: null,
    category: 'A5',
    nacP: null,
    dbFlags: null,
    seenAt: NOW_S - 5,
    source: 'adsblol_tiles',
    posSource: 'adsb',
    ...over,
  };
}

// Synthetic snapshot (positions computed on the LHR–JFK great circle); callsigns from the VRS table.
const records: FlightRecord[] = [
  rec('4ca1fa', 'BAW117', path[128]!, { trackDeg: 268 }), // VRS EGLL-KJFK service, mid-route
  rec('a1b2c3', 'XYZ999', path[64]!, { trackDeg: Math.round(initialBearing(path[64]!, JFK)) }), // unknown callsign flying the corridor straight at JFK
  rec('e0e0e0', 'RPA5593', path[200]!, { typeCode: 'E75L', altFt: 24300, trackDeg: Math.round(initialBearing(path[200]!, JFK)) }), // regional jet on a domestic leg: never inferred
  rec('a0a0a0', 'DAL1', path[190]!, { trackDeg: 60 }), // VRS KJFK-EGLL service heading east
  rec('b0b0b0', 'LOW1', path[100]!, { altFt: 3000 }), // too low to infer
  rec('c0c0c0', 'BAW117X', [10, 10]), // far away
  rec('d0d0d0', 'BAW115', LHR, { onGround: true, altFt: null, gsKt: 5 }), // on the ground
];

function feed(data: FlightsSnapshot | null): FeedResult<FlightsSnapshot> {
  const at = new Date().toISOString();
  return {
    data,
    meta: {
      feed: 'flights',
      kind: 'live',
      state: data ? 'live' : 'offline',
      fetchedAt: data ? at : null,
      observedAt: data ? at : null,
      lastGoodAt: data ? at : null,
      stale: !data,
      ttlSeconds: 15,
      attribution: [{ text: 'Aircraft data © adsb.lol contributors, ODbL 1.0' }],
    },
    providers: { adsblol_tiles: { ok: !!data, count: data?.records.length ?? 0, ms: 10, age_s: data ? 1 : null } },
  };
}

describe('GET /api/route/live', () => {
  beforeEach(() => {
    state.result = feed({ records } as unknown as FlightsSnapshot);
  });

  it('matched (VRS) and inferred (corridor) aircraft with progress and an offset ETA', async () => {
    const res = await call('?from=LHR&to=JFK');
    expect(res.status).toBe(200);
    const raw = await res.json();
    const body = RouteLiveResponse.parse(raw);
    expect(FeedMeta.safeParse(raw.meta).success).toBe(true);
    expect(body.providers.adsblol_tiles?.ok).toBe(true);
    expect(body.providers.vrs_routes?.count).toBeGreaterThan(600_000);
    const byCs = new Map(body.aircraft.map((a) => [a.callsign, a]));
    expect(byCs.get('BAW117')).toMatchObject({ basis: 'matched', direction: 'forward', etaTz: 'America/New_York' });
    const baw = byCs.get('BAW117')!;
    expect(baw.progress).toBeGreaterThan(0.4);
    expect(baw.progress).toBeLessThan(0.6);
    expect(Date.parse(baw.eta!)).toBeGreaterThan(Date.now());
    expect(baw.etaLocal).toMatch(/-0[45]:00$/);
    expect(byCs.get('XYZ999')).toMatchObject({ basis: 'inferred', direction: 'forward' });
    expect(byCs.has('DAL1')).toBe(false); // reverse only with reverse=1
    expect(byCs.has('LOW1')).toBe(false);
    expect(byCs.has('RPA5593')).toBe(false);
    expect(byCs.has('BAW117X')).toBe(false);
    expect(byCs.has('BAW115')).toBe(false);
    expect(body.aircraft[0]!.callsign).toBe('BAW117'); // matched before inferred
  });

  it('reverse=1 adds B → A traffic', async () => {
    const body = RouteLiveResponse.parse(await (await call('?from=EGLL&to=KJFK&reverse=1')).json());
    const dal = body.aircraft.find((a) => a.callsign === 'DAL1');
    expect(dal).toMatchObject({ basis: 'matched', direction: 'reverse', etaTz: 'Europe/London' });
  });

  it('reports partial tile coverage (first sweep after a start) instead of a complete picture', async () => {
    const tiles = [{ at: Date.now(), ok: true, count: 3 }, { at: null, ok: false, count: 0 }, { at: Date.now(), ok: false, count: 0 }];
    state.result = feed({ records: [], tiles } as unknown as FlightsSnapshot);
    const body = RouteLiveResponse.parse(await (await call('?from=LHR&to=JFK')).json());
    expect(body.aircraft).toEqual([]);
    expect(body.coverage).toEqual({ tilesRead: 1, tilesTotal: 3, complete: false });
    state.result = feed({ records, tiles: [{ at: Date.now(), ok: true, count: 9 }] } as unknown as FlightsSnapshot);
    const full = RouteLiveResponse.parse(await (await call('?from=LHR&to=JFK')).json());
    expect(full.coverage?.complete).toBe(true);
  });

  it('503 SOURCE OFFLINE when the flights feed has no snapshot', async () => {
    state.result = feed(null);
    const res = await call('?from=LHR&to=JFK');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('source_offline');
    expect(body.meta.state).toBe('offline');
  });

  it('404 unknown airport, 400 bad input', async () => {
    expect((await call('?from=ZZZZ&to=JFK')).status).toBe(404);
    for (const bad of ['', '?from=LHR', '?from=LHR&to=JFK&reverse=2', '?from=L$R&to=JFK']) {
      const r = await call(bad);
      expect(r.status, bad).toBe(400);
      expect(ApiError.safeParse(await r.json()).success).toBe(true);
    }
  });
});
