import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';

// Fixture: api.maclookup.app/v2/macs/00:1A:2B, recorded 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/mac${qs}`);

describe('GET /api/osint/mac', () => {
  beforeEach(() => freshState());

  it('returns the IEEE vendor for an OUI in any notation', async () => {
    upstream.on('maclookup.app/v2/macs/001A2B', { json: fixture('maclookup-001A2B.json') });
    for (const m of ['00:1A:2B', '00-1a-2b', '001a2b']) {
      const body = await osint(await call(`?mac=${m}`), 'mac');
      expect(body.data).toMatchObject({ vendor: 'Ayecom Technology Co., Ltd.', country: 'TW', found: true });
    }
  });

  it('rejects malformed input', async () => {
    for (const bad of ['xyz', '00:1A', 'gg:hh:ii']) await error(await call(`?mac=${bad}`), 400);
  });
});
