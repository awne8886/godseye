import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { c2Feed } from '@/features/network/server/abusech';
import { resetIpGeo } from '@/features/network/server/ipgeo';
import { C2Response } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  freshCache();
  resetIpGeo();
});
afterEach(() => {
  c2Feed.stop();
  resetCache();
  delete process.env.COMMERCIAL_DEPLOYMENT;
});

describe('GET /api/cyber-attacks', () => {
  it('serves Feodo C2s as INDICATOR points with the honest online count', async () => {
    // ip-api down: points fall back to the country label point, labelled as such.
    state.routes = [['feodotracker.abuse.ch', FX.feodo], ['ip-api.com', 503]];
    const res = await GET(req('/api/cyber-attacks'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(C2Response.safeParse(body).success).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((c: { label: string; geoPrecision: string }) => c.label === 'INDICATOR' && c.geoPrecision === 'country-centroid')).toBe(true);
    expect(body.onlineCount).toBe(body.items.filter((c: { status: string }) => c.status === 'online').length);
    expect(body.providers.feodo).toMatchObject({ ok: true });
    expect(body.providers['ip-api'].ok).toBe(false);
    // The file's newest last-online is months old: never LIVE.
    expect(body.meta.state).toBe('stale');
  });

  it('is licence-gated and 503 when Feodo fails', async () => {
    state.routes = [['feodotracker.abuse.ch', 500]];
    expect((await GET(req('/api/cyber-attacks'), undefined)).status).toBe(503);
    process.env.COMMERCIAL_DEPLOYMENT = 'true';
    expect((await GET(req('/api/cyber-attacks'), undefined)).status).toBe(403);
  });
});
