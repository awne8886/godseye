import { describe, expect, it } from 'vitest';
import { SSE_HEADERS, SseHub, sseFrame, sseResponse } from './sse';

async function readSome(res: Response, until: (text: string) => boolean): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = '';
  while (!until(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  await reader.cancel();
  return text;
}

describe('SSE', () => {
  it('frames events per the spec (multi-line data, ids)', () => {
    expect(sseFrame('status', { a: 1 }, 7)).toBe('id: 7\nevent: status\ndata: {"a":1}\n\n');
    expect(sseFrame('msg', 'line1\nline2')).toBe('event: msg\ndata: line1\ndata: line2\n\n');
    expect(() => sseFrame('bad\nevent', 1)).toThrow();
  });

  it('sets proxy-safe headers and sends retry + events', async () => {
    const ac = new AbortController();
    const res = sseResponse(new Request('http://x/', { signal: ac.signal }), (send) => {
      send('snapshot', { n: 1 });
    });
    for (const [k, v] of Object.entries(SSE_HEADERS)) expect(res.headers.get(k)).toBe(v);
    const text = await readSome(res, (t) => t.includes('event: snapshot'));
    expect(text).toContain('retry: 5000');
    expect(text).toContain('data: {"n":1}');
    ac.abort();
  });

  it('hub sends the snapshot on connect and broadcasts to subscribers', async () => {
    const hub = new SseHub('test', () => ({ items: [1] }));
    const ac = new AbortController();
    const res = hub.subscribe(new Request('http://x/', { signal: ac.signal }));
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    while (!text.includes('event: snapshot')) text += dec.decode((await reader.read()).value);
    expect(hub.size).toBe(1);
    expect(hub.broadcast('detections', [{ id: 'x' }])).toBe(1);
    while (!text.includes('event: detections')) text += dec.decode((await reader.read()).value);
    await reader.cancel();
    ac.abort();
    await new Promise((r) => setTimeout(r, 5));
    expect(hub.broadcast('detections', [])).toBe(0);
  });

  it('refuses new streams past the cap', () => {
    const hub = new SseHub('capped', () => null, 0);
    expect(hub.subscribe(new Request('http://x/')).status).toBe(503);
  });
});

describe('SSE per-IP cap', () => {
  it('allows at most 4 concurrent streams per client IP', () => {
    const hub = new SseHub('per-ip', () => null);
    const open = Array.from({ length: 4 }, () => hub.subscribe(new Request('http://x/'), undefined, '5.6.7.8'));
    expect(open.every((r) => r.status === 200)).toBe(true);
    expect(hub.subscribe(new Request('http://x/'), undefined, '5.6.7.8').status).toBe(429);
    expect(hub.subscribe(new Request('http://x/'), undefined, '5.6.7.9').status).toBe(200);
  });

  it('caps a whole IPv6 /48 at 8× the per-client limit and releases it when streams close', async () => {
    const hub = new SseHub('per-48', () => null);
    const ip = (n: number) => `2001:db8:99:${n.toString(16)}::1`;
    const open = Array.from({ length: 32 }, (_, i) => hub.subscribe(new Request('http://x/'), undefined, ip(i)));
    expect(open.every((r) => r.status === 200)).toBe(true);
    expect(hub.subscribe(new Request('http://x/'), undefined, ip(99)).status).toBe(429);
    expect(hub.subscribe(new Request('http://x/'), undefined, '2001:db8:aa::1').status).toBe(200);
    await open[0]!.body!.cancel();
    expect(hub.subscribe(new Request('http://x/'), undefined, ip(98)).status).toBe(200);
  });
});
