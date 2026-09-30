import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError, errorReason, httpJson, httpRequest, httpText } from './http';

let server: http.Server;
let base = '';
const hits: Record<string, number> = {};
const seenHeaders: Record<string, http.IncomingHttpHeaders> = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    hits[path] = (hits[path] ?? 0) + 1;
    seenHeaders[path] = req.headers;
    if (path === '/json-text') {
      res.setHeader('content-type', 'text/html'); // EONET-style lie
      res.end('{"ok":true}');
    } else if (path === '/gzip') {
      res.setHeader('content-encoding', 'gzip');
      res.end(zlib.gzipSync(JSON.stringify({ enc: 'gzip' })));
    } else if (path === '/br') {
      res.setHeader('content-encoding', 'br');
      res.end(zlib.brotliCompressSync(JSON.stringify({ enc: 'br' })));
    } else if (path === '/flaky') {
      if (hits[path]! < 3) {
        res.statusCode = 503;
        res.setHeader('retry-after', '0');
        res.end('busy');
      } else res.end('{"n":3}');
    } else if (path === '/always503') {
      res.statusCode = 503;
      res.setHeader('retry-after', '0');
      res.end();
    } else if (path === '/etag') {
      if (req.headers['if-none-match'] === '"v1"') {
        res.statusCode = 304;
        res.end();
      } else {
        res.setHeader('etag', '"v1"');
        res.end('{"v":1}');
      }
    } else if (path === '/big') {
      res.end('x'.repeat(5000));
    } else if (path === '/slow') {
      setTimeout(() => res.end('late'), 500);
    } else if (path === '/redirect') {
      res.statusCode = 302;
      res.setHeader('location', '/json-text');
      res.end();
    } else if (path === '/redirect-private') {
      res.statusCode = 302;
      res.setHeader('location', 'http://169.254.169.254/latest/meta-data/');
      res.end();
    } else if (path === '/404') {
      res.statusCode = 404;
      res.end('{"error":"nope"}');
    } else res.end('ok');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('http client', () => {
  it('sends an identifying GODSEYE User-Agent and parses JSON regardless of content-type', async () => {
    const r = await httpJson<{ ok: boolean }>(`${base}/json-text`);
    expect(r.data).toEqual({ ok: true });
    expect(seenHeaders['/json-text']!['user-agent']).toMatch(/^GODSEYE\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/awne8886\/godseye; contact /);
    expect(seenHeaders['/json-text']!['accept-encoding']).toContain('br');
  });

  it('decodes gzip and brotli', async () => {
    expect((await httpJson(`${base}/gzip`)).data).toEqual({ enc: 'gzip' });
    expect((await httpJson(`${base}/br`)).data).toEqual({ enc: 'br' });
  });

  it('retries retryable statuses and honours Retry-After', async () => {
    const r = await httpJson<{ n: number }>(`${base}/flaky`, { retries: 3 });
    expect(r.data).toEqual({ n: 3 });
    expect(r.attempts).toBe(3);
    await expect(httpJson(`${base}/always503`, { retries: 1 })).rejects.toMatchObject({ code: 'http', status: 503 });
    expect(hits['/always503']).toBe(2);
  });

  it('does not retry POST', async () => {
    await expect(httpRequest(`${base}/always503`, { method: 'POST', body: '{}' })).resolves.toMatchObject({ status: 503 });
  });

  it('supports conditional GET', async () => {
    const first = await httpJson(`${base}/etag`);
    expect(first.etag).toBe('"v1"');
    const second = await httpJson(`${base}/etag`, { etag: first.etag });
    expect(second.notModified).toBe(true);
    expect(second.data).toBeUndefined();
  });

  it('caps body size and times out', async () => {
    await expect(httpText(`${base}/big`, { maxBytes: 100 })).rejects.toMatchObject({ code: 'too_large' });
    await expect(httpText(`${base}/slow`, { timeoutMs: 50, retries: 0 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('refuses spoofed forwarding headers and browser user agents', async () => {
    await expect(httpText(`${base}/`, { headers: { 'X-Forwarded-For': '1.2.3.4' } })).rejects.toMatchObject({ code: 'blocked' });
    await expect(httpText(`${base}/`, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/140' } })).rejects.toMatchObject({ code: 'blocked' });
    await expect(httpText(`${base}/`, { headers: { 'User-Agent': 'GODSEYE/0.1.0 (test)' } })).resolves.toMatchObject({ status: 200 });
  });

  it('follows redirects and validates every hop', async () => {
    const hops: string[] = [];
    const r = await httpJson(`${base}/redirect`, { validateUrl: (u) => void hops.push(u.pathname) });
    expect(r.data).toEqual({ ok: true });
    expect(hops).toEqual(['/redirect', '/json-text']);
    const block = (u: URL) => {
      if (u.hostname === '169.254.169.254') throw new HttpError('Blocked host', 'blocked', u.toString());
    };
    await expect(httpText(`${base}/redirect-private`, { validateUrl: block })).rejects.toMatchObject({ code: 'blocked' });
    await expect(httpRequest(`${base}/redirect`, { maxRedirects: 0 })).resolves.toMatchObject({ status: 302 });
  });

  it('throws on non-2xx for JSON/text helpers and maps error reasons', async () => {
    const e = await httpJson(`${base}/404`).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(errorReason(e)).toBe('http_404');
    expect(errorReason(new Error('empty'))).toBe('empty');
  });

  it('rejects non-http protocols', async () => {
    await expect(httpText('file:///etc/passwd')).rejects.toMatchObject({ code: 'blocked' });
  });
});
