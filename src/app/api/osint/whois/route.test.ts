import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';
import { whoisLookup } from '@/components/panels/recon/server/osint';

// Fixture: rdap.org → registry RDAP for example.com, recorded 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/whois${qs}`);

describe('GET /api/osint/whois', () => {
  beforeEach(() => {
    freshState();
    upstream.on('rdap.org/domain/example.com', { redirect: 'https://rdap.verisign.com/com/v1/domain/example.com' });
    upstream.on('rdap.verisign.com', { json: fixture('rdap-example.json') });
  });

  it('normalises RDAP (following the bootstrap redirect) with registrar, dates, status and nameservers', async () => {
    const body = await osint(await call('?domain=example.com'), 'whois');
    expect(body.data).toMatchObject({ domain: 'example.com' });
    expect(body.data.registered).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.data.expires).toMatch(/Z$/);
    expect(body.data.status).toContain('client transfer prohibited');
    expect(body.data.nameservers.length).toBeGreaterThan(0);
    expect(body.providers['rdap.org'].ok).toBe(true);
    expect(upstream.calls.map((c) => new URL(c.url).host)).toEqual(['rdap.org', 'rdap.verisign.com']);
  });

  it('flags a registration that expires within 30 days', async () => {
    const r = await whoisLookup('example.com', Date.parse('2027-08-01T00:00:00Z'));
    expect(r.findings.find((f) => f.label === 'Expires soon')?.level).toBe('medium');
    const later = await whoisLookup('example.com', Date.parse('2027-12-01T00:00:00Z'));
    expect(later.findings.find((f) => f.label === 'Registration expired')?.level).toBe('high');
  });

  it('reports RDAP failures honestly', async () => {
    upstream.reset();
    upstream.on('rdap.org', { status: 404 });
    const body = await error(await call('?domain=unregistered-example-name.com'), 503);
    expect(body.providers['rdap.org']).toMatchObject({ ok: false, error: 'http_404' });
  });
});
