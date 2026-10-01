/**
 * R3 round-4 MAJOR-1 (ported repro r3-usgs-down): after USGS has been offline for 3 h the supply-
 * chain checks are not LIVE, the usgs provider is not ok, the last-good checks are kept with their
 * time, and the MARKETS panel line names the outage instead of "no hazard in range".
 * Fixture: usgs-2.5_day.2026-09-30.json (captured 2026-09-30 ~20:03 UTC).
 */
import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, FX, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { scmFeed } from '@/components/panels/intel/feeds';
import { scmStatusLine } from '@/components/panels/markets/scm-status';
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

describe('/api/scm-suppliers with USGS down', () => {
  it('is live with a verdict line while USGS answers', async () => {
    state.routes = [['summary/2.5_day.geojson', FX.usgs]];
    const body = await (await GET(req('/api/scm-suppliers'), undefined)).json();
    expect(ScmSuppliersResponse.safeParse(body).success).toBe(true);
    expect(body.meta.state).toBe('live');
    expect(body.providers.usgs).toMatchObject({ ok: true });
    expect(body.hazardsAsOf).toBe(new Date(CAPTURED_AT).toISOString());
    const line = scmStatusLine(body, CAPTURED_AT);
    expect(line.degraded).toBe(false);
    expect(line.text).toMatch(/sites with no hazard in range \(USGS quakes only; weather not checked\)$/);
  });

  it('serves the last-good checks as OFFLINE with usgs ok:false after 3 h, and the panel says so', async () => {
    state.routes = [['summary/2.5_day.geojson', FX.usgs]];
    const first = await (await GET(req('/api/scm-suppliers'), undefined)).json();
    state.routes = [];
    vi.setSystemTime(CAPTURED_AT + 3 * 3600_000);
    await earthquakeFeed().refresh().catch(() => {});
    await scmFeed.refresh().catch(() => {});
    const res = await GET(req('/api/scm-suppliers'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ScmSuppliersResponse.safeParse(body).success).toBe(true);
    expect(body.meta.state).toBe('offline');
    expect(body.meta.lastGoodAt).toBe(new Date(CAPTURED_AT).toISOString());
    expect(body.providers.usgs).toMatchObject({ ok: false, error: 'offline', age_s: 3 * 3600 });
    // The last-good checks are kept (not dropped), with the time they were made.
    expect(body.items).toEqual(first.items);
    expect(body.hazardsAsOf).toBe(new Date(CAPTURED_AT).toISOString());
    const line = scmStatusLine(body, CAPTURED_AT + 3 * 3600_000);
    expect(line.degraded).toBe(true);
    expect(line.text).toBe('Hazard source offline — last good 20:05 UTC; sites not re-checked since');
    expect(line.text).not.toMatch(/no hazard in range/);
  });

  it('is STALE (not live) within the first 90 min of an outage', async () => {
    state.routes = [['summary/2.5_day.geojson', FX.usgs]];
    await GET(req('/api/scm-suppliers'), undefined);
    state.routes = [];
    vi.setSystemTime(CAPTURED_AT + 20 * 60_000);
    await earthquakeFeed().refresh({ force: true }).catch(() => {});
    await scmFeed.refresh().catch(() => {}); // the poller's next run
    const body = await (await GET(req('/api/scm-suppliers'), undefined)).json();
    expect(body.meta.state).toBe('stale');
    expect(body.providers.usgs.ok).toBe(false);
    expect(scmStatusLine(body, CAPTURED_AT + 20 * 60_000).text).toMatch(/^Hazard source (stale|offline) — last good 20:05 UTC/);
  });
});
