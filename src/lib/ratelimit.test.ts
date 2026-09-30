import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRateLimitStore, QueueFullError, SerialQueue, TokenBucket, checkRateLimit, getClientIp, rateLimit, setRateLimitStore } from './ratelimit';

const h = (o: Record<string, string>) => new Headers(o);

afterEach(() => setRateLimitStore(undefined));

describe('client IP', () => {
  it('prefers platform-verified headers, then x-real-ip, then the RIGHTMOST forwarded entry', () => {
    expect(getClientIp(h({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '1.1.1.1' }), 'auto')).toBe('203.0.113.5');
    expect(getClientIp(h({ 'x-vercel-forwarded-for': '198.51.100.2' }), 'auto')).toBe('198.51.100.2');
    expect(getClientIp(h({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '6.6.6.6' }), 'auto')).toBe('9.9.9.9');
    // A client can prepend anything to XFF; only the proxy-appended rightmost entry counts.
    expect(getClientIp(h({ 'x-forwarded-for': '6.6.6.6, 8.8.4.4' }), 'auto')).toBe('8.8.4.4');
    expect(getClientIp(h({}), 'auto')).toBe('unknown');
  });

  it('ignores non-IP junk and unwraps mapped/port forms', () => {
    expect(getClientIp(h({ 'cf-connecting-ip': 'evil', 'x-real-ip': '::ffff:1.2.3.4' }), 'auto')).toBe('1.2.3.4');
    expect(getClientIp(h({ 'x-real-ip': '1.2.3.4:5555' }), 'auto')).toBe('1.2.3.4');
    expect(getClientIp(h({ 'x-real-ip': '[2001:db8::1]:443' }), 'auto')).toBe('2001:db8::1');
  });

  it('trusts only the configured header when TRUST_PROXY_HEADER is set', () => {
    expect(getClientIp(h({ 'cf-connecting-ip': '6.6.6.6', 'x-real-ip': '5.5.5.5' }), 'x-real-ip')).toBe('5.5.5.5');
  });
});

describe('rate limiting', () => {
  it('keys buckets per route and IP', async () => {
    setRateLimitStore(new MemoryRateLimitStore());
    for (let i = 0; i < 3; i++) expect((await checkRateLimit('/api/a', '1.1.1.1', 3, 60)).allowed).toBe(true);
    expect((await checkRateLimit('/api/a', '1.1.1.1', 3, 60)).allowed).toBe(false);
    expect((await checkRateLimit('/api/b', '1.1.1.1', 3, 60)).allowed).toBe(true);
    expect((await checkRateLimit('/api/a', '2.2.2.2', 3, 60)).allowed).toBe(true);
  });

  it('returns 429 with Retry-After and a JSON {error, detail}', async () => {
    setRateLimitStore(new MemoryRateLimitStore());
    const req = () => new Request('http://x/api/ai/overview', { headers: { 'x-real-ip': '7.7.7.7' } });
    for (let i = 0; i < 5; i++) expect(await rateLimit(req(), '/api/ai/overview', { limit: 5, windowS: 60 })).toBeNull();
    const res = await rateLimit(req(), '/api/ai/overview', { limit: 5, windowS: 60 });
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await res?.json()).toMatchObject({ error: 'rate_limited', retryAfter: expect.any(Number) });
  });

  it('caps memory with an LRU', async () => {
    const s = new MemoryRateLimitStore(10);
    for (let i = 0; i < 50; i++) await s.hit(`k${i}`, 60_000);
    expect((s as unknown as { buckets: Map<string, unknown> }).buckets.size).toBeLessThanOrEqual(10);
  });
});

describe('upstream politeness', () => {
  it('token bucket spaces calls at the configured rate', async () => {
    const b = new TokenBucket(20, 1); // one every 50 ms
    const t0 = Date.now();
    await Promise.all([b.take(), b.take(), b.take()]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
  });

  it('serial queue runs one at a time with a gap and rejects when full', async () => {
    const q = new SerialQueue(30, 2);
    const order: number[] = [];
    const t0 = Date.now();
    const a = q.run(async () => order.push(1));
    const b = q.run(async () => order.push(2));
    await expect(q.run(async () => 3)).rejects.toBeInstanceOf(QueueFullError);
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
    expect(q.rejected).toBe(1);
    expect(q.served).toBe(2);
  });
});
