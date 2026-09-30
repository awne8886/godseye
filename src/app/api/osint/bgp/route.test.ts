import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';
import { DailyBudget, RIPE_MAX_CONCURRENT, Semaphore, ripeState } from '@/components/panels/recon/server/ripe';

// Fixtures: RIPEstat as-overview / announced-prefixes / asn-neighbours for AS15169 (trimmed), 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/bgp${qs}`);

describe('GET /api/osint/bgp', () => {
  beforeEach(() => {
    freshState();
    ripeState.budget.used = 0;
    upstream.on('as-overview', { json: fixture('ripe-as-overview-15169.json') });
    upstream.on('announced-prefixes', { json: fixture('ripe-announced-prefixes-15169.json') });
    upstream.on('asn-neighbours', { json: fixture('ripe-asn-neighbours-15169.json') });
    upstream.on('network-info', { json: fixture('ripe-network-info-8.8.8.8.json') });
  });

  it('returns holder, prefixes and neighbours for an ASN', async () => {
    const body = await osint(await call('?query=as15169'), 'bgp');
    expect(body.query).toBe('AS15169');
    expect(body.data.holder).toMatch(/GOOGLE/);
    expect(body.data.prefixCount).toBe(12);
    expect(body.data.upstreams.length).toBeGreaterThan(0);
    expect(body.providers.ripestat).toMatchObject({ ok: true });
  });

  it('resolves an IP to its origin ASN first', async () => {
    const body = await osint(await call('?query=8.8.8.8'), 'bgp');
    expect(body.data).toMatchObject({ prefix: '8.8.8.0/24', asn: 15169 });
  });

  it('stops at the daily budget and reports skipped: budget', async () => {
    ripeState.budget.used = ripeState.budget.limit;
    const body = await error(await call('?query=AS3333'), 503);
    expect(body.providers.ripestat).toMatchObject({ ok: false, skipped: 'budget' });
    expect(upstream.calls).toEqual([]);
  });

  it('rejects junk', async () => {
    for (const bad of ['ASX', '10.0.0.1', 'example.com']) await error(await call(`?query=${bad}`), 400);
  });
});

describe('RIPEstat politeness', () => {
  it('never runs more than 8 requests at once', async () => {
    const sem = new Semaphore(RIPE_MAX_CONCURRENT);
    let peak = 0;
    const jobs = Array.from({ length: 30 }, () =>
      sem.run(async () => {
        peak = Math.max(peak, sem.inFlight);
        await new Promise((r) => setTimeout(r, 2));
      }),
    );
    await Promise.all(jobs);
    expect(peak).toBe(8);
    expect(sem.inFlight).toBe(0);
  });

  it('resets the daily budget at the UTC day boundary', () => {
    const b = new DailyBudget(2);
    const d1 = Date.parse('2026-09-30T23:59:00Z');
    expect([b.tryTake(d1), b.tryTake(d1), b.tryTake(d1)]).toEqual([true, true, false]);
    expect(b.tryTake(Date.parse('2026-10-01T00:00:01Z'))).toBe(true);
  });
});
