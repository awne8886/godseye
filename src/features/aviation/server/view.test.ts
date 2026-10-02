import { describe, expect, it } from 'vitest';
import type { FeedMeta, Providers } from '@/lib/types';
import { flightsState, honestFlights } from './view';

const ok = (age_s: number) => ({ ok: true, count: 100, ms: 900, age_s });
const failed = (age_s: number | null) => ({ ok: false, count: 0, ms: 300, age_s, error: 'http_429' });
const skipped = { ok: false, count: 0, ms: 0, age_s: null, skipped: 'not-configured' as const };

describe('flights state capped by the positions provider (R2/R4 round 4)', () => {
  it('keeps LIVE while the tile sweep is ok', () => {
    expect(flightsState('live', { adsblol_tiles: ok(120), adsblol_reapi: skipped, adsblol_mil: ok(5) })).toBe('live');
  });

  it('a failing sweep is last-good data: RECENT within 360 s, STALE after or when never ok', () => {
    const p = (tiles: Providers[string]): Providers => ({ adsblol_tiles: tiles, adsblol_reapi: skipped, adsblol_mil: ok(5) });
    expect(flightsState('live', p(failed(177)))).toBe('recent');
    expect(flightsState('live', p(failed(400)))).toBe('stale');
    expect(flightsState('live', p(failed(null)))).toBe('stale');
    expect(flightsState('recent', p(failed(177)))).toBe('recent');
  });

  it('judges the re-api instead when it is configured, and never upgrades a worse state', () => {
    expect(flightsState('live', { adsblol_tiles: { ...skipped, skipped: 'disabled' }, adsblol_reapi: failed(30) })).toBe('recent');
    expect(flightsState('offline', { adsblol_tiles: ok(1) })).toBe('offline');
    expect(flightsState('stale', { adsblol_tiles: failed(10) })).toBe('stale');
  });

  it('honestFlights rewrites only meta.state', () => {
    const meta = { feed: 'flights', kind: 'live', state: 'live', fetchedAt: '2026-10-01T05:31:00.000Z', observedAt: '2026-10-01T05:30:58.000Z', lastGoodAt: '2026-10-01T05:31:00.000Z', stale: false, ttlSeconds: 15, attribution: [] } as FeedMeta;
    const r = { data: 1, meta, providers: { adsblol_tiles: failed(177) } };
    const h = honestFlights(r);
    expect(h.meta.state).toBe('recent');
    expect(h.meta.fetchedAt).toBe(meta.fetchedAt);
    expect(r.meta.state).toBe('live');
    const fine = { data: 1, meta, providers: { adsblol_tiles: ok(10) } };
    expect(honestFlights(fine)).toBe(fine);
  });
});
