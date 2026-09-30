import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { catalogEntry } from '@/lib/api-catalog';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';
import { prefixAddresses } from '@/components/panels/recon/server/osint';

// Fixtures: InternetDB 1.1.1.1 and ipwho.is 8.8.8.8, recorded 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/sweep${qs}`);

describe('GET /api/osint/sweep', () => {
  beforeEach(() => freshState());
  afterEach(() => vi.unstubAllEnvs());

  it('enumerates the prefix', () => {
    expect(prefixAddresses('1.1.1.6', 30)).toEqual(['1.1.1.4', '1.1.1.5', '1.1.1.6', '1.1.1.7']);
    expect(prefixAddresses('1.1.1.1', 32)).toEqual(['1.1.1.1']);
    expect(prefixAddresses('1.1.1.200', 28)).toHaveLength(16);
  });

  it('reads existing InternetDB data for each address (no packets to the targets)', async () => {
    upstream.on('internetdb.shodan.io/1.1.1.1', { json: fixture('internetdb-1.1.1.1.json') });
    upstream.on('internetdb.shodan.io', { status: 404, json: { detail: 'No information available' } });
    const body = await osint(await call('?ip=1.1.1.1&cidr=30'), 'sweep');
    expect(body.query).toBe('1.1.1.1/30');
    expect(body.data).toMatchObject({ prefix: '1.1.1.0/30', scanned: 4, total: 4 });
    expect(body.data.hosts).toHaveLength(1);
    expect(upstream.calls.every((c) => c.url.startsWith('https://internetdb.shodan.io/'))).toBe(true);
    expect(body.providers.internetdb).toMatchObject({ ok: true, count: 1 });
  });

  it('refuses prefixes larger than /28, IPv6 and private space', async () => {
    for (const qs of ['?ip=1.1.1.1&cidr=24', '?ip=1.1.1.1&cidr=27', '?ip=2606:4700::1111', '?ip=10.0.0.1&cidr=30']) await error(await call(qs), 400);
    expect(upstream.calls).toEqual([]);
    expect(catalogEntry('/api/osint/sweep')?.rateLimit).toEqual({ limit: 5, windowS: 60 });
  });

  it('without nc_sources reports InternetDB skipped and only the network owner (ipwho.is)', async () => {
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    upstream.on('ipwho.is/8.8.8.8', { json: fixture('ipwho-8.8.8.8.json') });
    const body = await osint(await call('?ip=8.8.8.8&cidr=32'), 'sweep');
    expect(body.providers.internetdb).toMatchObject({ skipped: 'licence' });
    expect(body.data.owner).toMatchObject({ asn: 15169 });
  });
});
