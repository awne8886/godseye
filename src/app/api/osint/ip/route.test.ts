import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';

// Fixtures: ipwho.is, freeipapi v1, ip-api and RIPEstat network-info for 8.8.8.8, recorded 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/ip${qs}`);

describe('GET /api/osint/ip', () => {
  beforeEach(() => {
    freshState();
    upstream.on('ipwho.is/8.8.8.8', { json: fixture('ipwho-8.8.8.8.json') });
    upstream.on('ip-api.com/json/8.8.8.8', { json: fixture('ipapi-8.8.8.8.json') });
    upstream.on('free.freeipapi.com', { json: fixture('freeipapi-8.8.8.8.json') });
    upstream.on('stat.ripe.net/data/network-info', { json: fixture('ripe-network-info-8.8.8.8.json') });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('merges geolocation, ASN/prefix and hosting/proxy flags with every provider listed', async () => {
    const body = await osint(await call('?ip=8.8.8.8'), 'ip');
    expect(body.data).toMatchObject({ ip: '8.8.8.8', countryCode: 'US', asn: 15169, prefix: '8.8.8.0/24' });
    expect(body.data.flags).toMatchObject({ hosting: true, proxy: true });
    expect(Object.keys(body.providers).sort()).toEqual(['ip-api', 'ipwho.is', 'ripestat']);
    expect(body.findings.map((f: { label: string }) => f.label)).toContain('Hosting / data-centre address');
    expect(upstream.calls.find((c) => c.url.includes('stat.ripe.net'))!.url).toContain('sourceapp=godseye');
  });

  it('skips ip-api (non-commercial) on commercial deployments and says so', async () => {
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    const body = await osint(await call('?ip=8.8.8.8'), 'ip');
    expect(body.providers['ip-api']).toMatchObject({ ok: false, skipped: 'licence' });
    expect(upstream.calls.some((c) => c.url.includes('ip-api.com'))).toBe(false);
  });

  it('falls back to freeipapi and flags OFAC comprehensive-sanctions countries', async () => {
    upstream.reset();
    upstream.on('ipwho.is', { error: 'timeout' });
    upstream.on('free.freeipapi.com', { json: { ...fixture<Record<string, unknown>>('freeipapi-8.8.8.8.json'), countryCode: 'IR', countryName: 'Iran' } });
    upstream.on('ip-api.com', { status: 500 });
    upstream.on('stat.ripe.net', { status: 500 });
    const body = await osint(await call('?ip=5.160.0.1'), 'ip');
    expect(body.providers['ipwho.is'].ok).toBe(false);
    expect(body.providers.freeipapi.ok).toBe(true);
    expect(body.findings.find((f: { label: string }) => f.label.startsWith('OFAC'))?.level).toBe('medium');
  });

  it('refuses private/reserved addresses and non-IPs', async () => {
    for (const bad of ['10.1.1.1', '192.168.0.1', '127.0.0.1', '::1', 'fe80::1', '100.64.0.1', 'example.com', '999.1.1.1']) await error(await call(`?ip=${encodeURIComponent(bad)}`), 400);
    expect(upstream.calls).toEqual([]);
  });
});
