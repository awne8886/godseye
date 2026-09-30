import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { EXCLUDED_OSIRIS_ROUTES } from '@/lib/api-catalog';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';

// Fixtures: xposedornot /v1/breaches?domain= for adobe.com and example.com, recorded 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/leaks${qs}`);

describe('GET /api/osint/leaks (organisation domains only)', () => {
  beforeEach(() => freshState());

  it('lists known breaches of an organisation domain', async () => {
    upstream.on('domain=adobe.com', { json: fixture('xposed-adobe.json') });
    const body = await osint(await call('?domain=adobe.com'), 'leaks');
    expect(body.data.breaches[0]).toMatchObject({ name: 'Adobe', records: 152403035, verified: true });
    expect(body.data.breaches[0].date).toBe('2013-10-01T00:00:00.000Z');
    expect(body.findings[0].level).toBe('high');
  });

  it('treats "no breaches" as a truthful empty answer', async () => {
    upstream.on('domain=example.com', { json: fixture('xposed-example.json') });
    const body = await osint(await call('?domain=example.com'), 'leaks');
    expect(body.data.breaches).toEqual([]);
    expect(body.providers.xposedornot).toMatchObject({ ok: true, count: 0 });
  });

  it('refuses personal email addresses and phone numbers (no people-search)', async () => {
    for (const p of ['alice@example.com', '+44 20 7946 0000']) {
      const body = await error(await call(`?domain=${encodeURIComponent(p)}`), 400);
      expect(body.code).toBe('personal_identifier');
    }
    expect(upstream.calls).toEqual([]);
  });

  it("keeps OSIRIS's people-search routes excluded", async () => {
    const excluded = EXCLUDED_OSIRIS_ROUTES.map((r) => r.path);
    for (const p of ['/api/osint/username', '/api/osint/fingerprint', '/api/osint/phone', '/api/osint/github', '/api/osint/hudsonrock']) {
      expect(excluded).toContain(p);
      expect(existsSync(path.join(process.cwd(), `src/app${p}/route.ts`))).toBe(false);
    }
  });
});
