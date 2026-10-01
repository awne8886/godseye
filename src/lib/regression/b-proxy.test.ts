// Phase 1 review B regression (B2): proxy routes must re-check the allow-list on every redirect hop.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allowListedFetch, matchesAllowList, type AllowRule } from '@/lib/ssrf';

let server: http.Server;
let port = '';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/cams/1.jpg') {
      res.writeHead(302, { location: '/admin/secret' });
      res.end();
      return;
    }
    if (req.url === '/org/arcgis/rest/services/x/FeatureServer/0/query') {
      res.writeHead(302, { location: '/org/arcgis/sharing/rest/content/items/1' });
      res.end();
      return;
    }
    if (req.url === '/org/arcgis/rest/services/x/FeatureServer/1/query') {
      res.writeHead(302, { location: '/org/arcgis/rest/services/y/FeatureServer/2/query' });
      res.end();
      return;
    }
    if (req.url === '/cams/moved.jpg') {
      res.writeHead(302, { location: '/cams/2.jpg' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    res.end(`served ${req.url}`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = String((server.address() as AddressInfo).port);
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// Loopback is only reachable here because the test injects a permissive address predicate.
const testOpts = () => ({ isBlocked: () => false, ports: new Set([port]) });
const rules = (): AllowRule[] => [{ host: '127.0.0.1', pathPrefix: '/cams/', protocols: ['http:'], port }];

describe('allowListedFetch', () => {
  it('refuses a redirect that leaves the allow-listed prefix', async () => {
    await expect(allowListedFetch(`http://127.0.0.1:${port}/cams/1.jpg`, rules(), testOpts())).rejects.toMatchObject({ code: 'blocked' });
  });

  it('follows a redirect that stays on the allow-list', async () => {
    const res = await allowListedFetch(`http://127.0.0.1:${port}/cams/moved.jpg`, rules(), testOpts());
    expect(res.status).toBe(200);
    expect(res.url.endsWith('/cams/2.jpg')).toBe(true);
  });

  it('still applies the SSRF guard to allow-listed hosts', async () => {
    await expect(allowListedFetch(`http://127.0.0.1:${port}/cams/2.jpg`, rules(), { ports: new Set([port]) })).rejects.toMatchObject({ code: 'blocked' });
  });

  it('a pathPattern keeps every redirect hop in the allowed resource shape', async () => {
    const shaped: AllowRule[] = [{ host: '127.0.0.1', pathPrefix: '/', protocols: ['http:'], port, pathPattern: /^\/[A-Za-z0-9]{1,64}\/arcgis\/rest\/services\/[^?#]*\/(?:Feature|Map)Server\/\d{1,4}\/query$/ }];
    // Same host, prefix '/' allows it, but /sharing/... is not a service query: refused.
    await expect(allowListedFetch(`http://127.0.0.1:${port}/org/arcgis/rest/services/x/FeatureServer/0/query`, shaped, testOpts())).rejects.toMatchObject({ code: 'blocked' });
    const ok = await allowListedFetch(`http://127.0.0.1:${port}/org/arcgis/rest/services/x/FeatureServer/1/query`, shaped, testOpts());
    expect(ok.url.endsWith('/org/arcgis/rest/services/y/FeatureServer/2/query')).toBe(true);
    expect(matchesAllowList(new URL(`http://127.0.0.1:${port}/org/arcgis/sharing/rest`), shaped)).toBe(false);
  });

  it('only matches a non-default port the rule names', () => {
    expect(matchesAllowList(new URL(`http://127.0.0.1:${port}/cams/2.jpg`), rules())).toBe(true);
    expect(matchesAllowList(new URL('http://127.0.0.1:8081/cams/2.jpg'), rules())).toBe(false);
    expect(matchesAllowList(new URL('https://example.org:8443/cams/'), [{ host: 'example.org', pathPrefix: '/cams/' }])).toBe(false);
  });
});
