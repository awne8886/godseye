// Phase 1 review B regressions (M1, M2).
import { describe, expect, it } from 'vitest';
import { SseHub } from '@/lib/sse';

const req = (ac: AbortController) => new Request('http://x/api/stream', { signal: ac.signal, headers: { 'x-forwarded-for': '203.0.113.7' } });

describe('review: SseHub per-IP accounting', () => {
  it('MAJOR: a disconnect that both cancels the body and aborts the request decrements the per-IP count twice (cap bypass)', async () => {
    const hub = new SseHub('rv-double', () => null, 100, 2);
    const a1 = new AbortController();
    const a2 = new AbortController();
    const r1 = hub.subscribe(req(a1), undefined, '203.0.113.7');
    hub.subscribe(req(a2), undefined, '203.0.113.7');
    await new Promise((r) => setTimeout(r, 0)); // both streams are up
    // Client 1 goes away: the runtime cancels the body stream AND aborts request.signal.
    await r1.body!.cancel();
    a1.abort();
    await new Promise((r) => setTimeout(r, 0)); // let the abort propagate to request.signal
    // One stream (r2) is still open, so this IP may open exactly one more.
    const r3 = hub.subscribe(req(new AbortController()), undefined, '203.0.113.7');
    expect(r3.status).toBe(200);
    const r4 = hub.subscribe(req(new AbortController()), undefined, '203.0.113.7');
    expect(r4.status).toBe(429);
  });

  it('MAJOR: a throwing snapshot() leaks the per-IP slot forever (IP locked out after perIp failures)', async () => {
    let fail = true;
    const hub = new SseHub('rv-leak', () => {
      if (fail) throw new Error('feed not ready');
      return { ok: true };
    }, 100, 2);
    for (let i = 0; i < 2; i++) {
      const res = hub.subscribe(req(new AbortController()), undefined, '198.51.100.9');
      await res.text(); // stream sends `error` and closes
    }
    fail = false;
    const res = hub.subscribe(req(new AbortController()), undefined, '198.51.100.9');
    expect(res.status).toBe(200);
    expect(hub.openFor('198.51.100.9')).toBe(1);
  });

  it('MAJOR: send() ignores back-pressure, so a client that never reads buffers every broadcast in memory', () => {
    const hub = new SseHub('rv-slow', () => null, 100, 4);
    hub.subscribe(req(new AbortController()), undefined, '192.0.2.44'); // never read
    const payload = { blob: 'x'.repeat(64 * 1024) };
    let delivered = 0;
    for (let i = 0; i < 200; i++) delivered += hub.broadcast('update', payload); // ~12.8 MB queued
    expect(delivered).toBeLessThan(200);
    expect(hub.size).toBe(0);
    expect(hub.openFor('192.0.2.44')).toBe(0);
  });
});

describe('sseFrame', () => {
  it('treats a bare CR as a line break so payloads cannot inject fields', async () => {
    const { sseFrame } = await import('@/lib/sse');
    expect(sseFrame('update', 'a\revent: x')).toBe('event: update\ndata: a\ndata: event: x\n\n');
  });
});
