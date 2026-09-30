import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileStore, MemoryStore, RedisStore, clearL1, setStore, sourceCache, type StoredSnapshot } from './cache';
import { HttpError } from './http';

beforeEach(() => {
  clearL1();
  setStore(new MemoryStore());
});
afterEach(() => {
  vi.useRealTimers();
  setStore(undefined);
});

describe('sourceCache', () => {
  it('serves fresh data from cache and dedupes concurrent misses (single-flight)', async () => {
    let calls = 0;
    const c = sourceCache('t:fresh', async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { data: [calls] };
    }, { ttlMs: 60_000 });
    const results = await Promise.all(Array.from({ length: 25 }, () => c.get()));
    expect(calls).toBe(1);
    expect(results.every((r) => r.data?.[0] === 1 && !r.stale)).toBe(true);
    await c.get();
    expect(calls).toBe(1);
  });

  it('serves stale data immediately and refreshes once in the background', async () => {
    let n = 0;
    const c = sourceCache('t:swr', async () => ({ data: [++n] }), { ttlMs: 1000 });
    c.seed([0], Date.now() - 5000);
    const r = await c.get();
    expect(r.data).toEqual([0]);
    expect(r.stale).toBe(true);
    await vi.waitFor(() => expect(c.peek().data).toEqual([1]));
    expect(n).toBe(1);
  });

  it('keeps last-good data on error and waits 60 s before retrying', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let fail = false;
    let calls = 0;
    const c = sourceCache('t:err', async () => {
      calls++;
      if (fail) throw new HttpError('HTTP 503', 'http', 'x', 503);
      return { data: ['good'] };
    }, { ttlMs: 1000 });
    await c.get();
    fail = true;
    vi.setSystemTime(Date.now() + 2000);
    const r = await c.get({ waitForFresh: true });
    expect(r.data).toEqual(['good']);
    expect(r.error).toBe('http_503');
    expect(r.stale).toBe(true);
    await c.get();
    expect(calls).toBe(2); // no retry inside the 60 s window
    vi.setSystemTime(Date.now() + 61_000);
    fail = false;
    const r2 = await c.get({ waitForFresh: true });
    expect(r2.error).toBeNull();
    expect(calls).toBe(3);
  });

  it('treats an empty result as a failed refresh', async () => {
    let data: string[] = ['a'];
    const c = sourceCache('t:empty', async () => ({ data }), { ttlMs: 1 });
    await c.get();
    data = [];
    await new Promise((r) => setTimeout(r, 5));
    const r = await c.get({ waitForFresh: true });
    expect(r.data).toEqual(['a']);
    expect(r.error).toBe('empty');
    const legit = sourceCache('t:empty-ok', async () => ({ data: [] as string[] }), { ttlMs: 1000, isEmpty: () => false });
    expect((await legit.get()).error).toBeNull();
  });

  it('reports an error with no data when the first fetch fails', async () => {
    const c = sourceCache('t:first-fail', async () => {
      throw new HttpError('timeout', 'timeout', 'x');
    }, { ttlMs: 1000 });
    const r = await c.get();
    expect(r.data).toBeNull();
    expect(r.error).toBe('timeout');
  });

  it('passes validators to the fetcher and handles 304 Not Modified', async () => {
    const seen: (string | null | undefined)[] = [];
    let first = true;
    const c = sourceCache<string[]>('t:304', async (prev) => {
      seen.push(prev?.etag);
      if (first) {
        first = false;
        return { data: ['v1'], etag: '"e1"' };
      }
      return { notModified: true };
    }, { ttlMs: 1 });
    await c.get();
    await new Promise((r) => setTimeout(r, 5));
    const r = await c.get({ waitForFresh: true });
    expect(seen).toEqual([undefined, '"e1"']);
    expect(r.data).toEqual(['v1']);
    expect(r.error).toBeNull();
  });

  it('reads a snapshot written by another instance through the shared store', async () => {
    const shared = new MemoryStore();
    setStore(shared);
    await shared.set('t:shared', { data: ['from-peer'], fetchedAt: Date.now(), lastAttemptAt: Date.now(), error: null }, 60_000);
    const fetcher = vi.fn(async () => ({ data: ['mine'] }));
    const c = sourceCache('t:shared', fetcher, { ttlMs: 60_000 });
    expect((await c.get()).data).toEqual(['from-peer']);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not fetch while another instance holds the writer lock', async () => {
    const shared = new MemoryStore();
    setStore(shared);
    await shared.acquire('t:locked', 60_000);
    const fetcher = vi.fn(async () => ({ data: ['x'] }));
    const c = sourceCache('t:locked', fetcher, { ttlMs: 60_000 });
    const r = await c.get();
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.data).toBeNull();
  });
});

describe('snapshot stores', () => {
  const snap: StoredSnapshot<number[]> = { data: [1, 2], fetchedAt: 1, lastAttemptAt: 1, error: null };

  it('MemoryStore evicts least-recently-used entries and expires by retention', async () => {
    const s = new MemoryStore(2);
    await s.set('a', snap, 60_000);
    await s.set('b', snap, 60_000);
    await s.get('a');
    await s.set('c', snap, 60_000);
    expect(await s.get('b')).toBeNull();
    expect(await s.get('a')).not.toBeNull();
    await s.set('d', snap, -1);
    expect(await s.get('d')).toBeNull();
  });

  it('FileStore round-trips atomically and ignores foreign keys', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'godseye-store-'));
    try {
      const s = new FileStore(dir);
      await s.set('feed:x', snap, 60_000);
      expect(await s.get('feed:x')).toEqual(snap);
      expect(await s.get('feed:y')).toBeNull();
      await s.delete('feed:x');
      expect(await s.get('feed:x')).toBeNull();
      expect(await s.acquire('k', 1000)).toBe(true);
      expect(await s.acquire('k', 1000)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RedisStore uses PX retention and SET NX PX locks', async () => {
    const kv = new Map<string, string>();
    const calls: unknown[][] = [];
    const fake = {
      get: async (k: string) => kv.get(k) ?? null,
      set: async (k: string, v: string, ...args: (string | number)[]) => {
        calls.push([k, ...args]);
        if (args.includes('NX') && kv.has(k)) return null;
        kv.set(k, v);
        return 'OK';
      },
      del: async (k: string) => kv.delete(k),
    };
    const s = new RedisStore(async () => fake);
    await s.set('a', snap, 5000);
    expect(await s.get('a')).toEqual(snap);
    expect(calls[0]).toEqual(['godseye:snap:a', 'PX', 5000]);
    expect(await s.acquire('a', 30_000)).toBe(true);
    expect(await s.acquire('a', 30_000)).toBe(false);
    await s.release('a');
    expect(await s.acquire('a', 30_000)).toBe(true);
  });
});
