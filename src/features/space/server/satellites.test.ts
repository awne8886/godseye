import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson } from '@/lib/http';
import type { FeedContext } from '@/lib/feeds';
import { celestrakRoutes, netError, upstreamRouter } from '../__fixtures__/upstreams';
import { FUTURE_EPOCH_CAPTURED_AT, fx } from '../__fixtures__';
import { CELESTRAK_GROUPS, COL, epochIso } from '../lib/catalog';
import {
  ACTIVE_INTERVAL_MS,
  ERROR_BUDGET,
  GROUP_RETRY_MS,
  MAX_GROUP_FAILURES,
  catalogueObservedAt,
  celestrakErrorCount,
  dueGroups,
  fallbackBackoffMs,
  nextCelestrakAttemptAt,
  recordCelestrakError,
  recoveryAction,
  recoveryProviders,
  resetCelestrakErrors,
  runSatellites,
  satelliteRecoveryTick,
  type SatCatalogue,
} from './satellites';

vi.mock('@/lib/http', async (orig) => ({ ...(await orig<Record<string, unknown>>()), httpJson: vi.fn() }));

const ctx = (previous: SatCatalogue | null = null): FeedContext<SatCatalogue> => ({ previous, etag: null, lastModified: null, signal: new AbortController().signal });
const MIN = 60_000;

beforeEach(() => {
  resetCelestrakErrors();
  vi.mocked(httpJson).mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-01T06:00:00Z'));
});
afterEach(() => {
  resetCelestrakErrors();
  vi.useRealTimers();
});

async function goodCatalogue(): Promise<SatCatalogue> {
  vi.mocked(httpJson).mockImplementation(upstreamRouter(celestrakRoutes()).impl as never);
  return (await runSatellites(ctx())).data;
}

