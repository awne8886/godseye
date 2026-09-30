import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpStream } from './http';

let server: http.Server;
let base = '';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let n = 0;
      const t = setInterval(() => {
        res.write(`data: ${n}\n\n`);
        if (++n === 3) {
          clearInterval(t);
          res.end();
        }
      }, 20);
    } else if (req.url === '/stall') {
      res.writeHead(200);
      res.write('first');
      // never ends
    } else if (req.url === '/big') {
      res.writeHead(200);
      res.end('x'.repeat(5000));
    } else if (req.url === '/echo-ua') {
      res.writeHead(200);
      res.end(`${req.headers['user-agent']}|${req.headers['accept-encoding']}`);
    } else {
      res.writeHead(429, { 'retry-after': '3' });
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const collect = async (it: AsyncIterable<Uint8Array>) => {
  const parts: string[] = [];
  for await (const c of it) parts.push(Buffer.from(c).toString());
  return parts;
};

describe('httpStream', () => {
  it('yields chunks as they arrive, with the honest UA and identity encoding', async () => {
    const s = await httpStream(`${base}/stream`);
    const parts = await collect(s.body);
    expect(parts.join('')).toBe('data: 0\n\ndata: 1\n\ndata: 2\n\n');
    expect(parts.length).toBeGreaterThan(1);
    const echo = (await collect((await httpStream(`${base}/echo-ua`)).body)).join('');
    expect(echo).toMatch(/^GODSEYE\/\d+\.\d+\.\d+ .*\|identity$/);
  });

  it('times out when the upstream stalls between chunks', async () => {
    const s = await httpStream(`${base}/stall`, { timeoutMs: 150 });
    await expect(collect(s.body)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('caps the body size, rejects non-2xx with the status and refuses forged headers', async () => {
    await expect(collect((await httpStream(`${base}/big`, { maxBytes: 100 })).body)).rejects.toMatchObject({ code: 'too_large' });
    await expect(httpStream(`${base}/nope`)).rejects.toMatchObject({ code: 'http', status: 429, retryAfterMs: 3000 });
    await expect(httpStream(`${base}/stream`, { headers: { 'x-forwarded-for': '1.2.3.4' } })).rejects.toMatchObject({ code: 'blocked' });
  });

  it('honours validateUrl and abort signals', async () => {
    await expect(
      httpStream(`${base}/stream`, {
        validateUrl: () => {
          throw Object.assign(new Error('blocked'), { code: 'blocked' });
        },
      }),
    ).rejects.toThrow('blocked');
    const ac = new AbortController();
    const s = await httpStream(`${base}/stall`, { signal: ac.signal, timeoutMs: 5000 });
    const p = collect(s.body);
    ac.abort();
    await expect(p).rejects.toBeTruthy();
  });
});
