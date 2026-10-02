/**
 * Security (round 6): credential headers (x-apikey for AeroAPI, authorization, cookies) are dropped
 * when an upstream redirects to another origin, and the identifying UA cannot be swapped for a
 * browser UA or a spoofed client IP.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpRequest } from '../http';

describe('cross-origin redirect strips credential headers', () => {
  const seen: { port: number; headers: http.IncomingHttpHeaders }[] = [];
  let a: http.Server;
  let b: http.Server;
  let pa = 0;
  let pb = 0;
  beforeAll(async () => {
    b = http.createServer((req, res) => {
      seen.push({ port: pb, headers: req.headers });
      res.end('{}');
    });
    await new Promise<void>((r) => b.listen(0, '127.0.0.1', r));
    pb = (b.address() as AddressInfo).port;
    a = http.createServer((req, res) => {
      seen.push({ port: pa, headers: req.headers });
      if (req.url === '/same') {
        res.statusCode = 302;
        res.setHeader('location', '/final');
        return res.end();
      }
      if (req.url === '/final') return res.end('{}');
      res.statusCode = 302;
      res.setHeader('location', `http://127.0.0.1:${pb}/elsewhere`);
      res.end();
    });
    await new Promise<void>((r) => a.listen(0, '127.0.0.1', r));
    pa = (a.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => a.close(() => r()));
    await new Promise<void>((r) => b.close(() => r()));
  });

  it('keeps x-apikey on a same-origin hop, drops it (and authorization/cookie) cross-origin', async () => {
    const headers = { 'x-apikey': 'SECRET-K', authorization: 'Bearer SECRET-T', cookie: 's=SECRET-C' };
    seen.length = 0;
    await httpRequest(`http://127.0.0.1:${pa}/same`, { headers, retries: 0 });
    expect(seen.map((s) => s.headers['x-apikey'])).toEqual(['SECRET-K', 'SECRET-K']);
    seen.length = 0;
    await httpRequest(`http://127.0.0.1:${pa}/cross`, { headers, retries: 0 });
    const other = seen.find((s) => s.port === pb)!;
    expect(other).toBeDefined();
    expect(JSON.stringify(other.headers)).not.toContain('SECRET');
    expect(other.headers['user-agent']).toMatch(/godseye/i);
  });

  it('refuses spoofed client-IP headers and browser UAs', async () => {
    for (const h of <Record<string, string>[]>[{ 'x-forwarded-for': '1.2.3.4' }, { 'X-Real-IP': '1.2.3.4' }, { forwarded: 'for=1.2.3.4' }, { 'user-agent': 'Mozilla/5.0 Chrome/140' }]) {
      await expect(httpRequest(`http://127.0.0.1:${pa}/final`, { headers: h, retries: 0 })).rejects.toMatchObject({ code: 'blocked' });
    }
  });
});
