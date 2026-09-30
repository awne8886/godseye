import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/hazards/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/hazards/server/__fixtures__/routes';
import { resetZoneCache } from '@/features/hazards/server/nws-zones';
import { weatherFeed } from '@/features/hazards/server/weather';
import { WeatherResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/hazards/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  freshCache();
  resetZoneCache();
});
afterEach(() => {
  weatherFeed.stop();
  resetCache();
});

const ALL: Route[] = [
  ['eonet.gsfc.nasa.gov', FX.eonet],
  ['api.weather.gov/alerts/active', FX.nws],
  ['api.weather.gov/zones/county/ILC007', FX.zone],
  ['gdacsapi/api/events/geteventlist/SEARCH', FX.gdacs],
  ['nhc.noaa.gov/CurrentStorms.json', FX.nhc],
  ['NHC_tropical_weather/MapServer/60/query', FX.cone],
  ['volcano.si.edu', FX.gvp],
];

describe('GET /api/weather', () => {
  it('merges EONET, NWS (+zone geometry), GDACS, NHC (+cone) and GVP', async () => {
    state.routes = ALL;
    const res = await GET(req('/api/weather'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = WeatherResponse.safeParse(body);
    expect(parsed.success).toBe(true);
    const providers = new Set(body.items.map((e: { provider: string }) => e.provider));
    expect(providers).toEqual(new Set(['NASA EONET', 'NOAA/NWS', 'GDACS', 'NHC', 'Smithsonian GVP']));
    for (const k of ['eonet', 'nws', 'gdacs', 'nhc', 'gvp']) expect(body.providers[k].ok).toBe(true);
    expect(body.providers.nhc_cones).toMatchObject({ ok: true, count: 1 });
    const hanna = body.items.find((e: { id: string }) => e.id === 'nhc-al082026');
    expect(hanna.geometry.type).toBe('Polygon');
    const zoned = body.items.filter((e: { positionBasis?: string }) => e.positionBasis === 'zone-centroid');
    expect(zoned.length).toBeGreaterThan(0);
    expect(body.unplacedAlerts).toBeGreaterThanOrEqual(0);
    expect(new Set(body.items.map((e: { id: string }) => e.id)).size).toBe(body.items.length);
    expect(body.meta).toMatchObject({ feed: 'weather', kind: 'live' });
    expect(JSON.stringify(body).length).toBeLessThan(4 * 1024 * 1024);
  });

  it('reports "no active storms" as a truthful empty NHC answer', async () => {
    state.routes = ALL.map(([k, v]) => [k, k.includes('CurrentStorms') ? Buffer.from('{"activeStorms":[]}') : v]);
    const body = await (await GET(req('/api/weather'), undefined)).json();
    expect(body.providers.nhc).toMatchObject({ ok: true, count: 0 });
    expect(body.items.some((e: { provider: string }) => e.provider === 'NHC')).toBe(false);
  });

  it('keeps other providers when one fails', async () => {
    state.routes = ALL.map(([k, v]) => [k, k.includes('gdacs') ? 500 : v]);
    const body = await (await GET(req('/api/weather'), undefined)).json();
    expect(body.providers.gdacs).toMatchObject({ ok: false, error: 'http_500' });
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('is SOURCE OFFLINE when every provider fails, even if NHC says "no storms"', async () => {
    state.routes = [['nhc.noaa.gov/CurrentStorms.json', Buffer.from('{"activeStorms":[]}')]];
    const res = await GET(req('/api/weather'), undefined);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('source_offline');
    expect(body.providers.nws.ok).toBe(false);
  });
});
