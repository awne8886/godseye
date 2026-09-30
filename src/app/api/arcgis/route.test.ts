import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { ArcgisResponse } from '@/lib/schemas';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get } from '@/components/panels/recon/__fixtures__/route-helpers';
import { arcgisRules, FEATURE_CAP, isImportableUrl, parseServiceUrl, queryUrl } from '@/components/panels/recon/server/arcgis';

// Fixtures: arcgis.com search "earthquakes" and the USGS_Seismic_Data_v1 FeatureServer query, 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));
const DNS: Record<string, string> = { 'services9.arcgis.com': '52.1.2.3', 'sampleserver6.arcgisonline.com': '52.4.5.6', 'example.com': '93.184.215.14', 'evil.arcgis.com.example.net': '93.184.215.15', 'gis.example.org': '93.184.215.30', 'internal.example.org': '192.168.1.10' };
vi.mock('node:dns', () => {
  const lookup = async (host: string) => {
    const a = DNS[host];
    if (!a) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return [{ address: a, family: 4 }];
  };
  return { default: { promises: { lookup } }, promises: { lookup } };
});

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/arcgis${qs}`);
const SVC = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USGS_Seismic_Data_v1/FeatureServer';

async function valid(res: Response) {
  expect(res.status, await res.clone().text()).toBe(200);
  const body = await res.json();
  const p = ArcgisResponse.safeParse(body);
  expect(p.success, JSON.stringify(p.error?.issues.slice(0, 3))).toBe(true);
  expect(Object.keys(body.providers).length).toBe(1);
  return body;
}

describe('GET /api/arcgis', () => {
  beforeEach(() => {
    freshState();
    // Operator allow-list additions used by the generic-server tests below.
    vi.stubEnv('ARCGIS_ALLOWED_HOSTS', 'gis.example.org, internal.example.org, bad_entry, *.wild.example');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('searches public Feature/Map Services on arcgis.com', async () => {
    upstream.on('www.arcgis.com/sharing/rest/search', { json: fixture('arcgis-search-earthquakes.json') });
    const body = await valid(await call('?q=earthquakes'));
    expect(body.mode).toBe('search');
    expect(body.items[0]).toMatchObject({ title: 'Recent Earthquakes', url: SVC, importable: true });
    expect(new URL(upstream.calls[0]!.url).searchParams.get('q')).toContain('type:"Feature Service"');
  });

  it('imports a layer through a rebuilt …/query URL as GeoJSON', async () => {
    upstream.on('/FeatureServer/0/query', { json: fixture('arcgis-featureserver-query.json') });
    const body = await valid(await call(`?url=${encodeURIComponent(`${SVC}/0?f=pjson&token=abc#x`)}`));
    expect(body.mode).toBe('layer');
    expect(body.features.features.length).toBe(3);
    // The recorded query used resultRecordCount=3, so the service flagged exceededTransferLimit.
    expect(body.truncated).toBe(true);
    expect(body.source).toBe(`${SVC}/0`);
    const q = new URL(upstream.calls[0]!.url);
    expect(q.pathname).toBe('/RHVPKKiFTONKtxq3/arcgis/rest/services/USGS_Seismic_Data_v1/FeatureServer/0/query');
    expect(q.searchParams.get('f')).toBe('geojson');
    expect(q.searchParams.get('token')).toBeNull();
    expect(q.searchParams.get('resultRecordCount')).toBe(String(FEATURE_CAP));
  });

  it(`caps imports at ${FEATURE_CAP} features and says so`, async () => {
    const many = { type: 'FeatureCollection', features: Array.from({ length: 1500 }, (_, i) => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [i / 100, 1] }, properties: { n: i, nested: { x: 1 } } })) };
    upstream.on('gis.example.org', { json: many });
    const body = await valid(await call(`?url=${encodeURIComponent('https://gis.example.org/arcgis/rest/services/Ports/MapServer/3')}&bbox=-10,-10,10,10`));
    expect(body.features.features).toHaveLength(FEATURE_CAP);
    expect(body.truncated).toBe(true);
    expect(body.features.features[0].properties).toEqual({ n: 0 });
    expect(new URL(upstream.calls[0]!.url).searchParams.get('geometry')).toBe('-10,-10,10,10');
  });

  it('refuses non-service URLs, private hosts, credentials, bad ports and traversal', async () => {
    for (const bad of [
      'https://gis.example.org/arcgis/rest/services/Ports/ImageServer/0',
      'https://gis.example.org/arcgis/admin/services/x/FeatureServer',
      'https://internal.example.org/arcgis/rest/services/x/FeatureServer/0',
      'http://10.0.0.2/arcgis/rest/services/x/FeatureServer/0',
      'http://169.254.169.254/rest/services/x/MapServer',
      'https://user:pw@gis.example.org/arcgis/rest/services/x/FeatureServer/0',
      'https://gis.example.org:6443/arcgis/rest/services/x/FeatureServer/0',
      'https://gis.example.org/arcgis/rest/services/%2e%2e/x/FeatureServer/0',
      'file:///rest/services/x/FeatureServer',
    ]) {
      const res = await call(`?url=${encodeURIComponent(bad)}`);
      // 400 blocked_target (bad shape / reserved address) or 403 host_not_allowed (off the allow-list).
      expect([400, 403], bad).toContain(res.status);
    }
    expect(upstream.calls).toEqual([]);
  });

  it('SEC-M3: refuses hosts that are not on the ArcGIS allow-list before any network I/O', async () => {
    vi.stubEnv('ARCGIS_ALLOWED_HOSTS', '');
    for (const bad of [
      'https://example.com/rest/services/x/FeatureServer/0',
      'https://gis.example.org/arcgis/rest/services/Ports/MapServer/3',
      'https://evil.arcgis.com.example.net/arcgis/rest/services/x/FeatureServer/0',
      'https://arcgis.com/arcgis/rest/services/x/FeatureServer/0',
      'https://notarcgis.com/arcgis/rest/services/x/FeatureServer/0',
      'https://sampleserver6.arcgisonline.com/server/rest/services/x/FeatureServer/0',
      'http://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USGS_Seismic_Data_v1/FeatureServer/0',
    ]) {
      const body = await error(await call(`?url=${encodeURIComponent(bad)}`), 403);
      expect(body.error, bad).toBe('host_not_allowed');
    }
    expect(upstream.calls).toEqual([]);
  });

  it('imports from *.arcgisonline.com under /arcgis/rest/services/', async () => {
    upstream.on('sampleserver6.arcgisonline.com/arcgis/rest/services/Earthquakes_Since1970/FeatureServer/0/query', { json: fixture('arcgisonline-sample6-query.json') });
    const body = await valid(await call(`?url=${encodeURIComponent('https://sampleserver6.arcgisonline.com/arcgis/rest/services/Earthquakes_Since1970/FeatureServer/0')}`));
    expect(body.features.features.length).toBe(2);
  });

  it('refuses a redirect from an allowed ArcGIS host to an off-list host', async () => {
    upstream.on('services9.arcgis.com', { redirect: 'https://example.com/rest/services/x/FeatureServer/0/query' });
    upstream.on('example.com', { json: { type: 'FeatureCollection', features: [] } });
    const body = await error(await call(`?url=${encodeURIComponent(SVC)}`), 400);
    expect(body.error).toBe('blocked_target');
    expect(upstream.calls.map((c) => new URL(c.url).hostname)).toEqual(['services9.arcgis.com']);
  });

  it('parses ARCGIS_ALLOWED_HOSTS as exact hosts (optional port), ignoring wildcards and junk', () => {
    const rules = arcgisRules({ ARCGIS_ALLOWED_HOSTS: 'GIS.Example.gov, maps.example.org:8443, *.evil.example, http://x.example, a' });
    expect(rules.slice(2)).toEqual([{ host: 'gis.example.gov', pathPrefix: '/' }, { host: 'maps.example.org', pathPrefix: '/', port: '8443' }]);
    expect(isImportableUrl(SVC, {})).toBe(true);
    expect(isImportableUrl('https://mapsdep.nj.gov/arcgis/rest/services/Features/Environmental_admin/MapServer', {})).toBe(false);
    expect(isImportableUrl('https://mapsdep.nj.gov/arcgis/rest/services/Features/Environmental_admin/MapServer', { ARCGIS_ALLOWED_HOSTS: 'mapsdep.nj.gov' })).toBe(true);
  });

  it('refuses a redirect to a private address', async () => {
    upstream.on('gis.example.org', { redirect: 'http://127.0.0.1/admin' });
    const body = await error(await call(`?url=${encodeURIComponent('https://gis.example.org/arcgis/rest/services/x/FeatureServer/0')}`), 400);
    expect(body.error).toBe('blocked_target');
  });

  it('reports a service that does not speak GeoJSON as SOURCE OFFLINE', async () => {
    upstream.on('gis.example.org', { json: { error: { code: 400, message: 'Invalid format' } } });
    const body = await error(await call(`?url=${encodeURIComponent('https://gis.example.org/arcgis/rest/services/x/MapServer')}`), 503);
    expect(body.providers.service.ok).toBe(false);
  });

  it('needs exactly one of q or url', async () => {
    await error(await call(''), 400);
    await error(await call(`?q=x1&url=${encodeURIComponent(SVC)}`), 400);
  });

  it('parses service URLs strictly', () => {
    expect(parseServiceUrl(`${SVC}/12/query`)).toMatchObject({ kind: 'FeatureServer', layer: 12 });
    expect(queryUrl(parseServiceUrl(`${SVC}`)).pathname.endsWith('/FeatureServer/0/query')).toBe(true);
  });
});
