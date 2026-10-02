import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore, clearL1, gateSignature, setStore } from '@/lib/cache';
import type { ProviderRun } from '@/lib/feeds';
import type { Providers } from '@/lib/types';
import { flightsFeed, positionsCap } from './feeds';

// Snapshots are signed with the flights feed's licence gates (round 10): an unsigned one is never served.
const gateSig = () => gateSignature(flightsFeed.def.gates ?? []);
const status = (ok: boolean, age_s: number | null, extra: Partial<Providers[string]> = {}): Providers[string] => ({ ok, count: 0, ms: 5, age_s, ...(ok ? {} : { error: 'http_429' }), ...extra });

describe('flights feed state cap (R2 round 5 MINOR-1: /api/health agrees with /api/flights)', () => {
  afterEach(() => {
    flightsFeed.stop();
    clearL1();
    setStore(undefined);
  });

  it('is wired as the feed’s stateCap, so every read (health included) is capped', () => {
    expect(typeof flightsFeed.def.stateCap).toBe('function');
  });

  it('no cap while the positions provider is ok; RECENT then STALE by its last-good age while it fails', () => {
    expect(positionsCap({ adsblol_tiles: status(true, 5) })).toBeNull();
    expect(positionsCap({ adsblol_tiles: status(false, 120) })).toBe('recent');
    expect(positionsCap({ adsblol_tiles: status(false, 361) })).toBe('stale');
    expect(positionsCap({ adsblol_tiles: status(false, null) })).toBe('stale');
    expect(positionsCap(null)).toBeNull();
    expect(positionsCap({})).toBeNull();
  });

  it('the positions provider is the re-api when configured, else the tile sweep', () => {
    const skipped = status(false, null, { skipped: 'not-configured' });
    expect(positionsCap({ adsblol_tiles: status(false, 120), adsblol_reapi: skipped })).toBe('recent');
    expect(positionsCap({ adsblol_tiles: status(false, null, { skipped: 'disabled' }), adsblol_reapi: status(true, 0) })).toBeNull();
  });

  // Round 5 fix pass (R2 MINOR-1 extra): the cap was an in-process "last run", empty after a
  // restart with a filesystem/Redis store and on an instance that serves another one's snapshot.
  it('caps a snapshot this process did not produce, from the providers persisted with it', async () => {
    const store = new MemoryStore();
    setStore(store);
    clearL1();
    const now = Date.now();
    const failing: ProviderRun = { status: { ok: false, count: 0, ms: 900, age_s: null, error: 'http_429' }, okAt: now - 120_000 };
    await store.set(
      'feed:flights',
      { data: { records: [{ id: 'a12734' }] }, fetchedAt: now, lastAttemptAt: now, error: null, meta: { providers: { adsblol_tiles: failing }, observedAt: now - 5_000, gateSignature: gateSig() } },
      3_600_000,
      { pinned: true },
    );
    const r = await flightsFeed.get();
    flightsFeed.stop();
    expect(r.meta.state).toBe('recent');
    expect(flightsFeed.health().state).toBe('recent');
    expect(flightsFeed.health().providers.adsblol_tiles).toMatchObject({ ok: false, age_s: 120 });
  });

  it('a snapshot whose positions provider answered stays LIVE', async () => {
    const store = new MemoryStore();
    setStore(store);
    clearL1();
    const now = Date.now();
    const ok: ProviderRun = { status: { ok: true, count: 0, ms: 900, age_s: 0 }, okAt: now - 3_000 };
    await store.set('feed:flights', { data: { records: [{ id: 'a12734' }] }, fetchedAt: now, lastAttemptAt: now, error: null, meta: { providers: { adsblol_tiles: ok }, observedAt: now - 5_000, gateSignature: gateSig() } }, 3_600_000, { pinned: true });
    await flightsFeed.get();
    flightsFeed.stop();
    expect(flightsFeed.health().state).toBe('live');
  });
});
