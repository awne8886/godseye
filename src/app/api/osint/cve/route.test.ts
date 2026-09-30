import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';

// Fixtures: MITRE CVE Services, CIRCL and NVD 2.0 for CVE-2024-3400, recorded 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/cve${qs}`);

describe('GET /api/osint/cve', () => {
  beforeEach(() => freshState());

  it('merges MITRE and NVD, with the CISA KEV flag as a critical finding', async () => {
    upstream.on('cveawg.mitre.org', { json: fixture('mitre-CVE-2024-3400.json') });
    upstream.on('services.nvd.nist.gov', { json: fixture('nvd-CVE-2024-3400.json') });
    const body = await osint(await call('?id=cve-2024-3400'), 'cve');
    expect(body.query).toBe('CVE-2024-3400');
    expect(body.data.cvss.score).toBe(10);
    expect(body.data.kev).toMatchObject({ dateAdded: '2024-04-12' });
    expect(body.data.published).toMatch(/^2024-04-12T/);
    expect(body.findings[0]).toMatchObject({ level: 'critical', label: 'Known exploited (CISA KEV)' });
    expect(Object.keys(body.providers).sort()).toEqual(['mitre', 'nvd']);
  });

  it('falls back to CIRCL when MITRE fails and still reports NVD failure', async () => {
    upstream.on('cveawg.mitre.org', { status: 503 });
    upstream.on('services.nvd.nist.gov', { status: 403 });
    upstream.on('cve.circl.lu', { json: fixture('circl-CVE-2024-3400.json') });
    const body = await osint(await call('?id=CVE-2024-3400'), 'cve');
    expect(body.providers.mitre.ok).toBe(false);
    expect(body.providers.nvd).toMatchObject({ ok: false, error: 'http_403' });
    expect(body.providers.circl.ok).toBe(true);
    expect(body.data.kev).toBeNull();
  });

  it('validates the id', async () => {
    for (const bad of ['CVE-24-1', '2024-3400', 'CVE-2024-3400;rm']) await error(await call(`?id=${encodeURIComponent(bad)}`), 400);
  });
});
