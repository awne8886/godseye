import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { frontlinesFeed } from '@/features/threats/server/frontlines';
import { FrontlinesResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(freshCache);
afterEach(() => {
  frontlinesFeed.stop();
  resetCache();
  delete process.env.NONCOMMERCIAL;
});

// Shape of `api/history/last` (only a HEAD was probed on 2026-09-30, per the licence: no bulk copy).
const snapshot = { id: 1790798080, createdAt: '2026-09-30T19:54:40.000Z', map: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[37, 48], [38, 48], [38, 49], [37, 48]]] }, properties: { name: 'Area' } }] } };

describe('GET /api/frontlines', () => {
  it('is licence-gated (403) unless NONCOMMERCIAL=true', async () => {
    const res = await GET(req('/api/frontlines'), undefined);
    expect(res.status).toBe(403);
    expect((await res.json()).providers.deepstate.skipped).toBe('licence');
  });

  it('serves the snapshot with asOf and attribution when allowed', async () => {
    process.env.NONCOMMERCIAL = 'true';
    state.routes = [['deepstatemap.live/api/history/last', Buffer.from(JSON.stringify(snapshot))]];
    const res = await GET(req('/api/frontlines'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(FrontlinesResponse.safeParse(body).success).toBe(true);
    expect(body.asOf).toBe('2026-09-30T19:54:40.000Z');
    expect(body.geojson.features).toHaveLength(1);
    expect(body.meta.attribution[0].text).toMatch(/DeepStateMap/);
    expect(body.providers.deepstate.ok).toBe(true);
  });
});
