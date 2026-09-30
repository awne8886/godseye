import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';

// Fixture: internetdb.shodan.io/1.1.1.1, recorded 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/shodan${qs}`);

describe('GET /api/osint/shodan (InternetDB)', () => {
  beforeEach(() => freshState());
  afterEach(() => vi.unstubAllEnvs());

  it('returns ports, CPEs and hostnames', async () => {
    upstream.on('internetdb.shodan.io/1.1.1.1', { json: fixture('internetdb-1.1.1.1.json') });
    const body = await osint(await call('?ip=1.1.1.1'), 'shodan');
    expect(body.data).toMatchObject({ ip: '1.1.1.1', indexed: true });
    expect(body.data.ports).toContain(443);
    expect(body.findings.some((f: { label: string }) => f.label.includes('open ports'))).toBe(true);
  });

  it('treats 404 "No information available" as a truthful not-indexed answer', async () => {
    upstream.on('internetdb.shodan.io', { status: 404, json: { detail: 'No information available' } });
    const body = await osint(await call('?ip=9.9.9.9'), 'shodan');
    expect(body.data.indexed).toBe(false);
    expect(body.providers.internetdb).toMatchObject({ ok: true, count: 0 });
  });

  it('is skipped (licence) on commercial deployments, reported as not configured', async () => {
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    const body = await error(await call('?ip=1.1.1.1'), 503);
    expect(body.error).toBe('not_configured');
    expect(body.providers.internetdb).toMatchObject({ skipped: 'licence' });
    expect(upstream.calls).toEqual([]);
  });
});
