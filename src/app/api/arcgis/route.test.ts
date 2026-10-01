import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { ArcgisResponse } from '@/lib/schemas';
import { fixture, fixtureText, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get } from '@/components/panels/recon/__fixtures__/route-helpers';
import { matchesAllowList } from '@/lib/ssrf';
import { ARCGIS_MAX_BYTES, arcgisError, arcgisRules, isAllowedService, BUILTIN_ARCGIS_RULES, FEATURE_CAP, HOSTED_SERVICE_HOSTS, isImportableUrl, isRefusalStatus, parseServiceUrl, queryUrl, SERVER_QUERY_PATH } from '@/components/panels/recon/server/arcgis';

// Fixtures: arcgis.com search "earthquakes" and the USGS_Seismic_Data_v1 FeatureServer query, 2026-09-30;
// sampleserver6 unknown-service 404 page, layer-57 error body and the services.arcgis.com bad-service 400, 2026-10-01.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));
const DNS: Record<string, string> = { 'services9.arcgis.com': '52.1.2.3', 'services.arcgis.com': '52.1.2.4', 'sampleserver6.arcgisonline.com': '52.4.5.6', 'example.com': '93.184.215.14', 'evil.arcgis.com.example.net': '93.184.215.15', 'gis.example.org': '93.184.215.30', 'internal.example.org': '192.168.1.10' };
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
    ]) {
      const body = await error(await call(`?url=${encodeURIComponent(bad)}`), 403);
      expect(body.error, bad).toBe('host_not_allowed');
    }
    // An http:// URL to a built-in host is refused for its scheme, not as an unknown host.
    const http = await error(await call(`?url=${encodeURIComponent('http://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USGS_Seismic_Data_v1/FeatureServer/0')}`), 400);
    expect(http.error).toBe('https_only');
    expect(upstream.calls).toEqual([]);
  });

  it('imports from an operator host on the port the operator listed (ArcGIS Server :6443), and only that port', async () => {
    vi.stubEnv('ARCGIS_ALLOWED_HOSTS', 'gis.example.org:6443');
    upstream.on('gis.example.org', { json: fixture('arcgisonline-sample6-query.json') });
    const body = await valid(await call(`?url=${encodeURIComponent('https://gis.example.org:6443/arcgis/rest/services/x/FeatureServer/0')}`));
    expect(body.features.features.length).toBe(2);
    expect(new URL(upstream.calls[0]!.url).port).toBe('6443');
    for (const other of ['https://gis.example.org/arcgis/rest/services/x/FeatureServer/0', 'https://gis.example.org:8443/arcgis/rest/services/x/FeatureServer/0']) {
      expect((await error(await call(`?url=${encodeURIComponent(other)}`), 403)).error, other).toBe('host_not_allowed');
    }
  });

  it('allow-lists the regional ArcGIS Online hosts', () => {
    expect(isImportableUrl('https://services-eu1.arcgis.com/abc/arcgis/rest/services/x/FeatureServer/0', {})).toBe(true);
    expect(isImportableUrl('https://services-ap1.arcgis.com/abc/arcgis/rest/services/x/FeatureServer/0', {})).toBe(true);
    expect(isImportableUrl('https://services-eu1.arcgis.com.evil.example/abc/arcgis/rest/services/x/FeatureServer/0', {})).toBe(false);
  });

  it('accepts the REST Services Directory casing /<org>/ArcGIS/rest/services/ (r5 blocking)', async () => {
    const dir = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/USGS_Seismic_Data_v1/FeatureServer/0';
    expect(isImportableUrl(dir, {})).toBe(true);
    expect(isAllowedService(parseServiceUrl(dir), {})).toBe(true);
    expect(isImportableUrl('https://services6.arcgis.com/abc/ArcGIS/rest/services/BCWS_FirePerimeters_PublicView/FeatureServer', {})).toBe(true);
    expect(isImportableUrl('https://gis.example.org/Server/ArcGIS/rest/services/x/MapServer', { ARCGIS_ALLOWED_HOSTS: 'gis.example.org' })).toBe(true);
    // The other APIs on the same hosts stay refused whatever their casing.
    expect(matchesAllowList(new URL('https://services9.arcgis.com/abc/ArcGIS/Sharing/rest/info'), arcgisRules({}))).toBe(false);
    upstream.on('/ArcGIS/rest/services/USGS_Seismic_Data_v1/FeatureServer/0/query', { json: fixture('arcgis-featureserver-query.json') });
    const body = await valid(await call(`?url=${encodeURIComponent(dir)}`));
    expect(body.features.features.length).toBe(3);
  });

  it('reports a layer over the size cap as 422 layer_too_large, not SOURCE OFFLINE', async () => {
    upstream.on('/FeatureServer/1/query', { text: 'x'.repeat(ARCGIS_MAX_BYTES + 1) });
    const res = await call(`?url=${encodeURIComponent(`${SVC}/1`)}`);
    const body = await error(res, 422);
    expect(body.error).toBe('layer_too_large');
    expect(body.providers.service).toMatchObject({ ok: false, error: 'too_large' });
    expect(res.headers.get('retry-after')).toBeNull();
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
    expect(rules.slice(BUILTIN_ARCGIS_RULES.length)).toEqual([
      { host: 'gis.example.gov', pathPrefix: '/', pathPattern: SERVER_QUERY_PATH },
      { host: 'maps.example.org', pathPrefix: '/', pathPattern: SERVER_QUERY_PATH, port: '8443' },
    ]);
    expect(isImportableUrl(SVC, {})).toBe(true);
    // Esri's per-account proxy is not a hosted-service host.
    expect(isImportableUrl('https://utility.arcgis.com/usrsvcs/servers/abc/rest/services/x/FeatureServer/0', {})).toBe(false);
    expect(isImportableUrl('https://mapsdep.nj.gov/arcgis/rest/services/Features/Environmental_admin/MapServer', {})).toBe(false);
    expect(isImportableUrl('https://mapsdep.nj.gov/arcgis/rest/services/Features/Environmental_admin/MapServer', { ARCGIS_ALLOWED_HOSTS: 'mapsdep.nj.gov' })).toBe(true);
  });

  it('refuses a redirect to a private address', async () => {
    upstream.on('gis.example.org', { redirect: 'http://127.0.0.1/admin' });
    const body = await error(await call(`?url=${encodeURIComponent('https://gis.example.org/arcgis/rest/services/x/FeatureServer/0')}`), 400);
    expect(body.error).toBe('blocked_target');
  });

  it('reports a 200 answer that is not GeoJSON (Esri JSON from a pre-10.4 server) as SOURCE OFFLINE', async () => {
    upstream.on('gis.example.org', { json: { geometryType: 'esriGeometryPoint', features: [{ attributes: { a: 1 }, geometry: { x: 1, y: 2 } }] } });
    const res = await call(`?url=${encodeURIComponent('https://gis.example.org/arcgis/rest/services/x/MapServer')}`);
    const body = await error(res, 503);
    expect(body.error).toBe('source_offline');
    expect(body.providers.service).toMatchObject({ ok: false, error: 'parse' });
  });

  describe('r5-m2: a service that answers 4xx is a service error (422), not SOURCE OFFLINE', () => {
    const SAMPLE = 'https://sampleserver6.arcgisonline.com/arcgis/rest/services';

    it('the reviewer\'s case: a well-formed hosted-service URL naming a service that does not exist → 422 http_400, not 503', async () => {
      // Recorded 2026-10-01 19:30Z: services.arcgis.com …/USA_Major_Cities_typo/FeatureServer/0/query → 400 text/html "Bad Request".
      const bad = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Major_Cities_typo/FeatureServer/0';
      upstream.on('USA_Major_Cities_typo', { status: 400, text: fixtureText('arcgis-hosted-bad-service-400.txt'), headers: { 'content-type': 'text/html' } });
      const res = await call(`?url=${encodeURIComponent(bad)}`);
      const body = await error(res, 422);
      expect(body).toMatchObject({ error: 'service_error', upstreamStatus: 400, providers: { service: { ok: false, count: 0, error: 'http_400' } } });
      expect(body.detail).toBe('The ArcGIS service answered HTTP 400. The host is up: check the layer URL (service name, FeatureServer/MapServer and layer number).');
      expect(res.headers.get('retry-after')).toBeNull();
      expect(upstream.calls).toHaveLength(1);
    });

    it('HTTP 404 for an unknown service (recorded ArcGIS Server HTML page) → 422 with the upstream status, no Retry-After, no HTML', async () => {
      // Recorded 2026-10-01: sampleserver6 …/No_Such_Service/FeatureServer/0/query → 404 text/html.
      upstream.on('No_Such_Service', { status: 404, text: fixtureText('arcgisonline-sample6-no-such-service-404.html'), headers: { 'content-type': 'text/html;charset=utf-8' } });
      const res = await call(`?url=${encodeURIComponent(`${SAMPLE}/No_Such_Service/FeatureServer/0`)}`);
      const body = await error(res, 422);
      expect(body).toMatchObject({ error: 'service_error', upstreamStatus: 404, providers: { service: { ok: false, error: 'http_404' } } });
      expect(body.detail).toContain('HTTP 404');
      expect(body.detail).toContain('check the layer URL');
      expect(res.headers.get('retry-after')).toBeNull();
      expect(body.retryAfter).toBeUndefined();
      // The upstream HTML is never relayed.
      expect(JSON.stringify(body)).not.toMatch(/<html|<table|ArcGIS REST Framework/);
    });

    it('an ArcGIS error body under HTTP 200 (recorded: layer 57 does not exist) → 422 with ArcGIS\'s message as text', async () => {
      upstream.on('Earthquakes_Since1970/FeatureServer/57/query', { json: fixture('arcgisonline-sample6-layer-57-error.json') });
      const body = await error(await call(`?url=${encodeURIComponent(`${SAMPLE}/Earthquakes_Since1970/FeatureServer/57`)}`), 422);
      expect(body.upstreamStatus).toBe(400);
      expect(body.providers.service).toMatchObject({ ok: false, error: 'http_400' });
      expect(body.detail).toContain('Invalid or missing input parameters. — Invalid Layer or Table ID: 57.');
    });

    it('a token-protected service (ArcGIS code 499) says only public layers can be imported', async () => {
      upstream.on('gis.example.org', { json: { error: { code: 499, message: 'Token Required', details: [] } } });
      const body = await error(await call(`?url=${encodeURIComponent('https://gis.example.org/arcgis/rest/services/x/MapServer')}`), 422);
      expect(body.upstreamStatus).toBe(499);
      expect(body.detail).toContain('Only public layers can be imported');
    });

    it('5xx, 408 and 429 (synthetic statuses) stay SOURCE OFFLINE with Retry-After', async () => {
      for (const status of [502, 503, 408, 429]) {
        freshState();
        upstream.on('services9.arcgis.com', { status, text: '' });
        const res = await call(`?url=${encodeURIComponent(SVC)}`);
        const body = await error(res, 503);
        expect(body.error, String(status)).toBe('source_offline');
        expect(body.providers.service.error).toBe(`http_${status}`);
        expect(res.headers.get('retry-after')).toBe('30');
      }
      freshState();
      upstream.on('gis.example.org', { json: { error: { code: 500, message: 'Unable to complete operation.' } } });
      expect((await error(await call(`?url=${encodeURIComponent('https://gis.example.org/arcgis/rest/services/x/MapServer')}`), 503)).error).toBe('source_offline');
    });

    it('classifies statuses and parses the ArcGIS error envelope defensively', () => {
      expect([400, 401, 403, 404, 410, 498, 499].every(isRefusalStatus)).toBe(true);
      expect([200, 302, 408, 429, 500, 502, 504].some(isRefusalStatus)).toBe(false);
      expect(arcgisError({ error: { code: 400, message: 'Invalid URL', details: ['Invalid URL'] } })).toEqual({ code: 400, message: 'Invalid URL' });
      expect(arcgisError({ error: { code: '400', message: 'a\u0000b\nc', details: 'x' } })).toEqual({ code: null, message: 'a b c' });
      expect(arcgisError({ error: { code: 400, message: 'x'.repeat(500), details: ['y'.repeat(500)] } })!.message!.length).toBe(240);
      for (const junk of [null, 1, 'x', [], {}, { error: null }, { error: 'string' }]) expect(arcgisError(junk)).toBeNull();
    });
  });

  it('pins every hop on an allow-listed host to the layer-query shape (AllowRule.pathPattern)', async () => {
    // Same host, prefix '/', but /sharing/rest is not a layer query: the redirect is refused.
    upstream.on('services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services', { redirect: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/sharing/rest/content/items/1' });
    const body = await error(await call(`?url=${encodeURIComponent(SVC)}`), 400);
    expect(body.error).toBe('blocked_target');
    expect(upstream.calls).toHaveLength(1);
    const rules = arcgisRules({});
    for (const host of HOSTED_SERVICE_HOSTS) {
      expect(matchesAllowList(new URL(`https://${host}/Org1/arcgis/rest/services/A/B/FeatureServer/0/query`), rules), host).toBe(true);
      expect(matchesAllowList(new URL(`https://${host}/Org1/arcgis/sharing/rest/content/items/1`), rules), host).toBe(false);
      expect(matchesAllowList(new URL(`https://${host}/Org1/arcgis/rest/admin/services/A/FeatureServer/0/query`), rules), host).toBe(false);
    }
    expect(matchesAllowList(new URL('https://sampleserver6.arcgisonline.com/arcgis/rest/services/E/FeatureServer/0/query'), rules)).toBe(true);
    expect(matchesAllowList(new URL('https://sampleserver6.arcgisonline.com/arcgis/rest/services/E/FeatureServer/0'), rules)).toBe(false);
    const op = arcgisRules({ ARCGIS_ALLOWED_HOSTS: 'gis.example.gov' });
    expect(matchesAllowList(new URL('https://gis.example.gov/server/rest/services/Folder/E/MapServer/3/query'), op)).toBe(true);
    expect(matchesAllowList(new URL('https://gis.example.gov/server/admin/login'), op)).toBe(false);
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
