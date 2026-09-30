import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/hazards/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/hazards/server/__fixtures__/routes';
import { resetLookups } from '@/features/hazards/server/lookup';
import { SentinelResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/hazards/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  freshCache();
  resetLookups();
});
afterEach(resetCache);

describe('GET /api/sentinel', () => {
  it('maps CDSE STAC scenes with zipper quicklooks', async () => {
    state.routes = [['stac.dataspace.copernicus.eu/v1/search', FX.stac]];
    const res = await GET(req('/api/sentinel?lat=51.5&lng=-0.1'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(SentinelResponse.safeParse(body).success).toBe(true);
    expect(body.center).toEqual([-0.1, 51.5]);
    expect(body.items[0].thumbnailUrl).toMatch(/^https:\/\/zipper\.creodias\.eu\//);
    expect(body.providers.cdse_stac).toMatchObject({ ok: true, count: 1 });
    expect(body.meta).toMatchObject({ feed: 'sentinel', kind: 'live', observedAt: '2026-09-29T10:58:31.024Z' });
  });

  it('validates coordinates and limits', async () => {
    expect((await GET(req('/api/sentinel?lat=95&lng=0'), undefined)).status).toBe(400);
    expect((await GET(req('/api/sentinel?lng=0'), undefined)).status).toBe(400);
    expect((await GET(req('/api/sentinel?lat=1&lng=1&radiusKm=500'), undefined)).status).toBe(400);
    expect((await GET(req('/api/sentinel?lat=1&lng=1&days=90'), undefined)).status).toBe(400);
  });

  it('treats "no scene in the window" as truthful and a failure as SOURCE OFFLINE', async () => {
    state.routes = [['stac.dataspace.copernicus.eu', Buffer.from('{"type":"FeatureCollection","features":[]}')]];
    const ok = await GET(req('/api/sentinel?lat=-80&lng=10&days=1'), undefined);
    expect(ok.status).toBe(200);
    expect((await ok.json()).items).toEqual([]);
    state.routes = [['stac.dataspace.copernicus.eu', 502]];
    const bad = await GET(req('/api/sentinel?lat=10&lng=10'), undefined);
    expect(bad.status).toBe(503);
    expect((await bad.json()).providers.cdse_stac).toMatchObject({ ok: false, error: 'http_502' });
  });
});
