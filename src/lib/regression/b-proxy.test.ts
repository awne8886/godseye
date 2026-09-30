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

  it('only matches a non-default port the rule names', () => {
    expect(matchesAllowList(new URL(`http://127.0.0.1:${port}/cams/2.jpg`), rules())).toBe(true);
    expect(matchesAllowList(new URL('http://127.0.0.1:8081/cams/2.jpg'), rules())).toBe(false);
    expect(matchesAllowList(new URL('https://example.org:8443/cams/'), [{ host: 'example.org', pathPrefix: '/cams/' }])).toBe(false);
  });
});
