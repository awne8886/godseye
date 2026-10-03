/**
 * Security (round 11): the round-10 licence gates on cache reads also hold on the shared-lock
 * poll path. While another instance (e.g. the old revision of a rolling deploy that still runs
 * without COMMERCIAL_DEPLOYMENT) holds the refresh lock and writes a snapshot signed under its own
 * gate state, this instance must not adopt that snapshot: nothing NC-licensed is served.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore, clearL1, gateSignature, setStore, sourceCache, type StoredSnapshot } from '../cache';

/** A store whose lock is always held elsewhere; the "other instance" writes into it meanwhile. */
class LockedElsewhere extends MemoryStore {
  override async acquire(): Promise<string | null> {
    return null;
  }
}

beforeEach(() => clearL1());
afterEach(() => {
  vi.unstubAllEnvs();
  setStore(undefined);
});

describe('gate signature on the shared-lock poll', () => {
  it('does not adopt a snapshot another instance signed under nc_sources=1 when this one runs commercial', async () => {
    const store = new LockedElsewhere();
    setStore(store);
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    const foreignSig = gateSignature(['nc_sources'], { COMMERCIAL_DEPLOYMENT: '' });
    expect(foreignSig).toBe('nc_sources=1');
    const fetcher = vi.fn(async () => ({ data: ['own-row'] }));
    const c = sourceCache<string[]>('t:r11:lockpoll', fetcher, { ttlMs: 60_000, gates: ['nc_sources'] });
    // The other instance finishes its refresh shortly after this one starts polling.
    setTimeout(() => {
      const t = Date.now() + 1_000;
      const snap: StoredSnapshot<string[]> = { data: ['nc-licensed-row'], fetchedAt: t, lastAttemptAt: t, error: null, meta: { gateSignature: foreignSig } };
      void store.set('t:r11:lockpoll', snap, 3_600_000);
    }, 50);
    const r = await c.get();
    expect(r.data).toBeNull();
    expect(c.peek().data).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  }, 10_000);

  it('adopts the other instance’s snapshot when it was signed under the same gate state (control)', async () => {
    const store = new LockedElsewhere();
    setStore(store);
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    const sig = gateSignature(['nc_sources']);
    expect(sig).toBe('nc_sources=0');
    const c = sourceCache<string[]>('t:r11:lockpoll-ok', async () => ({ data: ['own-row'] }), { ttlMs: 60_000, gates: ['nc_sources'] });
    setTimeout(() => {
      const t = Date.now() + 1_000;
      void store.set('t:r11:lockpoll-ok', { data: ['shared-row'], fetchedAt: t, lastAttemptAt: t, error: null, meta: { gateSignature: sig } }, 3_600_000);
    }, 50);
    const r = await c.get();
    expect(r.data).toEqual(['shared-row']);
  }, 10_000);
});
