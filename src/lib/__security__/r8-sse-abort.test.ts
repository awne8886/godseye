/**
 * Security (round 8): an SSE subscription must give its per-IP (and IPv6 /48) slot back when the
 * client went away BEFORE the hub subscribed it. /api/flights/stream and /api/malware/stream first
 * `await feed.get()` (seconds on a cold feed); a client that disconnects during that wait reaches
 * `hub.subscribe()` with `req.signal` already aborted. The 'abort' event has fired by then, so a
 * listener added afterwards never runs, and Next never reads or cancels the body of a response to a
 * closed socket. Reproduced on `next start` (12deb0d): four SSE connects dropped during the cold
 * prime left that IP answered 429 `too_many_streams` on every later connect.
 */
import { describe, expect, it } from 'vitest';
import { SseHub } from '../sse';

const tick = () => new Promise((r) => setTimeout(r, 10));

function abortedRequest(): Request {
  const ac = new AbortController();
  ac.abort();
  return new Request('http://x/api/flights/stream', { signal: ac.signal });
}

describe('SSE slots for clients that left before subscribe', () => {
  it('a request aborted before subscribe() holds no per-IP slot and no hub client', async () => {
    const hub = new SseHub('r8-preaborted', () => ({ items: [] }));
    const ip = '198.51.100.10';
    // Nobody reads or cancels these bodies: the socket they belong to is already closed.
    for (let i = 0; i < 4; i++) hub.subscribe(abortedRequest(), undefined, ip);
    await tick();
    expect(hub.openFor(ip)).toBe(0);
    expect(hub.size).toBe(0);
    expect(hub.subscribe(new Request('http://x/'), undefined, ip).status).toBe(200);
  });

  it('IPv6: pre-aborted requests do not use up the /48 aggregate', async () => {
    const hub = new SseHub('r8-preaborted-48', () => null);
    const ip = (n: number) => `2a01:4f8:1234:${n.toString(16)}::1`;
    for (let i = 0; i < 32; i++) hub.subscribe(abortedRequest(), undefined, ip(i));
    await tick();
    expect(hub.subscribe(new Request('http://x/'), undefined, ip(200)).status).toBe(200);
  });

  it('control: a client that disconnects after subscribe() releases its slot (passes today)', async () => {
    const hub = new SseHub('r8-postabort', () => null);
    const ip = '198.51.100.11';
    const acs = Array.from({ length: 4 }, () => new AbortController());
    for (const ac of acs) expect(hub.subscribe(new Request('http://x/', { signal: ac.signal }), undefined, ip).status).toBe(200);
    expect(hub.subscribe(new Request('http://x/'), undefined, ip).status).toBe(429);
    for (const ac of acs) ac.abort();
    await tick();
    expect(hub.openFor(ip)).toBe(0);
  });
});
