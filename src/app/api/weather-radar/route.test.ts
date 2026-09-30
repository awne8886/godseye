import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/hazards/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/hazards/server/__fixtures__/routes';
import { radarFeed } from '@/features/hazards/server/radar';
import { RadarFramesResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/hazards/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(freshCache);
afterEach(() => {
  radarFeed.stop();
  resetCache();
});

describe('GET /api/weather-radar', () => {
  it('lists RainViewer past frames (max zoom 7, no nowcast)', async () => {
    state.routes = [['api.rainviewer.com/public/weather-maps.json', FX.radar]];
    const res = await GET(req('/api/weather-radar'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(RadarFramesResponse.safeParse(body).success).toBe(true);
    expect(body.host).toBe('https://tilecache.rainviewer.com');
    expect(body.maxZoom).toBe(7);
    expect(body.frames).toHaveLength(13);
    expect(body.providers.rainviewer).toMatchObject({ ok: true, count: 13 });
    expect(body.meta.observedAt).toBe(body.frames.at(-1).time);
  });

  it('is SOURCE OFFLINE when RainViewer fails', async () => {
    state.routes = [['api.rainviewer.com', 429]];
    const res = await GET(req('/api/weather-radar'), undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).providers.rainviewer).toMatchObject({ ok: false, error: 'http_429' });
  });
});
