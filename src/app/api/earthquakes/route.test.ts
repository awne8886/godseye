import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/hazards/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/hazards/server/__fixtures__/routes';
import { earthquakeFeed } from '@/features/hazards/server/usgs';
import { EarthquakesResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/hazards/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(freshCache);
afterEach(() => {
  earthquakeFeed().stop();
  earthquakeFeed('all_hour').stop();
  resetCache();
});

describe('GET /api/earthquakes', () => {
  it('serves normalised USGS quakes with meta + providers', async () => {
    state.routes = [['summary/2.5_day.geojson', FX.usgs]];
    const res = await GET(req('/api/earthquakes'), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=60/);
    const body = await res.json();
    expect(EarthquakesResponse.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(33);
    expect(body.meta).toMatchObject({ feed: 'earthquakes', kind: 'live', state: 'live', stale: false });
    expect(body.meta.observedAt).toBe(body.items[0].observedAt);
    expect(body.providers.usgs).toMatchObject({ ok: true, count: 33 });
    expect(new Set(body.items.map((q: { id: string }) => q.id)).size).toBe(33);
  });

  it('rejects an unknown feed', async () => {
    const res = await GET(req('/api/earthquakes?feed=all_year'), undefined);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('answers 503 SOURCE OFFLINE when USGS fails (never an empty list)', async () => {
    state.routes = [['summary/2.5_day.geojson', 503]];
    const res = await GET(req('/api/earthquakes'), undefined);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('source_offline');
    expect(body.meta.state).toBe('offline');
    expect(body.providers.usgs).toMatchObject({ ok: false, error: 'http_503' });
  });

  it('treats an empty day feed as a failure but an empty hour as truthful', async () => {
    const empty = Buffer.from('{"type":"FeatureCollection","features":[]}');
    state.routes = [['summary/2.5_day.geojson', empty], ['summary/all_hour.geojson', empty]];
    expect((await GET(req('/api/earthquakes'), undefined)).status).toBe(503);
    const res = await GET(req('/api/earthquakes?feed=all_hour'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(EarthquakesResponse.safeParse(body).success).toBe(true);
    expect(body.items).toEqual([]);
    expect(body.providers.usgs).toMatchObject({ ok: true, count: 0 });
  });
});
