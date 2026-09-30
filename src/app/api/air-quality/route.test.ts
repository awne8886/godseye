import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, fixtureJson, type Route } from '@/features/hazards/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/hazards/server/__fixtures__/routes';
import { resetLookups } from '@/features/hazards/server/lookup';
import { AirQualityResponse } from '@/lib/schemas';
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
afterEach(() => {
  vi.unstubAllEnvs();
  resetCache();
});

describe('GET /api/air-quality', () => {
  it('serves Open-Meteo values with meta + providers and reports keyed upgrades as skipped', async () => {
    const two = Buffer.from(JSON.stringify([fixtureJson(FX.aq), { latitude: 48.8, longitude: 2.4, current: { time: '2026-09-30T18:00', pm2_5: 6.1, us_aqi: 40 } }]));
    state.routes = [['air-quality-api.open-meteo.com', two]];
    const res = await GET(req('/api/air-quality'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(AirQualityResponse.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ station: 'London', pm25: 4.8, usAqi: 32, observedAt: '2026-09-30T18:00:00.000Z' });
    expect(body.sampling).toBe('cities');
    expect(body.providers['open-meteo']).toMatchObject({ ok: true, count: 2 });
    expect(body.providers.openaq).toMatchObject({ ok: false, skipped: 'not-configured' });
    expect(body.meta).toMatchObject({ feed: 'air-quality', kind: 'live' });
    expect(body.meta.note).toMatch(/Modelled/);
  });

  it('samples a grid inside a bbox', async () => {
    state.routes = [['air-quality-api.open-meteo.com', FX.aq]];
    const body = await (await GET(req('/api/air-quality?bbox=-1,51,1,52'), undefined)).json();
    expect(body.sampling).toBe('grid');
    expect(body.items[0].station).toBeNull();
  });

  it('rejects a malformed bbox', async () => {
    expect((await GET(req('/api/air-quality?bbox=1,2,3'), undefined)).status).toBe(400);
    expect((await GET(req('/api/air-quality?bbox=-10,60,10,40'), undefined)).status).toBe(400);
  });

  it('is SOURCE OFFLINE with a licence skip on commercial deployments', async () => {
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    state.routes = [['air-quality-api.open-meteo.com', FX.aq]];
    const res = await GET(req('/api/air-quality?bbox=10,10,11,11'), undefined);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.providers['open-meteo']).toMatchObject({ ok: false, skipped: 'licence' });
  });

  it('is SOURCE OFFLINE when Open-Meteo fails', async () => {
    state.routes = [['air-quality-api.open-meteo.com', 502]];
    const res = await GET(req('/api/air-quality?bbox=20,20,21,21'), undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).providers['open-meteo']).toMatchObject({ ok: false, error: 'http_502' });
  });
});
