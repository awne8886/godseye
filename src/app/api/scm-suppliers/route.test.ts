import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, FX, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { scmFeed } from '@/components/panels/intel/feeds';
import { earthquakeFeed } from '@/features/hazards/server/usgs';
import { ScmSuppliersResponse } from '@/lib/schemas/intel';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/components/panels/intel/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: CAPTURED_AT });
  freshCache();
});
afterEach(() => {
  scmFeed.stop();
  earthquakeFeed().stop();
  resetCache();
  vi.useRealTimers();
});

describe('GET /api/scm-suppliers', () => {
  it('checks every reference site against live USGS quakes (method stated)', async () => {
    state.routes = [['summary/2.5_day.geojson', FX.usgs]];
    const res = await GET(req('/api/scm-suppliers'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ScmSuppliersResponse.safeParse(body).success).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(15);
    for (const s of body.items) for (const t of s.threats) expect(t.method).toMatch(/km/);
    expect(body.providers.usgs).toMatchObject({ ok: true });
    expect(body.meta.kind).toBe('mixed');
  });

  it('answers 503 rather than an all-NORMAL list when the quake feed has no data', async () => {
    state.routes = [];
    const res = await GET(req('/api/scm-suppliers'), undefined);
    expect(res.status).toBe(503);
  });
});
