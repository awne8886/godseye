import { describe, expect, it } from 'vitest';
import type { ProviderRun } from '@/lib/feeds';
import { flightsFeed, positionsCap, positionsRun } from './feeds';

const NOW = 1_790_870_400_000;
const run = (ok: boolean, okAt: number | null, extra: Partial<ProviderRun['status']> = {}): ProviderRun => ({ status: { ok, count: 0, ms: 5, age_s: null, ...(ok ? {} : { error: 'http_429' }), ...extra }, okAt });

describe('flights feed state cap (R2 round 5 MINOR-1: /api/health agrees with /api/flights)', () => {
  it('is wired as the feed’s stateCap, so every read (health included) is capped', () => {
    expect(typeof flightsFeed.def.stateCap).toBe('function');
  });

  it('no cap while the positions provider is ok; RECENT then STALE by its last-good age while it fails', () => {
    expect(positionsCap(run(true, NOW - 5_000), NOW)).toBeNull();
    expect(positionsCap(run(false, NOW - 120_000), NOW)).toBe('recent');
    expect(positionsCap(run(false, NOW - 361_000), NOW)).toBe('stale');
    expect(positionsCap(run(false, null), NOW)).toBe('stale');
    expect(positionsCap(null, NOW)).toBeNull();
  });

  it('the positions provider is the re-api when configured, else the tile sweep', () => {
    const tiles = run(false, NOW);
    const reapi = run(true, NOW);
    const skipped = run(false, null, { skipped: 'not-configured' });
    expect(positionsRun({ adsblol_tiles: tiles, adsblol_reapi: skipped })).toBe(tiles);
    expect(positionsRun({ adsblol_tiles: run(false, null, { skipped: 'disabled' }), adsblol_reapi: reapi })).toBe(reapi);
    expect(positionsRun({})).toBeNull();
  });
});
