/**
 * Security (round 6): the stills proxy never reaches link-out-only operators (MLIT, Edmonton),
 * refuses operator placeholders, and every hop of a frame fetch is allow-listed AND SSRF-guarded.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isReservedIPv4, isReservedIPv6, type Resolver } from '@/lib/ssrf';
import type { Camera } from '@/lib/types';
import { fetchFrame } from '../frames';
import { providerDef, type ProviderDef } from '../registry';

const cam = (providerId: string, stillUrl: string | null): Camera =>
  ({
    id: `${providerId}-1`, lat: 0, lng: 0, name: 't', providerId, city: null, country: null, streamType: 'jpg',
    stillUrl, streamUrl: null, externalUrl: null, headingDeg: null, observedAt: null, source: providerId,
  }) as unknown as Camera;

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

describe('link-out-only operators are never fetched', () => {
  for (const id of ['mlit', 'edmonton']) {
    it(`${id}: no allow rules, proxy refuses before any DNS lookup`, async () => {
      const def = providerDef(id)!;
      expect(def).not.toBeNull();
      expect(def.rules).toHaveLength(0);
      expect(def.fileRules).toBeUndefined();
      expect(def.row.link_out_only).toBe(true);
      expect(def.row.proxy_allowed).toBe(false);
      let lookups = 0;
      const resolve: Resolver = async () => {
        lookups++;
        return [{ address: '93.184.216.34', family: 4 }];
      };
      const r = await fetchFrame(cam(id, 'https://www.river.go.jp/kawabou/file/files/obs/cam/x.jpg'), def, { fetchOpts: { resolve }, env: {} });
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ status: 404, error: 'link_out_only' });
      expect(lookups).toBe(0);
    });
  }
  it('edmonton is licence-gated by nc_sources (off on a commercial deployment)', () => {
    expect(providerDef('edmonton')!.capability).toBe('nc_sources');
  });
});

describe('allow-listed frame fetch against a local "public" operator', () => {
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url === '/cams/placeholder.jpg') {
        res.setHeader('content-type', 'image/png');
        return res.end(PNG);
      }
      if (req.url === '/cams/ok.jpg') {
        res.setHeader('content-type', 'image/jpeg');
        return res.end(JPEG);
      }
      if (req.url === '/cams/to-metadata.jpg') {
        res.statusCode = 302;
        res.setHeader('location', 'http://169.254.169.254/latest/meta-data/');
        return res.end();
      }
      if (req.url === '/cams/to-offlist.jpg') {
        res.statusCode = 302;
        res.setHeader('location', `http://op.test:${port}/admin/secret.jpg`);
        return res.end();
      }
      if (req.url === '/cams/to-rebind.jpg') {
        res.statusCode = 302;
        res.setHeader('location', `http://rebind.test:${port}/cams/ok.jpg`);
        return res.end();
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // Test-only policy: 127.0.0.1 plays the public operator; everything else reserved stays blocked.
  const isBlocked = (ip: string) => ip !== '127.0.0.1' && (ip.includes(':') ? isReservedIPv6(ip) : isReservedIPv4(ip));
  const resolve: Resolver = async (h) =>
    h === 'op.test' ? [{ address: '127.0.0.1', family: 4 }] : h === 'rebind.test' ? [{ address: '10.1.2.3', family: 4 }] : [];
  const def = (frameTypes?: string[]): ProviderDef =>
    ({
      region: 'europe',
      row: {
        id: 'sec-test', operator: 'test', region: 'x', country: 'XX', list_endpoint: '', frame_url_template: null, stream_type: 'jpg',
        licence: 'test', attribution_string: 'test', terms_url: '', key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
      },
      rules: [{ host: 'op.test', pathPrefix: '/cams/', protocols: ['http:'], port: String(port) }],
      ...(frameTypes ? { frameTypes } : {}),
    }) as unknown as ProviderDef;
  const deps = () => ({ fetchOpts: { resolve, isBlocked, ports: new Set(['', String(port)]) }, env: {} });

  it('serves a real JPEG frame', async () => {
    const r = await fetchFrame(cam('sec-test', `http://op.test:${port}/cams/ok.jpg`), def(['image/jpeg']), deps());
    expect(r.ok).toBe(true);
  });

  it('refuses an operator placeholder of the wrong type (operator_placeholder, 502)', async () => {
    const r = await fetchFrame(cam('sec-test', `http://op.test:${port}/cams/placeholder.jpg`), def(['image/jpeg']), deps());
    expect(r).toMatchObject({ ok: false, status: 502, error: 'operator_placeholder' });
  });

  it('blocks a redirect to cloud metadata, off the allow-list, or to a host resolving private', async () => {
    for (const p of ['to-metadata', 'to-offlist', 'to-rebind']) {
      const before = hits.length;
      const r = await fetchFrame(cam('sec-test', `http://op.test:${port}/cams/${p}.jpg`), def(), deps());
      expect(r).toMatchObject({ ok: false, status: 403, error: 'blocked' });
      // Only the first (allowed) hop reached the server; the redirect target never did.
      expect(hits.slice(before)).toEqual([`/cams/${p}.jpg`]);
    }
  });

  it('refuses a catalogued URL outside the prefix without connecting', async () => {
    const before = hits.length;
    const r = await fetchFrame(cam('sec-test', `http://op.test:${port}/cams/..%2fadmin.jpg`), def(), deps());
    expect(r).toMatchObject({ ok: false, error: 'blocked' });
    expect(hits.length).toBe(before);
  });
});
