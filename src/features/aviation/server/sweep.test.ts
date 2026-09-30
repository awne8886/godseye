import { describe, expect, it } from 'vitest';
import type { FlightRecord, NormalizedBatch } from '../adsb';
import type { Tile } from '../tiles';
import { PRUNE_AFTER_S, runSweep, type SweepDeps } from './sweep';

const T0 = 1_790_791_600_000;
const rec = (id: string, seenAt: number, source = 'adsblol_tiles', p: Partial<FlightRecord> = {}): FlightRecord => ({
  id, callsign: null, registration: null, typeCode: null, bucket: 'commercial', isHelicopter: false, onGround: false, lat: 1, lng: 1,
  altFt: 1000, altGeomFt: null, gsKt: 100, trackDeg: 0, vrFpm: 0, squawk: null, emergency: null, category: null, nacP: null,
  dbFlags: null, seenAt, source, posSource: 'adsb', ...p,
});
const tiles: Tile[] = Array.from({ length: 10 }, (_, i) => ({ lat: i, lon: i }));

function deps(clock: { t: number }, over: Partial<SweepDeps> = {}): SweepDeps {
  return {
    tiles,
    fetchTile: async (t) => {
      clock.t += 1200; // one start every 1.2 s
      return { records: [rec(`a0000${t.lat}`, Math.floor(clock.t / 1000))], noPosition: [] };
    },
    fetchGlobal: async (k): Promise<NormalizedBatch> =>
      k === 'adsblol_mil' ? { records: [rec('ae0001', Math.floor(clock.t / 1000), k, { dbFlags: 1, bucket: 'military' })], noPosition: ['ae0002'] } : { records: [], noPosition: [] },
    fetchReapi: async () => ({ records: [rec('bbbbbb', Math.floor(clock.t / 1000), 'adsblol_reapi')], noPosition: [] }),
    fetchOpenSky: async () => ({ records: [], noPosition: [] }),
    fetchAdsbfiMil: async () => ({ records: [], noPosition: [] }),
    caps: { reapi: false, opensky: false, openskyReason: 'not-configured', adsbfi: false },
    now: () => clock.t,
    sliceBudgetMs: 5_000,
    ...over,
  };
}

describe('flights sweep', () => {
  const signal = new AbortController().signal;

  it('sweeps a time-budgeted slice and resumes at the cursor next run', async () => {
    const clock = { t: T0 };
    const a = await runSweep(null, deps(clock), signal);
    expect(a.snapshot.cursor).toBe(5); // 5 × 1.2 s ≥ 5 s budget
    expect(a.snapshot.records.map((r) => r.id)).toContain('ae0001');
    expect(a.snapshot.noPosition).toEqual(['ae0002']);
    expect(a.providers.adsblol_tiles!.status).toMatchObject({ ok: true, count: 5 });
    expect(a.providers.adsblol_mil!.status).toMatchObject({ ok: true, count: 1 });
    expect(a.providers.opensky!.status.skipped).toBe('not-configured');
    expect(a.providers.adsbfi_mil!.status.skipped).toBe('licence');
    expect(a.providers.adsblol_reapi!.status.skipped).toBe('not-configured');
    const b = await runSweep(a.snapshot, deps(clock), signal);
    expect(b.snapshot.cursor).toBe(0); // wrapped: one full sweep done
    expect(b.snapshot.lastSweepMs).toBeGreaterThan(0);
    expect(b.snapshot.records.filter((r) => r.source === 'adsblol_tiles')).toHaveLength(10);
    expect(b.observedAt).toBe(Math.max(...b.snapshot.records.map((r) => r.seenAt)) * 1000);
  });

  it('never runs more than one full sweep per run', async () => {
    const clock = { t: T0 };
    let n = 0;
    const d = deps(clock, { sliceBudgetMs: 10 ** 9, fetchTile: async () => (n++, { records: [], noPosition: [] }) });
    await runSweep(null, d, signal);
    expect(n).toBe(tiles.length);
  });

  it('backs off exponentially after a tile error and reports it', async () => {
    const clock = { t: T0 };
    const failing = deps(clock, {
      fetchTile: async () => {
        throw Object.assign(new Error('HTTP 429'), {});
      },
    });
    const a = await runSweep(null, failing, signal);
    expect(a.providers.adsblol_tiles!.status.ok).toBe(false);
    expect(a.snapshot.backoffUntil).toBe(clock.t + 15_000);
    let calls = 0;
    const b = await runSweep(a.snapshot, deps(clock, { fetchTile: async () => (calls++, { records: [], noPosition: [] }) }), signal);
    expect(calls).toBe(0); // still backing off
    expect(b.snapshot.tileFailures).toBe(1);
  });

  it('prunes aircraft nobody has re-observed recently', async () => {
    const clock = { t: T0 };
    const a = await runSweep(null, deps(clock), signal);
    clock.t += (PRUNE_AFTER_S + 60) * 1000;
    const b = await runSweep(a.snapshot, deps(clock, { fetchTile: async () => ({ records: [], noPosition: [] }), fetchGlobal: async () => ({ records: [], noPosition: [] }) }), signal);
    expect(b.snapshot.records).toEqual([]);
  });

  it('uses the whole-network re-api instead of tiles when the feeder capability is on', async () => {
    const clock = { t: T0 };
    let tileCalls = 0;
    const r = await runSweep(null, deps(clock, { caps: { reapi: true, opensky: false, openskyReason: 'licence', adsbfi: false }, fetchTile: async () => (tileCalls++, { records: [], noPosition: [] }) }), signal);
    expect(tileCalls).toBe(0);
    expect(r.providers.adsblol_reapi!.status).toMatchObject({ ok: true, count: 1 });
    expect(r.providers.adsblol_tiles!.status.skipped).toBe('disabled');
    expect(r.providers.opensky!.status.skipped).toBe('licence');
  });
});