describe('satellites feed run', () => {
  it('builds the catalogue from active + classification groups (FORMAT=json only, glo-ops)', async () => {
    const r = upstreamRouter(celestrakRoutes());
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    const out = await runSatellites(ctx());
    expect(out.data.source).toBe('celestrak');
    expect(out.data.rows.length).toBe(fx.active.length);
    expect(out.providers.celestrak!.status).toMatchObject({ ok: true, count: fx.active.length });
    expect(out.providers['celestrak-groups']!.status.ok).toBe(true);
    expect(r.calls.length).toBe(1 + CELESTRAK_GROUPS.length);
    expect(r.calls.every((u) => u.startsWith('https://celestrak.org/NORAD/elements/gp.php?GROUP=') && u.endsWith('&FORMAT=json'))).toBe(true);
    // CelesTrak's GLONASS group is `glo-ops`; `glonass-operational` answers 200 "GROUP not found" (probed 2026-10-01).
    expect(r.calls.some((u) => u.includes('GROUP=glo-ops&'))).toBe(true);
    expect(r.calls.some((u) => u.includes('glonass-operational'))).toBe(false);
    const iss = out.data.rows.find((row) => row[COL.noradId] === 25544)!;
    expect(iss[COL.category]).toBe('science');
    expect(iss[COL.group]).toBe('stations');
    // The epoch travels as integer ms (lossless at the ms precision served before).
    expect(typeof iss[COL.epoch]).toBe('number');
    expect(epochIso(iss[COL.epoch])).toMatch(/^2026-09-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(out.observedAt).toBeGreaterThan(Date.parse('2026-09-29T00:00:00Z'));
    expect(Object.keys(out.data.groupFetchedAt ?? {}).sort()).toEqual(CELESTRAK_GROUPS.map((g) => g.group).sort());
  });

  it('a run tolerates MAX_GROUP_FAILURES resets, keeps the previous membership and reports the gap', async () => {
    const prev = await goodCatalogue();
    vi.setSystemTime(Date.now() + ACTIVE_INTERVAL_MS + 13 * 60 * MIN); // elements and groups both due
    const routes = celestrakRoutes();
    const failing = ['gps-ops', 'galileo'];
    for (const g of failing) routes[`GROUP=${g}&`] = netError();
    const r = upstreamRouter(routes);
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    const out = await runSatellites(ctx(prev));
    const stopAt = CELESTRAK_GROUPS.findIndex((g) => g.group === 'galileo');
    expect(MAX_GROUP_FAILURES).toBe(2);
    expect(r.calls.length).toBe(1 + stopAt + 1); // active + groups up to and including the 2nd failure
    expect(celestrakErrorCount()).toBe(2);
    expect(out.providers['celestrak-groups']!.status.ok).toBe(false);
    expect(out.data.groupMembers['gps-ops']).toEqual(prev.groupMembers['gps-ops']);
    expect(out.data.groupFetchedAt!['gps-ops']).toBe(prev.groupFetchedAt!['gps-ops']);
  });

  it('a regular run only downloads groups that are missing or older than GROUP_TTL', async () => {
    const prev = await goodCatalogue();
    vi.setSystemTime(Date.now() + ACTIVE_INTERVAL_MS + MIN);
    expect(dueGroups(prev)).toEqual([]);
    const r = upstreamRouter(celestrakRoutes());
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    const out = await runSatellites(ctx(prev));
    expect(r.calls).toEqual(['https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json']);
    expect(out.providers['celestrak-groups']!.status.ok).toBe(true);
  });

  it('keeps the last-good CelesTrak catalogue (throws → stale) when active fails and it is < 24 h old', async () => {
    const prev = await goodCatalogue();
    vi.setSystemTime(Date.now() + ACTIVE_INTERVAL_MS + MIN);
    const r = upstreamRouter({ 'GROUP=active&': netError(), 'db.satnogs.org': fx.satnogs });
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    await expect(runSatellites(ctx(prev))).rejects.toThrow(/last-good/);
    expect(r.calls.some((u) => u.includes('satnogs'))).toBe(false);
  });

  it('falls back to SatNOGS, labelled `satnogs-fallback` in providers, when there is no CelesTrak catalogue', async () => {
    const r = upstreamRouter({ 'GROUP=active&': netError(), 'db.satnogs.org': fx.satnogs });
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    const out = await runSatellites(ctx());
    expect(out.data.source).toBe('satnogs');
    expect(out.data.rows.length).toBe(fx.satnogs.length);
    expect(out.providers.celestrak!.status.ok).toBe(false);
    expect(out.providers['satnogs-fallback']!.status).toMatchObject({ ok: true, count: fx.satnogs.length });
    expect(out.providers.satnogs).toBeUndefined();
    expect(out.data.rows.every((row) => row[COL.group] === 'satnogs')).toBe(true);
  });

  it('stops calling CelesTrak once the error budget is spent', async () => {
    for (let i = 0; i < ERROR_BUDGET; i++) recordCelestrakError();
    const r = upstreamRouter({ 'db.satnogs.org': fx.satnogs });
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    const out = await runSatellites(ctx());
    expect(out.providers.celestrak!.status).toMatchObject({ ok: false, skipped: 'budget' });
    expect(r.calls.some((u) => u.includes('celestrak'))).toBe(false);
  });

  it('errors age out of the 2 h window', () => {
    recordCelestrakError(Date.now() - 3 * 3600_000);
    expect(celestrakErrorCount()).toBe(0);
  });

  it('fails the refresh when no source answers', async () => {
    const r = upstreamRouter({ 'GROUP=active&': netError(), 'db.satnogs.org': netError() });
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    await expect(runSatellites(ctx())).rejects.toThrow(/no satellite catalogue/);
  });
});

describe('observedAt never lies in the future (R2 minor 1)', () => {
  it('uses the newest epoch not after the download; CXO keeps its own future epoch', async () => {
    vi.setSystemTime(FUTURE_EPOCH_CAPTURED_AT);
    const routes = celestrakRoutes();
    routes['GROUP=active&'] = fx.futureEpoch;
    vi.mocked(httpJson).mockImplementation(upstreamRouter(routes).impl as never);
    const out = await runSatellites(ctx());
    expect(out.observedAt).toBe(Date.parse('2026-10-01T03:22:47.196Z')); // STARLINK-2185, the newest past epoch
    expect(out.observedAt!).toBeLessThanOrEqual(FUTURE_EPOCH_CAPTURED_AT);
    expect(out.data.futureEpochs).toBe(1);
    const cxo = out.data.rows.find((row) => row[COL.noradId] === 25867)!;
    expect(epochIso(cxo[COL.epoch])).toBe('2026-10-02T03:42:59.671Z'); // per-object epoch unchanged
  });

  it('catalogueObservedAt ignores non-finite epochs and returns null when every epoch is in the future', () => {
    expect(catalogueObservedAt([Number.NaN, 2_000, 3_000], 1_000)).toEqual({ observedAt: null, future: 2 });
    expect(catalogueObservedAt([500, 900, 1_000, 1_001], 1_000)).toEqual({ observedAt: 1_000, future: 1 });
  });
});

describe('recovery loop: leaving the SatNOGS fallback, retrying missing groups (R2 minor 5)', () => {
  async function fallbackCatalogue(): Promise<SatCatalogue> {
    vi.mocked(httpJson).mockImplementation(upstreamRouter({ 'GROUP=active&': netError(), 'db.satnogs.org': fx.satnogs }).impl as never);
    return (await runSatellites(ctx())).data;
  }

  it('backs off 20, 40, 80, then 120 min', () => {
    expect([0, 1, 2, 3, 4, 9].map(fallbackBackoffMs)).toEqual([20, 40, 80, 120, 120, 120].map((m) => m * MIN));
  });

  it('retries CelesTrak 20 min after falling back, and returns to it on the first answer (one active download)', async () => {
    const t0 = Date.parse('2026-10-01T06:00:00Z');
    vi.setSystemTime(t0);
    const fb = await fallbackCatalogue();
    expect(recoveryAction(fb, t0 + 19 * MIN)).toBeNull();
    expect(nextCelestrakAttemptAt(fb)).toBe(t0 + 20 * MIN);

    vi.setSystemTime(t0 + 20 * MIN);
    const r = upstreamRouter(celestrakRoutes());
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    let next: SatCatalogue | null = null;
    const refresh = vi.fn(async () => {
      next = (await runSatellites(ctx(fb))).data;
    });
    expect(await satelliteRecoveryTick(fb, refresh)).toBe('celestrak');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(next!.source).toBe('celestrak');
    expect(next!.rows.length).toBe(fx.active.length);
    expect(r.calls.filter((u) => u.includes('GROUP=active&')).length).toBe(1);
    expect(nextCelestrakAttemptAt(next)).toBeNull();
  });

  it('a failed retry changes nothing in the snapshot, doubles the back-off and shows the attempt in providers', async () => {
    const t0 = Date.parse('2026-10-01T06:00:00Z');
    vi.setSystemTime(t0);
    const fb = await fallbackCatalogue();
    vi.setSystemTime(t0 + 20 * MIN);
    vi.mocked(httpJson).mockImplementation(upstreamRouter({ 'GROUP=active&': netError() }).impl as never);
    const refresh = vi.fn(async () => undefined);
    expect(await satelliteRecoveryTick(fb, refresh)).toBe('celestrak');
    expect(refresh).not.toHaveBeenCalled();
    expect(nextCelestrakAttemptAt(fb)).toBe(t0 + 20 * MIN + 40 * MIN);
    expect(recoveryAction(fb, t0 + 59 * MIN)).toBeNull();
    expect(recoveryAction(fb, t0 + 60 * MIN)).toBe('celestrak');
    const shown = recoveryProviders(fb, { celestrak: { ok: false, count: 0, ms: 1, age_s: null }, 'satnogs-fallback': { ok: true, count: 40, ms: 1, age_s: 1200 } });
    expect(shown.celestrak).toMatchObject({ ok: false, error: 'network' });
    expect(shown['satnogs-fallback']!.ok).toBe(true);
  });

  it('re-fetches missing groups after 20 min (not 2 h) and re-classifies without a second active download', async () => {
    const t0 = Date.parse('2026-10-01T06:00:00Z');
    vi.setSystemTime(t0);
    // After a restart every group request was reset (the live 0/12 case).
    const routes = celestrakRoutes();
    for (const g of CELESTRAK_GROUPS) routes[`GROUP=${g.group}&`] = netError();
    vi.mocked(httpJson).mockImplementation(upstreamRouter(routes).impl as never);
    const first = await runSatellites(ctx());
    expect(first.providers['celestrak-groups']!.status).toMatchObject({ ok: false, error: `groups 0/${CELESTRAK_GROUPS.length}` });
    const iss0 = first.data.rows.find((row) => row[COL.noradId] === 25544)!;
    expect(iss0[COL.group]).toBe('active');

    expect(recoveryAction(first.data, t0 + GROUP_RETRY_MS - 1)).toBeNull();
    vi.setSystemTime(t0 + GROUP_RETRY_MS);
    const r = upstreamRouter(celestrakRoutes());
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    let next: Awaited<ReturnType<typeof runSatellites>> | null = null;
    const refresh = async () => {
      next = await runSatellites(ctx(first.data));
    };
    expect(await satelliteRecoveryTick(first.data, refresh)).toBe('groups');
    expect(r.calls.some((u) => u.includes('GROUP=active&'))).toBe(false);
    expect(r.calls.length).toBe(CELESTRAK_GROUPS.length);
    const out = next!;
    expect(out.providers['celestrak-groups']!.status.ok).toBe(true);
    // The elements' own download keeps its time and provider entry.
    expect(out.data.elementsFetchedAt).toBe(first.data.elementsFetchedAt);
    expect(out.providers.celestrak!.okAt).toBe(first.providers.celestrak!.okAt);
    const iss = out.data.rows.find((row) => row[COL.noradId] === 25544)!;
    expect(iss[COL.group]).toBe('stations');
    expect(recoveryAction(out.data, t0 + 2 * GROUP_RETRY_MS)).toBeNull();
  });

  it('a partial group prefetch is applied without asking the groups that just failed again', async () => {
    const t0 = Date.now();
    const routes = celestrakRoutes();
    for (const g of CELESTRAK_GROUPS) routes[`GROUP=${g.group}&`] = netError();
    vi.mocked(httpJson).mockImplementation(upstreamRouter(routes).impl as never);
    const first = await runSatellites(ctx());
    vi.setSystemTime(t0 + GROUP_RETRY_MS);
    const retry = celestrakRoutes();
    retry['GROUP=science&'] = netError();
    retry['GROUP=geodetic&'] = netError();
    const r = upstreamRouter(retry);
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    let out: Awaited<ReturnType<typeof runSatellites>> | null = null;
    await satelliteRecoveryTick(first.data, async () => {
      out = await runSatellites(ctx(first.data));
    });
    expect(r.calls.map((u) => /GROUP=([^&]+)/.exec(u)![1])).toEqual(['stations', 'science', 'geodetic']);
    expect(out!.data.groupMembers.stations!.length).toBeGreaterThan(0);
    expect(out!.providers['celestrak-groups']!.status).toMatchObject({ ok: false, error: `groups 1/${CELESTRAK_GROUPS.length}` });
  });

  it('asks for the 2-hourly active download when a group-only refresh restarted the cache TTL', async () => {
    const cat = await goodCatalogue();
    expect(recoveryAction(cat, cat.elementsFetchedAt + ACTIVE_INTERVAL_MS + 11 * MIN)).toBe('elements');
    expect(recoveryAction(cat, cat.elementsFetchedAt + ACTIVE_INTERVAL_MS + MIN)).toBeNull();
  });
});
