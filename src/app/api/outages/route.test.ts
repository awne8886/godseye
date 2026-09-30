import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { outagesFeed } from '@/features/network/server/outages';
import { OutagesResponse } from '@/lib/schemas';
import { GET as ALIAS } from '../radar/route';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  freshCache();
  delete process.env.CLOUDFLARE_API_TOKEN;
});
afterEach(() => {
  outagesFeed.stop();
  resetCache();
});

describe('GET /api/outages (+ alias /api/radar)', () => {
  it('serves IODA outages keyless and reports Cloudflare as not configured', async () => {
    state.routes = [['api.ioda.inetintel.cc.gatech.edu', FX.ioda]];
    const res = await GET(req('/api/outages'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(OutagesResponse.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(18);
    expect(body.providers.ioda).toMatchObject({ ok: true, count: 18 });
    expect(body.providers.cloudflare).toMatchObject({ ok: false, skipped: 'not-configured' });
    expect(body.meta.feed).toBe('outages');
    const alias = await (await ALIAS(req('/api/radar'), undefined)).json();
    expect(alias.items).toEqual(body.items);
  });

  it('treats "no outage" as truthful but a failed IODA as SOURCE OFFLINE', async () => {
    state.routes = [['api.ioda.inetintel.cc.gatech.edu', Buffer.from('{"data":[]}')]];
    const ok = await GET(req('/api/outages'), undefined);
    expect(ok.status).toBe(200);
    expect((await ok.json()).items).toEqual([]);
    outagesFeed.stop();
    resetCache();
    freshCache();
    state.routes = [['api.ioda.inetintel.cc.gatech.edu', 503]];
    expect((await GET(req('/api/outages'), undefined)).status).toBe(503);
  });
});
