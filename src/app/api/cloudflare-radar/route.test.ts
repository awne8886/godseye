import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Call, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { attackOriginsFeed } from '@/features/network/server/outages';
import { AttackOriginsResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[], calls: [] as Call[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError, state.calls) };
});

beforeEach(() => {
  freshCache();
  delete process.env.CLOUDFLARE_API_TOKEN;
});
afterEach(() => {
  attackOriginsFeed.stop();
  resetCache();
  delete process.env.CLOUDFLARE_API_TOKEN;
});

describe('GET /api/cloudflare-radar', () => {
  it('is 403 not-configured without a token and says so on ?probe=1', async () => {
    const res = await GET(req('/api/cloudflare-radar'), undefined);
    expect(res.status).toBe(403);
    expect((await res.json()).providers.cloudflare).toMatchObject({ skipped: 'not-configured' });
    const probe = await (await GET(req('/api/cloudflare-radar?probe=1'), undefined)).json();
    expect(probe.configured).toBe(false);
  });

  it('with a token, serves origin shares as points (no targets reported → no arcs)', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    // Response shape per the Radar API docs (the keyless probe on 2026-09-30 answered 400).
    const body = { success: true, result: { meta: { lastUpdated: '2026-09-30T19:45:00Z' }, top_0: [{ originCountryAlpha2: 'US', originCountryName: 'United States', value: '14.2' }, { originCountryAlpha2: 'DE', originCountryName: 'Germany', value: '6.1' }] } };
    state.routes = [['radar/attacks/layer3/top/locations/origin', Buffer.from(JSON.stringify(body))]];
    const res = await GET(req('/api/cloudflare-radar'), undefined);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(AttackOriginsResponse.safeParse(json).success).toBe(true);
    expect(json.items).toHaveLength(2);
    expect(json.items.every((i: { targetCountryCode?: string }) => i.targetCountryCode === undefined)).toBe(true);
    expect(json.providers.cloudflare.ok).toBe(true);
    expect(json.meta.observedAt).toBe('2026-09-30T19:45:00.000Z');
    // The token goes in a header, never the URL.
    expect(state.calls.every((c) => !c.url.includes('test-token'))).toBe(true);
  });
});
