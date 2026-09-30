import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { resetFeeds } from '@/lib/feeds';
import { httpJson } from '@/lib/http';
import { OrbitResponse } from '@/lib/schemas';
import { celestrakRoutes, netError, upstreamRouter } from '@/features/space/__fixtures__/upstreams';
import { fx } from '@/features/space/__fixtures__';
import { resetCelestrakErrors } from '@/features/space/server/satellites';
import { ommToRecord, recordToOmm } from '@/features/space/lib/catalog';
import { propagateAt, satrecFromOmm } from '@/features/space/lib/orbit';
import { GET } from './route';

vi.mock('@/lib/http', async (orig) => ({ ...(await orig<Record<string, unknown>>()), httpJson: vi.fn() }));

const req = (qs: string) => new Request(`http://localhost/api/satellites/orbit${qs}`, { headers: { 'x-forwarded-for': '10.1.2.4' } });
const T = Date.now();

beforeEach(() => {
  clearL1();
  resetFeeds();
  setStore(new MemoryStore());
  resetCelestrakErrors();
  vi.mocked(httpJson).mockReset();
  vi.mocked(httpJson).mockImplementation(upstreamRouter(celestrakRoutes()).impl as never);
});
afterEach(() => {
  resetFeeds();
  setStore(undefined);
});

describe('GET /api/satellites/orbit', () => {
  it('returns ±½ period around t, split at the antimeridian, through the marker', async () => {
    const res = await GET(req(`?id=25544&t=${T}`), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = OrbitResponse.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
    expect(body).toMatchObject({ noradId: 25544, name: 'ISS (ZARYA)', orbitClass: 'LEO', anchoredAt: new Date(T).toISOString(), source: 'celestrak' });
    expect(body.elementsEpoch).toBe('2026-09-30T03:25:12.177Z');
    expect(body.providers.celestrak.ok).toBe(true);
    expect(body.segments.length).toBeGreaterThanOrEqual(1);
    for (const seg of body.segments as [number, number, number][][]) for (let i = 1; i < seg.length; i++) expect(Math.abs(seg[i]![0] - seg[i - 1]![0])).toBeLessThan(180);
    const sat = satrecFromOmm(recordToOmm(ommToRecord(fx.active.find((o) => o.NORAD_CAT_ID === 25544)!)!))!;
    const p = propagateAt(sat, new Date(T))!;
    const nearest = Math.min(...(body.segments as [number, number, number][][]).flat().map(([lng, lat]) => Math.hypot(lng - p.lng, lat - p.lat)));
    expect(nearest).toBeLessThan(0.1);
  });

  it('accepts norad= as an alias and a 6-digit id', async () => {
    const six = fx.active.find((o) => (o.NORAD_CAT_ID as number) > 99_999)!;
    const res = await GET(req(`?norad=${six.NORAD_CAT_ID}`), undefined);
    expect([200, 422]).toContain(res.status);
    if (res.status === 200) expect((await res.json()).noradId).toBe(six.NORAD_CAT_ID);
  });

  it('404 for an id outside the catalogue, 400 without an id', async () => {
    expect((await GET(req('?id=999998'), undefined)).status).toBe(404);
    const bad = await GET(req(''), undefined);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('invalid_request');
    expect((await GET(req('?id=abc'), undefined)).status).toBe(400);
  });

  it('503 while the catalogue is offline', async () => {
    vi.mocked(httpJson).mockImplementation(upstreamRouter({ 'GROUP=active&': netError(), 'db.satnogs.org': netError() }).impl as never);
    const res = await GET(req('?id=25544'), undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).providers).toBeDefined();
  });
});
