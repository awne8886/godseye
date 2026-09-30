import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { catalogEntry } from '@/lib/api-catalog';
import { upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';
import { availableScans } from '@/components/panels/recon/server/scanner';

vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/scanner${qs}`);

describe('GET /api/scanner', () => {
  beforeEach(() => freshState());
  afterEach(() => vi.unstubAllEnvs());

  it('is off (503 not_configured) unless SCANNER_URL and SCANNER_KEY are set', async () => {
    const body = await error(await call('?type=ssl&target=1.1.1.1'), 503);
    expect(body.error).toBe('not_configured');
    expect(upstream.calls).toEqual([]);
  });

  describe('when configured', () => {
    beforeEach(() => {
      vi.stubEnv('SCANNER_URL', 'http://scanner.internal:7700');
      vi.stubEnv('SCANNER_KEY', 'sekret');
      upstream.on('scanner.internal:7700/scan/', { json: { ok: true, grade: 'A' } });
    });

    it('proxies a passive scan with the key in the Authorization header and the pinned IP', async () => {
      const body = await osint(await call('?type=ssl&target=1.1.1.1'), 'scanner');
      expect(body.data).toMatchObject({ type: 'ssl', active: false, via: 'proxied through this server', pinnedIp: '1.1.1.1', result: { grade: 'A' } });
      const c = upstream.calls[0]!;
      expect(c.url).toBe('http://scanner.internal:7700/scan/ssl?target=1.1.1.1&host=1.1.1.1');
      expect(c.url).not.toContain('sekret');
      expect(c.opts.headers).toMatchObject({ authorization: 'Bearer sekret' });
      expect(c.opts.maxRedirects).toBe(0);
    });

    it('refuses active scan types unless SCANNER_ALLOW_ACTIVE=true', async () => {
      const body = await error(await call('?type=quick&target=1.1.1.1'), 403);
      expect(body.error).toBe('active_scan_disabled');
      expect(body.available).not.toContain('quick');
      vi.stubEnv('SCANNER_ALLOW_ACTIVE', 'true');
      expect(availableScans()).toContain('vuln');
      await osint(await call('?type=quick&target=1.1.1.1'), 'scanner');
    });

    it('refuses private targets, unknown types and paths', async () => {
      for (const qs of ['?type=ssl&target=10.0.0.5', '?type=ssl&target=localhost', '?type=ssl&target=169.254.169.254', '?type=deep&target=1.1.1.1', '?type=ssl&target=1.1.1.1/admin']) {
        const res = await call(qs);
        expect(res.status, qs).toBe(400);
      }
      expect(upstream.calls).toEqual([]);
    });

    it('reports a dead backend as 502 with the provider status', async () => {
      upstream.reset();
      upstream.on('scanner.internal', { error: 'network' });
      const body = await error(await call('?type=rdns&target=1.1.1.1'), 502);
      expect(body.providers.scanner).toMatchObject({ ok: false, error: 'network' });
    });
  });

  it('shares a fail-closed 5/min scanner bucket (catalogue)', () => {
    expect(catalogEntry('/api/scanner')?.rateLimit).toEqual({ limit: 5, windowS: 60, bucket: 'scanner', failClosed: true });
  });
});
