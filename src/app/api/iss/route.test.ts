import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { resetFeeds } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { IssResponse } from '@/lib/schemas';
import { celestrakRoutes, netError, upstreamRouter } from '@/features/space/__fixtures__/upstreams';
import { fx } from '@/features/space/__fixtures__';
import { resetCelestrakErrors } from '@/features/space/server/satellites';
import { satellitesFeed } from '@/features/space/feeds';
import { parseTleEpoch, parseWhereTheIss, runIss, type IssPosition } from '@/features/space/server/iss';
import { GET } from './route';

vi.mock('@/lib/http', async (orig) => ({ ...(await orig<Record<string, unknown>>()), httpJson: vi.fn() }));

const req = () => new Request('http://localhost/api/iss', { headers: { 'x-forwarded-for': '10.1.2.6' } });

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
});

describe('GET /api/iss', () => {
  it('serves the wheretheiss.at position with its own timestamp as observedAt', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter({ 'wheretheiss.at': fx.iss, 'celestrak.org': netError(), 'db.satnogs.org': netError() }).impl as never);
    const res = await GET(req(), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = IssResponse.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
    expect(body).toMatchObject({ lat: 3.7030581133835, lng: 33.540436919632, visibility: 'eclipsed' });
    expect(body.meta.observedAt).toBe(new Date(1790791602 * 1000).toISOString());
    expect(body.meta.fetchedAt).not.toBe(body.meta.observedAt);
    expect(body.providers.wheretheiss).toMatchObject({ ok: true, count: 1 });
    expect(body.groundTrack).toBeNull(); // catalogue not loaded: no invented track
  });

  it('adds a ground track propagated from NORAD 25544 elements once the catalogue is loaded', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter({ 'wheretheiss.at': fx.iss, ...celestrakRoutes() }).impl as never);
    await satellitesFeed.get();
    const body = await (await GET(req(), undefined)).json();
    expect(IssResponse.safeParse(body).success).toBe(true);
    expect(body.groundTrack).toMatchObject({ elementsEpoch: '2026-09-30T03:25:12.177Z', source: 'celestrak' });
    const pts = (body.groundTrack.segments as unknown[][]).flat();
    expect(pts.length).toBeGreaterThan(100);
  });

  it('503 SOURCE OFFLINE when wheretheiss.at fails', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter({ 'wheretheiss.at': netError('https://api.wheretheiss.at/') }).impl as never);
    const res = await GET(req(), undefined);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.meta.state).toBe('offline');
    expect(body.providers).toBeDefined();
  });

  // Verification round 7 (MINOR, honesty): the readout was badged LIVE although wheretheiss.at
  // computes the position from a TLE, and meta.observedAt could be later than fetchedAt.
  it('labels the position as computed from a named TLE epoch, never as an observation', async () => {
    const r = upstreamRouter({ '25544/tles': fx.issTles, 'wheretheiss.at': fx.iss, 'celestrak.org': netError(), 'db.satnogs.org': netError() });
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    const body = await (await GET(req(), undefined)).json();
    expect(IssResponse.safeParse(body).success).toBe(true);
    expect(body.position).toEqual({ method: 'propagated', by: 'wheretheiss.at', elementsEpoch: '2026-09-30T20:27:19.352Z' });
    expect(body.meta.note).toMatch(/computed .*not observed/i);
    expect(body.providers['wheretheiss-tles']).toMatchObject({ ok: true, count: 1 });
    expect(r.calls).toContain('https://api.wheretheiss.at/v1/satellites/25544/tles');
  });

  it('serves the position with elementsEpoch null (not invented) when /tles fails', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter({ '25544/tles': netError('https://api.wheretheiss.at/'), 'wheretheiss.at': fx.iss, 'celestrak.org': netError(), 'db.satnogs.org': netError() }).impl as never);
    const res = await GET(req(), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.position).toEqual({ method: 'propagated', by: 'wheretheiss.at', elementsEpoch: null });
    expect(body.providers['wheretheiss-tles']).toMatchObject({ ok: false });
  });

  it('never reports observedAt later than fetchedAt (upstream stamps a second ahead)', async () => {
    const ahead = { ...(fx.iss as Record<string, unknown>), timestamp: Math.ceil(Date.now() / 1000) + 3 };
    vi.mocked(httpJson).mockImplementation(upstreamRouter({ '25544/tles': fx.issTles, 'wheretheiss.at': ahead, 'celestrak.org': netError(), 'db.satnogs.org': netError() }).impl as never);
    const body = await (await GET(req(), undefined)).json();
    expect(Date.parse(body.meta.observedAt)).toBeLessThanOrEqual(Date.parse(body.meta.fetchedAt));
  });

  it('reads the TLE epoch from line 1, falls back to tle_timestamp, rejects other objects', () => {
    expect(new Date(parseTleEpoch(fx.issTles)!).toISOString()).toBe('2026-09-30T20:27:19.352Z');
    expect(parseTleEpoch({ id: '25544', line1: 'garbage', tle_timestamp: 1790800039 })).toBe(1790800039_000);
    expect(parseTleEpoch({ ...(fx.issTles as Record<string, unknown>), id: '20580' })).toBeNull();
    expect(parseTleEpoch({ id: '25544' })).toBeNull();
    expect(parseTleEpoch(null)).toBeNull();
  });

  it('re-reads /tles hourly, reporting the re-used answer with its age', async () => {
    const r = upstreamRouter({ '25544/tles': fx.issTles, 'wheretheiss.at': fx.iss });
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    const ctx = (previous: IssPosition | null) => ({ previous, etag: null, lastModified: null, signal: new AbortController().signal });
    const first = await runIss(ctx(null));
    const second = await runIss(ctx(first.data));
    expect(r.calls.filter((u) => u.endsWith('/tles'))).toHaveLength(1);
    expect(second.data.elementsEpochMs).toBe(first.data.elementsEpochMs);
    expect(second.providers['wheretheiss-tles']).toMatchObject({ status: { ok: true }, okAt: first.data.elementsFetchedAtMs });
    const old = { ...first.data, elementsFetchedAtMs: Date.now() - 61 * 60_000 };
    await runIss(ctx(old));
    expect(r.calls.filter((u) => u.endsWith('/tles'))).toHaveLength(2);
  });

  it('rejects malformed positions rather than serving them', () => {
    expect(parseWhereTheIss({ latitude: 95, longitude: 0, altitude: 420, velocity: 27_000, timestamp: 1 })).toBeNull();
    expect(parseWhereTheIss({ latitude: 1, longitude: 2, altitude: 420, velocity: 27_000, timestamp: 1, units: 'miles' })).toBeNull();
    expect(parseWhereTheIss(null)).toBeNull();
  });
});
