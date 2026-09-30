import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { catalogEntry } from '@/lib/api-catalog';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';

// Fixtures: dns.google answers for example.com, recorded 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string, ip?: string) => get(GET, `http://localhost/api/osint/dns${qs}`, ip);

describe('GET /api/osint/dns', () => {
  beforeEach(() => {
    freshState();
    upstream.on('type=A&', { json: fixture('dns-google-example-A.json') });
    upstream.on(/type=A$/, { json: fixture('dns-google-example-A.json') });
    upstream.on('type=MX', { json: fixture('dns-google-example-MX.json') });
    upstream.on('dns.google/resolve', { json: { Status: 0, Answer: [] } });
  });

  it('returns records per type with SPF/DMARC/CAA findings and provider status', async () => {
    const body = await osint(await call('?domain=Example.COM'), 'dns');
    expect(body.query).toBe('example.com');
    expect(body.data.records.A.length).toBe(2);
    expect(body.data.records.MX.length).toBeGreaterThan(0);
    expect(body.providers['dns.google']).toMatchObject({ ok: true });
    expect(body.findings.map((f: { label: string }) => f.label)).toEqual(expect.arrayContaining(['No SPF record', 'No DMARC policy', 'No CAA record']));
    expect(upstream.calls.some((c) => c.url.includes('name=_dmarc.example.com'))).toBe(true);
  });

  it('queries one record type when asked', async () => {
    const body = await osint(await call('?domain=example.com&type=MX'), 'dns');
    expect(Object.keys(body.data.records)).toEqual(['MX']);
    expect(upstream.calls).toHaveLength(1);
  });

  it('normalises IDN names to punycode before any lookup', async () => {
    const body = await osint(await call(`?domain=${encodeURIComponent('bücher.de')}&type=A`), 'dns');
    expect(body.query).toBe('xn--bcher-kva.de');
    expect(upstream.calls[0]!.url).toContain('name=xn--bcher-kva.de');
  });

  it('refuses IPs, private names, URLs with credentials/ports and personal identifiers (400, no upstream call)', async () => {
    for (const bad of ['10.0.0.1', 'localhost', 'router.local', 'intranet.corp', 'a', 'user:pw@example.com', 'example.com:8080', 'http://example.com/x']) {
      await error(await call(`?domain=${encodeURIComponent(bad)}`), 400);
    }
    const personal = await error(await call(`?domain=${encodeURIComponent('someone@example.com')}`), 400);
    expect(personal.code).toBe('personal_identifier');
    expect(upstream.calls).toEqual([]);
  });

  it('answers 503 SOURCE OFFLINE with the provider status when DoH fails', async () => {
    upstream.reset();
    upstream.on('dns.google', { error: 'timeout' });
    const body = await error(await call('?domain=example.org'), 503);
    expect(body.error).toBe('source_offline');
    expect(body.providers['dns.google']).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('applies the catalogue OSINT rate limit (20/min per IP)', async () => {
    expect(catalogEntry('/api/osint/dns')?.rateLimit).toEqual({ limit: 20, windowS: 60 });
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await call('?domain=example.com&type=A', '12.0.0.1')).status);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});
