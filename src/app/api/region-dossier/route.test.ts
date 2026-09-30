import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, FX, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { clearLookups } from '@/components/panels/intel/server/lookup';
import { earthquakeFeed } from '@/features/hazards/server/usgs';
import { RegionDossierResponse } from '@/lib/schemas/intel';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/components/panels/intel/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: CAPTURED_AT });
  freshCache();
  clearLookups();
});
afterEach(() => {
  earthquakeFeed().stop();
  resetCache();
  vi.useRealTimers();
});

describe('GET /api/region-dossier', () => {
  it('aggregates place, country facts, brief and live layers with per-layer state', async () => {
    earthquakeFeed(); // registers the `earthquakes` feed in this process (unregistered layers stay offline)
    state.routes = [
      ['photon.komoot.io/reverse', FX.photon],
      ['query.wikidata.org/sparql', FX.sparqlUA],
      ['en.wikipedia.org/api/rest_v1/page/summary', FX.wiki],
      ['summary/2.5_day.geojson', FX.usgs],
    ];
    const res = await GET(req('/api/region-dossier?lat=50.45&lng=30.52'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = RegionDossierResponse.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.location).toMatchObject({ countryCode: 'UA' });
    expect(body.country).toMatchObject({ name: 'Ukraine', capital: 'Kyiv', headOfState: { name: 'Volodymyr Zelenskyy' } });
    expect(body.brief.url).toMatch(/^https:\/\/en\.wikipedia\.org\//);
    expect(body.nearby.radiusKm).toBe(150);
    expect(body.nearby.counts.earthquakes).toMatchObject({ state: 'live' });
    expect(typeof body.nearby.counts.earthquakes.count).toBe('number');
    // Layers whose feeds are not registered here are SOURCE OFFLINE with count null — never 0.
    expect(body.nearby.counts.flights).toEqual({ count: null, state: 'offline' });
    expect(body.nearby.counts.ports).toEqual({ count: null, state: 'offline' });
    expect(body.nearby.counts.cameras).toEqual({ count: null, state: 'offline' });
    expect(body.nearby.counts.vessels).toMatchObject({ count: null, reason: 'not-configured' });
    expect(body.providers['layer:vessels']).toMatchObject({ ok: false, skipped: 'not-configured' });
    expect(body.providers.photon).toMatchObject({ ok: true });
    expect(body.providers['layer:flights']).toMatchObject({ ok: false });
    // Open-Meteo did not answer (network): weather is null, not invented.
    expect(body.weather).toBeNull();
    expect(body.providers['open-meteo']).toMatchObject({ ok: false });
  });

  it('skips Open-Meteo on commercial deployments (licence gate)', async () => {
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    state.routes = [['photon.komoot.io/reverse', FX.photon], ['query.wikidata.org/sparql', FX.sparqlUA]];
    const body = await (await GET(req('/api/region-dossier?lat=50.451&lng=30.521'), undefined)).json();
    expect(body.providers['open-meteo']).toMatchObject({ skipped: 'licence' });
    vi.unstubAllEnvs();
  });

  it('validates coordinates and answers 503 when nothing answered', async () => {
    expect((await GET(req('/api/region-dossier?lat=95&lng=0'), undefined)).status).toBe(400);
    state.routes = [];
    const res = await GET(req('/api/region-dossier?lat=10&lng=10'), undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('source_offline');
  });
});
