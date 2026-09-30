import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpText } from './http';
import {
  assertPublicUrl,
  expandIPv6,
  isCanonicalIPv4,
  isReservedIPv4,
  isReservedIPv6,
  matchesAllowList,
  safeFetch,
  validateHost,
  type Resolver,
} from './ssrf';

const resolver = (answers: Record<string, string[]>): Resolver => async (host) => {
  const a = answers[host];
  if (!a) throw new Error('ENOTFOUND');
  return a.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

describe('SSRF guard: addresses', () => {
  it('blocks every reserved IPv4 range and allows public ones', () => {
    for (const ip of ['0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255']) {
      expect(isReservedIPv4(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '9.9.9.9']) expect(isReservedIPv4(ip), ip).toBe(false);
  });

  it('treats non-canonical IPv4 forms as non-canonical', () => {
    for (const s of ['127.1', '0x7f.0.0.1', '0177.0.0.1', '2130706433', '01.2.3.4', '1.2.3.256']) expect(isCanonicalIPv4(s), s).toBe(false);
    expect(isCanonicalIPv4('1.2.3.4')).toBe(true);
  });

  it('blocks IPv6 loopback, ULA, link-local, site-local, multicast, NAT64, docs and mapped private IPv4', () => {
    for (const ip of ['::', '::1', '[::1]', 'fc00::1', 'fd12:3456::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1', '64:ff9b::7f00:1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '2002:c0a8:101::1', '100::1']) {
      expect(isReservedIPv6(ip), ip).toBe(true);
    }
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) expect(isReservedIPv6(ip), ip).toBe(false);
    expect(expandIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
  });
});

describe('SSRF guard: hosts and URLs', () => {
  it('rejects blocked names, literals and any reserved DNS answer (rebinding)', async () => {
    const r = resolver({ 'good.example.com': ['93.184.216.34'], 'rebind.example.com': ['93.184.216.34', '127.0.0.1'], 'v6.example.com': ['2606:4700::1'] });
    expect(await validateHost('good.example.com', r)).toEqual({ ok: true, addresses: ['93.184.216.34'] });
    expect(await validateHost('v6.example.com', r)).toMatchObject({ ok: true });
    expect(await validateHost('rebind.example.com', r)).toMatchObject({ ok: false, reason: 'resolves to a reserved address' });
    for (const h of ['localhost', 'foo.localhost', 'metadata.google.internal', 'printer.local', 'host.docker.internal', '169.254.169.254', '[::1]', '2130706433', '0x7f.1', 'nohost', 'bad_label.com']) {
      expect((await validateHost(h, r)).ok, h).toBe(false);
    }
    expect(await validateHost('missing.example.com', r)).toMatchObject({ ok: false, reason: 'dns lookup failed' });
  });

  it('requires http(s), no credentials, allowed ports', async () => {
    const r = resolver({ 'good.example.com': ['93.184.216.34'] });
    await expect(assertPublicUrl(new URL('https://good.example.com/x'), r)).resolves.toBeUndefined();
    await expect(assertPublicUrl(new URL('ftp://good.example.com/'), r)).rejects.toMatchObject({ code: 'blocked' });
    await expect(assertPublicUrl(new URL('https://user:pw@good.example.com/'), r)).rejects.toMatchObject({ code: 'blocked' });
    await expect(assertPublicUrl(new URL('https://good.example.com:6379/'), r)).rejects.toMatchObject({ code: 'blocked' });
    // WHATWG URL canonicalises decimal IPv4 → 127.0.0.1, which is then blocked.
    await expect(assertPublicUrl(new URL('http://2130706433/'), r)).rejects.toMatchObject({ code: 'blocked' });
  });
});

describe('SSRF guard: safeFetch never reaches private hosts', () => {
  let server: http.Server;
  let port = 0;
  let hits = 0;
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      hits++;
      res.end('internal secret');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('blocks loopback literals and localhost names before connecting', async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({ code: 'blocked' });
    await expect(safeFetch(`http://localhost:${port}/`)).rejects.toMatchObject({ code: 'blocked' });
    await expect(safeFetch(`http://[::1]:${port}/`)).rejects.toMatchObject({ code: 'blocked' });
    await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({ code: 'blocked' });
    expect(hits).toBe(0);
    // Sanity: the server is reachable without the guard.
    await expect(httpText(`http://127.0.0.1:${port}/`)).resolves.toMatchObject({ status: 200 });
  });
});

describe('allow-lists', () => {
  const rules = [
    { host: 's3-eu-west-1.amazonaws.com', pathPrefix: '/jamcams.tfl.gov.uk/' },
    { host: '*.arcgis.com', pathPrefix: '/' },
  ];
  it('matches exact host + path prefix only', () => {
    expect(matchesAllowList(new URL('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.jpg'), rules)).toBe(true);
    expect(matchesAllowList(new URL('https://s3-eu-west-1.amazonaws.com/other-bucket/x.jpg'), rules)).toBe(false);
    expect(matchesAllowList(new URL('http://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/1.jpg'), rules)).toBe(false);
    expect(matchesAllowList(new URL('https://evil.com/jamcams.tfl.gov.uk/'), rules)).toBe(false);
    expect(matchesAllowList(new URL('https://services1.arcgis.com/x'), rules)).toBe(true);
    expect(matchesAllowList(new URL('https://arcgis.com/x'), rules)).toBe(false);
    expect(matchesAllowList(new URL('https://evilarcgis.com/x'), rules)).toBe(false);
  });
  it('cannot be escaped with encoded separators, dot segments, ports or credentials', () => {
    expect(matchesAllowList(new URL('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/..%2Fsecret'), rules)).toBe(false);
    expect(matchesAllowList(new URL('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk%2F../x'), rules)).toBe(false);
    expect(matchesAllowList(new URL('https://s3-eu-west-1.amazonaws.com:8443/jamcams.tfl.gov.uk/1.jpg'), rules)).toBe(false);
    expect(matchesAllowList(new URL('https://a:b@s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/1.jpg'), rules)).toBe(false);
  });
});
