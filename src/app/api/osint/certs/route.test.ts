import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';
import { CRTSH_HTTP } from '@/components/panels/recon/server/osint';

// Fixture: crt.sh ?q=%.example.com&exclude=expired, recorded 2026-09-30 (2.4 s; 5.9 s unfiltered).
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/certs${qs}`);

describe('GET /api/osint/certs', () => {
  beforeEach(() => freshState());

  it('summarises CT logs: subdomains, issuers, recent certificates with UTC times', async () => {
    upstream.on('crt.sh', { json: fixture('crtsh-example.json') });
    const body = await osint(await call('?domain=example.com'), 'certs');
    expect(body.data.certificates).toBeGreaterThan(0);
    expect(body.data.subdomains).toContain('example.com');
    expect(body.data.subdomains.every((s: string) => s === 'example.com' || s.endsWith('.example.com'))).toBe(true);
    expect(body.data.recent[0].notBefore).toMatch(/Z$/);
    expect(body.providers['crt.sh']).toMatchObject({ ok: true });
    expect(upstream.calls[0]!.url).toContain('q=%25.example.com');
  });

  it('uses a 20 s timeout with one retry (crt.sh is slow and flaky)', async () => {
    upstream.on('crt.sh', { json: [] });
    await call('?domain=example.net');
    expect(CRTSH_HTTP).toMatchObject({ timeoutMs: 20_000, retries: 1 });
    expect(upstream.calls[0]!.opts).toMatchObject({ timeoutMs: 20_000, retries: 1 });
  });

  it('reports a crt.sh timeout as SOURCE OFFLINE, never as zero certificates', async () => {
    upstream.on('crt.sh', { error: 'timeout' });
    const body = await error(await call('?domain=example.org'), 503);
    expect(body.providers['crt.sh']).toMatchObject({ ok: false, error: 'timeout' });
  });
});
