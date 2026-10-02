import { describe, expect, it } from 'vitest';
import { HttpError } from '@/lib/http';
import type { FlightRecord, NormalizedBatch } from '../adsb';
import type { Tile } from '../tiles';
import { PRUNE_AFTER_S, runSweep, type SweepDeps } from './sweep';
import type { TileResult } from './tile-sweeper';

const T0 = 1_790_791_600_000;
const rec = (id: string, seenAt: number, source = 'adsblol_tiles', p: Partial<FlightRecord> = {}): FlightRecord => ({
  id, callsign: null, registration: null, typeCode: null, bucket: 'commercial', isHelicopter: false, onGround: false, lat: 1, lng: 1,
  altFt: 1000, altGeomFt: null, gsKt: 100, trackDeg: 0, vrFpm: 0, squawk: null, emergency: null, category: null, nacP: null,
  dbFlags: null, seenAt, source, posSource: 'adsb', ...p,
});
const tiles: Tile[] = Array.from({ length: 10 }, (_, i) => ({ lat: i, lon: i }));

function drained(clock: Clock, indices: number[]): TileResult[] {
  clock.cursor = ((indices[indices.length - 1] ?? -1) + 1) % tiles.length;
  return indices.map((index) => {
    clock.t += 1200;
    return { index, at: clock.t, batch: { records: [rec(`a0000${index}`, Math.floor(clock.t / 1000))], noPosition: [] }, error: null };
  });
}
interface Clock {
  t: number;
  cursor: number;
}

function deps(clock: Clock, over: Partial<SweepDeps> = {}): SweepDeps {
  return {
    tiles,
    // Five tiles arrived since the previous run (the background worker reads them).
    drainTiles: async () => drained(clock, [0, 1, 2, 3, 4].map((i) => (clock.cursor + i) % tiles.length)),
    fetchGlobal: async (k): Promise<NormalizedBatch> =>
      k === 'adsblol_mil' ? { records: [rec('ae0001', Math.floor(clock.t / 1000), k, { dbFlags: 1, bucket: 'military' })], noPosition: ['ae0002'] } : { records: [], noPosition: [] },
    fetchReapi: async () => ({ records: [rec('bbbbbb', Math.floor(clock.t / 1000), 'adsblol_reapi')], noPosition: [] }),
    fetchOpenSky: async () => ({ records: [], noPosition: [] }),
    fetchAdsbfiMil: async () => ({ records: [], noPosition: [] }),
    caps: { reapi: false, opensky: false, openskyReason: 'not-configured', adsbfi: false },
    now: () => clock.t,
    ...over,
  };
}

