import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRiskGeometry } from '@/features/threats/client/risk-geometry';
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

  // R3 round-4 MINOR-8: the rail counted every row (207 live) while only 166 outlines were drawn.
  it('draws every scored row (outline or label point); the count is what is drawn, and says why the rest is not', async () => {
    state.routes = [['Workflows/GetByYear', FX.informWf], ['countries/Scores', FX.inform], ['GOV_WGI_PV.EST', FX.wgi]];
    const body = await (await GET(req('/api/country-risk'), undefined)).json();
    expect(CountryRiskResponse.safeParse(body).success).toBe(true);
    expect(body.providers).toMatchObject({ inform: { ok: true }, worldbank_wgi: { ok: true } });
    expect(body.meta).toMatchObject({ feed: 'country-risk', kind: 'reference', state: 'reference' });
    expect(body.meta.note).toMatch(/label position for states too small/);
    const shapes = JSON.parse(readFileSync(join(process.cwd(), 'public/data/zones-countries.json'), 'utf8')) as GeoJSON.FeatureCollection;
    const g = buildRiskGeometry(body.items, shapes);
    const scored = body.items.filter((r: { score: number | null }) => r.score !== null).length;
    // Nothing scored is silently dropped: drawn + unplaceable = scored; drawn + unscored + unplaceable = rows.
    expect(g.drawn + g.noGeometry.length).toBe(scored);
    expect(g.drawn + g.unscored + g.noGeometry.length).toBe(body.items.length);
    expect(g.unscored).toBe(body.items.length - scored);
    expect(g.points.features.length).toBeGreaterThan(0);
    expect(g.drawn).toBe(g.polygons.features.length + g.points.features.length);
    // Small states without a 1:110m outline are label points (Bahrain, Malta, Samoa).
    const pointIds = g.points.features.map((f) => f.properties?.id);
    for (const iso3 of ['BHR', 'MLT', 'WSM']) if (body.items.some((r: { iso3: string; score: number | null }) => r.iso3 === iso3 && r.score !== null)) expect(pointIds).toContain(iso3);
    // No country is drawn twice.
    const ids = [...g.polygons.features, ...g.points.features].map((f) => f.properties?.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(g.noGeometry).toEqual([]);
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
