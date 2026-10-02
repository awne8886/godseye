// Phase 1 review B regressions (M4, M5, minor 8, 9).
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRateLimitStore, RedisRateLimitStore, checkRateLimit, getClientIp, ipTrustFromEnv, providerBucket, rateLimit, setRateLimitStore } from '@/lib/ratelimit';

afterEach(() => setRateLimitStore(undefined));

describe('client IP keying', () => {
  it('ignores a client-supplied X-Real-IP unless the operator trusts it explicitly', async () => {
    setRateLimitStore(new MemoryRateLimitStore());
    const mk = (spoof: string) =>
      new Request('http://x/api/osint/dns', {
        // A PaaS edge (ALB, Cloud Run, Render, Railway, Fly) appends the real peer to XFF and passes X-Real-IP through.
        headers: { 'x-forwarded-for': `${spoof}, 81.2.69.160`, 'x-real-ip': spoof },
      });
    expect(await rateLimit(mk('10.9.9.1'), '/api/osint/dns', { limit: 1, windowS: 60 })).toBeNull();
    const second = await rateLimit(mk('10.9.9.2'), '/api/osint/dns', { limit: 1, windowS: 60 });
    expect(second?.status).toBe(429);
    expect(getClientIp(new Headers({ 'x-real-ip': '81.2.69.160' }), ipTrustFromEnv({ TRUST_PROXY_HEADER: 'x-real-ip' }))).toBe('81.2.69.160');
    expect(getClientIp(new Headers({ 'x-real-ip': '81.2.69.160' }), ipTrustFromEnv({}))).toBe('unknown');
  });

  it('takes the entry our proxies appended, counting TRUSTED_PROXY_HOPS from the right', () => {
    const h = new Headers({ 'x-forwarded-for': '6.6.6.6, 81.2.69.160, 10.0.0.2' });
    expect(getClientIp(h, ipTrustFromEnv({}))).toBe('10.0.0.2');
    expect(getClientIp(h, ipTrustFromEnv({ TRUSTED_PROXY_HOPS: '2' }))).toBe('81.2.69.160');
    expect(getClientIp(h, ipTrustFromEnv({ TRUSTED_PROXY_HOPS: 'junk' }))).toBe('10.0.0.2');
  });
});

describe('Redis fixed window', () => {
  it('a key recreated after expiry always gets a TTL (no permanent 429)', async () => {
    let now = 1_000_000;
    const db = new Map<string, { v: number; exp: number | null }>();
    const live = (k: string) => {
      const e = db.get(k);
      if (e && e.exp !== null && e.exp <= now) db.delete(k);
      return db.get(k);
    };
    // Executes the same steps as the Lua script, atomically.
    const fake = {
      async eval(_script: string, _n: number, k: string | number, windowMs: string | number) {
        const e = live(String(k)) ?? { v: 0, exp: null };
        e.v++;
        if (e.exp === null) e.exp = now + Number(windowMs);
        db.set(String(k), e);
        return [e.v, e.exp - now];
      },
    };
    const store = new RedisRateLimitStore('redis://unused');
    (store as unknown as { client: Promise<unknown> }).client = Promise.resolve(fake);
    await store.hit('r:ip', 5);
    now += 5;
    await store.hit('r:ip', 5);
    now += 3_600_000;
    const later = await store.hit('r:ip', 5);
    expect(later.count).toBe(1);
  });
});

describe('memory limiter saturation', () => {
  it('never evicts live windows; a saturated table denies fail-closed buckets only', async () => {
    const s = new MemoryRateLimitStore(2);
    setRateLimitStore(s);
    expect((await checkRateLimit('ai', '1.1.1.1', 1, 60, true)).allowed).toBe(true);
    await checkRateLimit('ai', '2.2.2.2', 1, 60, true);
    // A third client arrives while both windows are live: its window cannot be tracked.
    expect((await checkRateLimit('ai', '3.3.3.3', 1, 60, true)).allowed).toBe(false);
    expect((await checkRateLimit('osint', '3.3.3.3', 1, 60, false)).allowed).toBe(true);
    // The first client's counter survived the pressure.
    expect((await checkRateLimit('ai', '1.1.1.1', 1, 60, true)).allowed).toBe(false);
  });
});

describe('providerBucket', () => {
  it('refuses a second definition with a different rate', () => {
    providerBucket('rv-nvd', 5 / 30);
    expect(providerBucket('rv-nvd', 5 / 30)).toBeDefined();
    expect(() => providerBucket('rv-nvd', 1)).toThrow(/already exists/);
  });
});