describe('flights sweep', () => {
  const signal = new AbortController().signal;

  it('merges the tiles drained since the previous run, plus the global lists', async () => {
    const clock = { t: T0, cursor: 0 };
    const a = await runSweep(null, deps(clock), signal);
    expect(a.snapshot.records.map((r) => r.id)).toContain('ae0001');
    expect(a.snapshot.noPosition).toEqual(['ae0002']);
    expect(a.snapshot.tiles.filter((t) => t.ok)).toHaveLength(5);
    expect(a.providers.adsblol_tiles!.status).toMatchObject({ ok: true, count: 5 });
    expect(a.providers.adsblol_mil!.status).toMatchObject({ ok: true, count: 1 });
    expect(a.providers.opensky!.status.skipped).toBe('not-configured');
    expect(a.providers.adsbfi_mil!.status.skipped).toBe('licence');
    expect(a.providers.adsblol_reapi!.status.skipped).toBe('not-configured');
    const b = await runSweep(a.snapshot, deps(clock), signal);
    expect(b.snapshot.records.filter((r) => r.source === 'adsblol_tiles')).toHaveLength(10);
    expect(b.observedAt).toBe(Math.max(...b.snapshot.records.map((r) => r.seenAt)) * 1000);
    // The sweep's age is that of the OLDEST contributing tile.
    expect(b.providers.adsblol_tiles!.okAt).toBe(T0 + 1200);
  });

  it('meta.observedAt is never after the run that produced it (R2 round 5 MINOR-2)', async () => {
    const clock = { t: T0, cursor: 0 };
    // A row dated 30 s past our clock (e.g. a provider whose clock runs ahead).
    const ahead = rec('cccccc', Math.floor(T0 / 1000) + 30);
    const r = await runSweep(null, deps(clock, { drainTiles: async () => [{ index: 0, at: clock.t, batch: { records: [ahead], noPosition: [] }, error: null }] }), signal);
    expect(r.observedAt).toBe(clock.t);
    expect(r.observedAt!).toBeLessThanOrEqual(clock.t);
  });

  it('reports a tile error, and keeps reporting it while nothing new arrives (back-off)', async () => {
    const clock = { t: T0, cursor: 0 };
    const a = await runSweep(null, deps(clock, { drainTiles: async () => [{ index: 0, at: clock.t, batch: null, error: Object.assign(new Error('HTTP 429'), { code: 'http', status: 429 }) }] }), signal);
    expect(a.providers.adsblol_tiles!.status.ok).toBe(false);
    const b = await runSweep(a.snapshot, deps(clock, { drainTiles: async () => [] }), signal);
    expect(b.providers.adsblol_tiles!.status.ok).toBe(false);
    expect(b.providers.adsblol_tiles!.status.error).toBe(a.providers.adsblol_tiles!.status.error);
    const c = await runSweep(b.snapshot, deps(clock), signal);
    expect(c.providers.adsblol_tiles!.status).toMatchObject({ ok: true });
  });

  it('holds an ok sweep through one failed sweep period (429 burst), then reports the error', async () => {
    const clock = { t: T0, cursor: 0 };
    const e429 = () => new HttpError('HTTP 429', 'http', 'https://api.adsb.lol/v2/point/0/0/250', 429);
    const a = await runSweep(null, deps(clock), signal);
    expect(a.providers.adsblol_tiles!.status.ok).toBe(true);
    // Successes then a 429 as the latest response: still reading tiles → ok (no flap).
    const b = await runSweep(a.snapshot, deps(clock, { drainTiles: async () => [...drained(clock, [5, 6]), { index: 7, at: (clock.t += 1200), batch: null, error: e429() }] }), signal);
    expect(b.providers.adsblol_tiles!.status).toMatchObject({ ok: true });
    expect(b.providers.adsblol_tiles!.status.error).toBeUndefined();
    // Only 429s this run, newest good tile < 165 s old: held, with the last-good age.
    clock.t += 30_000;
    const c = await runSweep(b.snapshot, deps(clock, { drainTiles: async () => [{ index: 8, at: clock.t, batch: null, error: e429() }] }), signal);
    expect(c.providers.adsblol_tiles!.status.ok).toBe(true);
    expect(c.providers.adsblol_tiles!.okAt).toBe(T0 + 1200);
    // The worker backs off (nothing drained) past one sweep period: the error is reported.
    clock.t += 170_000;
    const d = await runSweep(c.snapshot, deps(clock, { drainTiles: async () => [{ index: 9, at: clock.t, batch: null, error: e429() }] }), signal);
    expect(d.providers.adsblol_tiles!.status).toMatchObject({ ok: false, error: 'http_429' });
    const e = await runSweep(d.snapshot, deps(clock, { drainTiles: async () => [] }), signal);
    expect(e.providers.adsblol_tiles!.status).toMatchObject({ ok: false, error: 'http_429' });
  });

  it('prunes aircraft nobody has re-observed recently', async () => {
    const clock = { t: T0, cursor: 0 };
    const a = await runSweep(null, deps(clock), signal);
    clock.t += (PRUNE_AFTER_S + 60) * 1000;
    const b = await runSweep(a.snapshot, deps(clock, { drainTiles: async () => [], fetchGlobal: async () => ({ records: [], noPosition: [] }) }), signal);
    expect(b.snapshot.records).toEqual([]);
  });

  it('uses the whole-network re-api instead of tiles when the feeder capability is on', async () => {
    const clock = { t: T0, cursor: 0 };
    let tileCalls = 0;
    const r = await runSweep(null, deps(clock, { caps: { reapi: true, opensky: false, openskyReason: 'licence', adsbfi: false }, drainTiles: async () => (tileCalls++, []) }), signal);
    expect(tileCalls).toBe(0);
    expect(r.providers.adsblol_reapi!.status).toMatchObject({ ok: true, count: 1 });
    expect(r.providers.adsblol_tiles!.status.skipped).toBe('disabled');
    expect(r.providers.opensky!.status.skipped).toBe('licence');
  });
});
