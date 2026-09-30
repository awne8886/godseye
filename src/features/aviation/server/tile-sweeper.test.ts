import { describe, expect, it } from 'vitest';
import { HttpError } from '@/lib/http';
import type { NormalizedBatch } from '../adsb';
import type { Tile } from '../tiles';
import { BACKOFF_BASE_MS, MAX_TILE_AGE_MS, TileSweeper, backoffMs, nextTile } from './tile-sweeper';

const empty: NormalizedBatch = { records: [], noPosition: [] };

describe('nextTile', () => {
  it('reads never-read tiles first, then overdue ones, then the most aircraft-seconds of staleness', () => {
    const now = 1_000_000;
    expect(nextTile([{ at: now - 1000, count: 500 }, { at: null, count: 0 }], now)).toBe(1);
    // 600 aircraft read 30 s ago outweigh 10 aircraft read 100 s ago.
    expect(nextTile([{ at: now - 100_000, count: 10 }, { at: now - 30_000, count: 600 }], now)).toBe(1);
    // …but an overdue tile always wins, so every tile is re-read within MAX_TILE_AGE_MS.
    expect(nextTile([{ at: now - MAX_TILE_AGE_MS, count: 0 }, { at: now - 60_000, count: 900 }], now)).toBe(0);
  });
});

describe('backoffMs', () => {
  it('is exponential and never shorter than Retry-After', () => {
    expect(backoffMs(1, undefined)).toBe(BACKOFF_BASE_MS);
    expect(backoffMs(2, undefined)).toBe(2 * BACKOFF_BASE_MS);
    expect(backoffMs(1, 120_000)).toBe(120_000);
    expect(backoffMs(20, undefined)).toBe(300_000);
  });
});

/** Simulated worker: each request takes `latencyMs`; the clock only moves inside fetch/sleep. */
function simulate(counts: number[], latencyMs: number, durationMs: number) {
  const clock = { t: 0 };
  const tiles: Tile[] = counts.map((_, i) => ({ lat: i, lon: 0 }));
  const reads: number[][] = counts.map(() => []);
  const s = new TileSweeper({
    tiles,
    now: () => clock.t,
    sleep: async (ms) => void (clock.t += ms),
    fetchTile: async (t) => {
      clock.t += latencyMs;
      reads[t.lat]!.push(clock.t);
      return { records: Array.from({ length: counts[t.lat]! }, () => null as never), noPosition: [] };
    },
  });
  return { s, clock, reads, run: async () => { while (clock.t < durationMs) await s.step(); } };
}

describe('TileSweeper', () => {
  it('re-reads every tile within 180 s and puts dense tiles first (86 tiles, 1.5 s per request)', async () => {
    // A skewed grid like the real one: a few hub tiles with hundreds of aircraft, many sparse ones.
    const counts = Array.from({ length: 86 }, (_, i) => Math.round(900 / (1 + i) ** 0.9));
    const sim = simulate(counts, 1_500, 900_000);
    await sim.run();
    for (const r of sim.reads) {
      const gaps = r.slice(1).map((t, i) => t - r[i]!);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(180_000);
    }
    // Benchmark (documented in the report): share of aircraft whose tile was read > 60 s ago,
    // sampled every second over the last 10 min, vs plain round-robin at the same request rate.
    const staleShare = (reads: number[][]) => {
      let stale = 0;
      let total = 0;
      for (let t = 300_000; t < 900_000; t += 1_000) {
        reads.forEach((r, i) => {
          const last = r.filter((x) => x <= t).pop();
          if (last === undefined) return;
          total += counts[i]!;
          if (t - last > 60_000) stale += counts[i]!;
        });
      }
      return stale / total;
    };
    const roundRobin = counts.map((_, i) => Array.from({ length: 10 }, (_, k) => (k * 86 + i + 1) * 1_500));
    const prioritised = staleShare(sim.reads);
    if (process.env.GODSEYE_BENCH) console.log('stale share', { prioritised, roundRobin: staleShare(roundRobin) });
    expect(prioritised).toBeLessThan(staleShare(roundRobin));
    expect(prioritised).toBeLessThan(0.5);
  });

  it('backs off after an error for at least the upstream Retry-After, then resumes', async () => {
    const clock = { t: 0 };
    let calls = 0;
    const s = new TileSweeper({
      tiles: [{ lat: 0, lon: 0 }],
      now: () => clock.t,
      sleep: async (ms) => void (clock.t += ms),
      fetchTile: async () => {
        calls++;
        if (calls === 1) throw new HttpError('HTTP 429', 'http', 'https://api.adsb.lol/v2/point/0/0/250', 429, 90_000);
        return empty;
      },
    });
    await s.step();
    expect(s.backoffUntil).toBe(90_000);
    while (clock.t < 90_000) await s.step();
    expect(calls).toBe(1);
    await s.step();
    expect(calls).toBe(2);
    const drained = s.drain();
    expect(drained.map((r) => r.error === null)).toEqual([false, true]);
    s.stop();
  });
});
