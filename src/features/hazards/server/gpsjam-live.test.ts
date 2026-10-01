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
import { jamLevel } from '../shared';
import { LIVE_MAX_POSITION_AGE_S, binLiveNacp, binLiveNacpDetailed, gpsjamBadShare, liveNacpCells, parseGpsJamDay } from './gpsjam';

function snapshotFrom(name: string) {
  const body = fixtureJson<AdsbResponse & { now: number }>(name);
  const batch = normalizeAdsbResponse(body, 'adsblol_tiles', body.now);
  return { snap: { ...emptySnapshot(1), records: batch.records }, now: body.now };
}

/** One airborne ADS-B FlightRecord-shaped row (test input; fields as aviation's normaliser emits them). */
function rec(id: string, lat: number, lng: number, nacP: number | null, seenAt: number, extra: Record<string, unknown> = {}) {
  return {
    id, callsign: null, registration: null, typeCode: null, bucket: 'commercial', isHelicopter: false, onGround: false,
    lat, lng, altFt: 35000, altGeomFt: null, gsKt: 450, trackDeg: 90, vrFpm: 0, squawk: null, emergency: null, category: null,
    nacP, dbFlags: null, seenAt, source: 'adsblol_tiles', posSource: 'adsb', ...extra,
  };
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
  it('MAJOR-A: the recorded Gulf snapshot has no live cell once the grounded aircraft is excluded', () => {
    // Before the fix this yielded 84536e1ffffffff (5 aircraft, 1 bad): the only NACp-0 aircraft in
    // that cell was 89405c, on the ground at Bahrain (alt_baro "ground") — an artefact, not jamming.
    const { snap, now } = snapshotFrom(FX.adsbGulf);
    expect(snap.records.find((r) => r.id === '89405c')).toMatchObject({ onGround: true, nacP: 0 });
    const bins = binLiveNacpDetailed(snap, Math.floor(now / 1000) - LIVE_MAX_POSITION_AGE_S);
    expect(bins.skipped.ground).toBe(3);
    expect(bins.withNacp).toBeGreaterThan(0);
    expect(bins.cells).toEqual([]);
  });

  it('MAJOR-A: grounded / TIS-B / non-ICAO NACp 0 never creates a live cell', () => {
    const t = 1_790_000_000;
    const snap = {
      ...emptySnapshot(1),
      records: [
        rec('~29af28', 50.0, 10.0, 0, t, { posSource: 'tisb', altFt: 100 }),
        rec('a6c5dd', 50.01, 10.01, 0, t, { onGround: true, altFt: null, gsKt: 5 }),
        rec('aaaaa3', 50.02, 10.0, 9, t),
        rec('aaaaa4', 50.0, 10.02, 9, t),
      ],
    };
    const bins = binLiveNacpDetailed(snap, t - LIVE_MAX_POSITION_AGE_S);
    expect(bins.cells).toHaveLength(0);
    expect(bins.skipped).toEqual({ ground: 1, notAdsb: 1, stale: 0 });
    // ADS-R, MLAT, Mode S and unknown sources are not the aircraft's own GNSS integrity either.
    for (const posSource of ['adsr', 'mlat', 'other', null]) {
      const s2 = { records: [rec('b1', 50, 10, 0, t, { posSource }), rec('b2', 50.01, 10, 9, t), rec('b3', 50, 10.01, 9, t)] };
      expect(binLiveNacp(s2, t - 60)).toEqual([]);
    }
    // The same three as airborne ADS-B do make a cell.
    const ok = { records: [rec('c1', 50, 10, 0, t), rec('c2', 50.01, 10, 9, t), rec('c3', 50, 10.01, 9, t)] };
    const cells = binLiveNacp(ok, t - 60);
    expect(cells).toMatchObject([{ aircraft: 3, bad: 1, basis: 'live-nacp' }]);
    for (const c of cells) expect(GpsJamCell.safeParse(c).success).toBe(true);
  });

  it('MAJOR-A: recorded London snapshot — ground traffic is excluded even if it reported NACp 0', () => {
    const { snap, now } = snapshotFrom(FX.adsbLondon);
    const ground = snap.records.filter((r) => r.onGround);
    expect(ground.length).toBe(4); // East Midlands, 2 × Heathrow, Gatwick
    const degraded = { records: snap.records.map((r) => (r.onGround ? { ...r, nacP: 0 } : r)) };
    const bins = binLiveNacpDetailed(degraded, Math.floor(now / 1000) - LIVE_MAX_POSITION_AGE_S);
    expect(bins.cells).toEqual([]);
    expect(bins.skipped).toEqual({ ground: 4, notAdsb: 0, stale: 0 });
    expect(bins.aircraft).toBe(snap.records.length - 4);
  });

  it('MAJOR-A: columnar rows use onGround (0|1) and the `~` address when no posSource column exists', () => {
    const t = 1_790_000_000;
    const fields = ['id', 'onGround', 'lat', 'lng', 'nacP', 'seenAt'];
    const rows = [['a', 0, 51.47, -0.45, 3, t], ['b', 0, 51.471, -0.452, 9, t], ['c', 0, 51.472, -0.451, 10, t], ['d', 1, 51.4705, -0.4505, 0, t], ['~e', 0, 51.4706, -0.4506, 0, t]];
    expect(binLiveNacp({ fields, rows }, t - 60)).toMatchObject([{ aircraft: 3, bad: 1 }]);
  });

  it('MINOR-3: only positions ≤ 60 s old (and of known age) are binned', () => {
    expect(LIVE_MAX_POSITION_AGE_S).toBe(60);
    const now = 1_790_000_000;
    const min = now - LIVE_MAX_POSITION_AGE_S;
    const fresh = [rec('a', 50, 10, 0, now - 10), rec('b', 50.01, 10, 9, now - 30), rec('c', 50, 10.01, 9, now - 60)];
    expect(binLiveNacp({ records: fresh }, min)).toMatchObject([{ aircraft: 3, bad: 1, observedAt: new Date((now - 10) * 1000).toISOString() }]);
    // One reporter 61 s old drops the cell below 3 aircraft; one of unknown age is not "live" either.
    const oneOld = [rec('a', 50, 10, 0, now - 10), rec('b', 50.01, 10, 9, now - 30), rec('c', 50, 10.01, 9, now - 61)];
    expect(binLiveNacpDetailed({ records: oneOld }, min)).toMatchObject({ cells: [], skipped: { stale: 1 } });
    const unknownAge = [rec('a', 50, 10, 0, now - 10), rec('b', 50.01, 10, 9, now - 30), { ...rec('c', 50, 10.01, 9, now), seenAt: null }];
    expect(binLiveNacpDetailed({ records: unknownAge }, min)).toMatchObject({ cells: [], skipped: { stale: 1 } });
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

describe('MINOR-1: gpsjam daily share = (bad − 1) / (good + bad)', () => {
  it('matches hand-computed values of gpsjam\'s published formula', () => {
    expect(gpsjamBadShare(0, 1)).toBe(0); // one bad aircraft alone: (1 − 1) / 1 = 0
    expect(gpsjamBadShare(10, 0)).toBe(0);
    expect(gpsjamBadShare(8, 2)).toBe(0.1); // (2 − 1) / 10 = 10 % → MEDIUM (HIGH is > 10 %)
    expect(gpsjamBadShare(5, 5)).toBe(0.4); // (5 − 1) / 10
    expect(gpsjamBadShare(48, 2)).toBe(0.02); // 1 / 50 = 2 % → LOW (MEDIUM is > 2 %)
    expect(jamLevel({ badRatio: gpsjamBadShare(8, 2) }).label).toBe('MEDIUM');
    expect(jamLevel({ badRatio: gpsjamBadShare(48, 2) }).label).toBe('LOW');
    expect(jamLevel({ badRatio: gpsjamBadShare(7, 3) }).label).toBe('HIGH'); // 2 / 10 = 20 %
  });

  it('a cell with a single bad aircraft is not served (and never HIGH); totalCells counts every row', () => {
    const csv = 'hex,count_good_aircraft,count_bad_aircraft\n841021bffffffff,0,1\n840135dffffffff,11,2\n8400ec3ffffffff,7,3\n';
    const out = parseGpsJamDay(csv, '2026-09-30', 10_000);
    expect(out.totalCells).toBe(3);
    expect(out.items.map((c) => [c.h3, c.badRatio, c.bad, c.aircraft])).toEqual([
      ['8400ec3ffffffff', 0.2, 3, 10],
      ['840135dffffffff', 0.0769, 2, 13],
    ]);
  });
});

describe('liveNacpCells provider status', () => {
  it('is ok with the cells when the in-process flights snapshot carries NACp', async () => {
    const now = Date.now();
    const t = Math.floor(now / 1000) - 5;
    await registerFlights({ ...emptySnapshot(1), records: [rec('a', 50, 10, 0, t), rec('b', 50.01, 10, 9, t), rec('c', 50, 10.01, 9, t)] }).get();
    const live = liveNacpCells(now);
    expect(live.cells).toHaveLength(1);
    expect(live.run.status).toMatchObject({ ok: true, count: 1 });
  });

  it('is ok with zero cells for the recorded Gulf snapshot (binning ran; the only NACp-0 cell was ground traffic)', async () => {
    const { snap, now } = snapshotFrom(FX.adsbGulf);
    await registerFlights(snap).get();
    const live = liveNacpCells(now);
    expect(live.cells).toEqual([]);
    expect(live.run.status).toMatchObject({ ok: true, count: 0 });
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
