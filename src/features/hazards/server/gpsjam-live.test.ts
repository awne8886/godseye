/**
 * R2-B1: live NACp binning over the real aviation snapshot shape (`FlightsSnapshot.records`),
 * built from recorded adsb.lol responses through aviation's own normaliser.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeAdsbResponse, type AdsbResponse } from '@/features/aviation/adsb';
import { emptySnapshot } from '@/features/aviation/server/sweep';
import { defineFeed, getFeed, resetFeeds } from '@/lib/feeds';
import { GpsJamCell } from '@/lib/schemas';
import { FX, fixtureJson } from './__fixtures__';
import { freshCache, resetCache } from './__fixtures__/routes';
import { LIVE_MAX_POSITION_AGE_S, binLiveNacpDetailed, liveNacpCells } from './gpsjam';

function snapshotFrom(name: string) {
  const body = fixtureJson<AdsbResponse & { now: number }>(name);
  const batch = normalizeAdsbResponse(body, 'adsblol_tiles', body.now);
  return { snap: { ...emptySnapshot(1), records: batch.records }, now: body.now };
}

function registerFlights(data: { records: unknown[] }) {
  defineFeed({ key: 'flights', ttlMs: 60_000, kind: 'live', attribution: [], count: (d: { records?: unknown[] }) => d.records?.length ?? 0, run: async () => ({ data, providers: {} }) });
  return getFeed('flights')!;
}

beforeEach(() => freshCache());
afterEach(() => {
  getFeed('flights')?.stop();
  resetFeeds();
  resetCache();
});

describe('live NACp binning (FlightsSnapshot records)', () => {
  it('bins the recorded Gulf snapshot into a non-empty H3 r4 cell set', () => {
    const { snap, now } = snapshotFrom(FX.adsbGulf);
    expect(snap.records.length).toBeGreaterThan(10);
    const bins = binLiveNacpDetailed(snap, Math.floor(now / 1000) - LIVE_MAX_POSITION_AGE_S);
    expect(bins.withNacp).toBeGreaterThan(0);
    expect(bins.cells).toHaveLength(1);
    expect(bins.cells[0]).toMatchObject({ h3: '84536e1ffffffff', aircraft: 5, bad: 1, badRatio: 0.2, basis: 'live-nacp', date: null });
    expect(bins.cells[0]!.observedAt).toMatch(/^2026-09-30T/);
    for (const c of bins.cells) expect(GpsJamCell.safeParse(c).success).toBe(true);
  });

  it('degraded aircraft without ≥ 3 NACp reporters per cell give zero cells (a computed, truthful zero)', () => {
    const { snap, now } = snapshotFrom(FX.adsbBaltic);
    const bins = binLiveNacpDetailed(snap, Math.floor(now / 1000) - LIVE_MAX_POSITION_AGE_S);
    expect(snap.records.some((r) => r.nacP !== null && r.nacP <= 4)).toBe(true);
    expect(bins.withNacp).toBeGreaterThan(0);
    expect(bins.cells).toEqual([]);
  });

  it('skips positions older than the live window', () => {
    const { snap, now } = snapshotFrom(FX.adsbGulf);
    const later = Math.floor(now / 1000) + 3600;
    expect(binLiveNacpDetailed(snap, later - LIVE_MAX_POSITION_AGE_S)).toMatchObject({ aircraft: 0, cells: [] });
  });
});

describe('liveNacpCells provider status', () => {
  it('is ok with the cells when the in-process flights snapshot carries NACp', async () => {
    const { snap, now } = snapshotFrom(FX.adsbGulf);
    await registerFlights(snap).get();
    const live = liveNacpCells(now);
    expect(live.cells).toHaveLength(1);
    expect(live.run.status).toMatchObject({ ok: true, count: 1 });
  });

  it('reports not available (never ok:true count 0) when no flights feed runs', () => {
    expect(liveNacpCells().run.status).toMatchObject({ ok: false, count: 0, error: 'flights_feed_not_running' });
  });

  it('reports not available when the snapshot has no NACp field at all', async () => {
    const { snap, now } = snapshotFrom(FX.adsbGulf);
    await registerFlights({ ...snap, records: snap.records.map((r) => ({ ...r, nacP: null })) }).get();
    expect(liveNacpCells(now).run.status).toMatchObject({ ok: false, count: 0, error: 'nacp_not_reported' });
  });

  it('reports not available when every position is older than the live window', async () => {
    const { snap, now } = snapshotFrom(FX.adsbGulf);
    await registerFlights(snap).get();
    expect(liveNacpCells(now + 3600_000).run.status).toMatchObject({ ok: false, error: 'no_recent_positions' });
  });
});
