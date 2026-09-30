import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { countryRiskFeed } from '@/features/threats/server/country-risk';
import { CountryRiskResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(freshCache);
afterEach(() => {
  countryRiskFeed.stop();
  resetCache();
});

describe('GET /api/country-risk', () => {
  it('joins INFORM and WGI by ISO3 and states the method', async () => {
    state.routes = [['Workflows/GetByYear', FX.informWf], ['countries/Scores', FX.inform], ['GOV_WGI_PV.EST', FX.wgi]];
    const res = await GET(req('/api/country-risk'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(CountryRiskResponse.safeParse(body).success).toBe(true);
    expect(body.items.length).toBeGreaterThan(150);
    expect(body.items.every((r: { method: string }) => r.method.startsWith('Score = INFORM'))).toBe(true);
    expect(body.providers.inform.ok).toBe(true);
    expect(body.providers.worldbank_wgi.ok).toBe(true);
    expect(body.meta).toMatchObject({ feed: 'country-risk', kind: 'reference' });
  });

  it('keeps serving INFORM when WGI fails, and is offline only when both fail', async () => {
    state.routes = [['Workflows/GetByYear', FX.informWf], ['countries/Scores', FX.inform], ['GOV_WGI_PV.EST', 500]];
    const body = await (await GET(req('/api/country-risk'), undefined)).json();
    expect(body.providers.worldbank_wgi.ok).toBe(false);
    expect(body.items.find((r: { iso3: string }) => r.iso3 === 'AFG').components.wgi_pv).toBeNull();
    countryRiskFeed.stop();
    resetCache();
    freshCache();
    state.routes = [['drmkc.jrc.ec.europa.eu', 500], ['api.worldbank.org', 500]];
    expect((await GET(req('/api/country-risk'), undefined)).status).toBe(503);
  });
});
