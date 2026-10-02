/**
 * Round 10: licence/key gates hold on every cache read. A snapshot written under a different
 * capability signature (`meta.gateSignature`) is never served, never revalidated and never kept as
 * the "previous" value of an empty refresh, whether it comes from L1, the SnapshotStore or a
 * filesystem store that survived a restart.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileStore, MemoryStore, clearL1, gateSignature, setStore, sourceCache } from './cache';

beforeEach(() => {
  clearL1();
  setStore(new MemoryStore());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setStore(undefined);
});

describe('sourceCache gates', () => {
  it('signs snapshots with the gate signature', async () => {
    const c = sourceCache('t:gates:sign', async () => ({ data: [1] }), { ttlMs: 60_000, gates: ['openmeteo', 'nc_sources'] });
    const r = await c.get();
    expect(r.meta.gateSignature).toBe('openmeteo=1,nc_sources=1');
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    expect(gateSignature(['openmeteo', 'nc_sources'])).toBe('openmeteo=0,nc_sources=0');
  });

  it('does not serve a stored snapshot written under another gate signature (restart on the same store)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'godseye-gates-'));
    try {
      setStore(new FileStore(dir));
      const gated = (calls: string[]) =>
        sourceCache<string[]>(
          't:gates:fs',
          async () => {
            calls.push('fetch');
            return { data: process.env.COMMERCIAL_DEPLOYMENT === 'true' ? [] : ['gated-row'] };
          },
          { ttlMs: 60_000, gates: ['openmeteo'] },
        );
      const before: string[] = [];
      expect((await gated(before).get()).data).toEqual(['gated-row']);

      clearL1(); // restart: the FileStore still holds the snapshot
      vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
      const after: string[] = [];
      const c = gated(after);
      expect(c.peek().data).toBeNull();
      const r = await c.get();
      expect(r.data).toEqual([]); // the gated (empty) refresh, never the old row
      expect(r.fetchedAt).toBeNull();
      expect(after).toEqual(['fetch']);
      // A forced refresh that comes back empty again still cannot resurrect the old row.
      expect((await c.refresh({ force: true })).data).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops an L1 snapshot whose gate flipped in-process, and accepts a matching one', async () => {
    let n = 0;
    const c = sourceCache('t:gates:l1', async () => ({ data: [++n] }), { ttlMs: 60_000, gates: ['cloudflare'] });
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'x');
    expect((await c.get()).data).toEqual([1]);
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    expect(c.peek().data).toBeNull();
    expect((await c.get()).data).toEqual([2]);
    expect((await c.get()).data).toEqual([2]); // same signature: served from cache
  });

  it('never serves an unsigned (pre-gate) snapshot from the store', async () => {
    const store = new MemoryStore();
    setStore(store);
    const now = Date.now();
    await store.set('t:gates:legacy', { data: ['legacy-row'], fetchedAt: now, lastAttemptAt: now, error: null, meta: {} }, 3_600_000);
    const c = sourceCache<string[]>('t:gates:legacy', async () => ({ data: ['fresh-row'] }), { ttlMs: 60_000, gates: ['nc_sources'] });
    expect((await c.get()).data).toEqual(['fresh-row']);
  });

  it('a cache without gates ignores capability changes', async () => {
    let n = 0;
    const c = sourceCache('t:gates:none', async () => ({ data: [++n] }), { ttlMs: 60_000 });
    expect((await c.get()).data).toEqual([1]);
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    expect((await c.get()).data).toEqual([1]);
    expect(c.peek().meta.gateSignature).toBeUndefined();
  });
});
