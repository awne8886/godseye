import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore, RedisStore, clearL1, setStore, sourceCache } from '@/lib/cache';
import { defineFeed, resetFeeds } from '@/lib/feeds';
import { HttpError } from '@/lib/http';

beforeEach(() => {
  clearL1();
  resetFeeds();
  setStore(new MemoryStore());
});
afterEach(() => {
  vi.useRealTimers();
  resetFeeds();
  setStore(undefined);
});

function fakeRedis(clock: { now: number }) {
  const db = new Map<string, { v: string; exp: number | null }>();
  const live = (k: string) => {
    const e = db.get(k);
    if (e && e.exp !== null && e.exp <= clock.now) db.delete(k);
    return db.get(k);
  };
  return {
    async get(k: string) {
      return live(k)?.v ?? null;
    },
    async set(k: string, v: string, ...args: (string | number)[]) {
      const nx = args.includes('NX');
      const pxI = args.indexOf('PX');
      if (nx && live(k)) return null;
      db.set(k, { v, exp: pxI >= 0 ? clock.now + Number(args[pxI + 1]) : null });
      return 'OK';
    },
    async del(k: string) {
      db.delete(k);
      return 1;
    },
    async eval(_script: string, _n: number, k: string | number, token: string | number) {
      if (live(String(k))?.v !== token) return 0;
      db.delete(String(k));
      return 1;
    },
  };
}

// Phase 1 review B regressions (M3, B1, M6).
describe('review: cross-instance lock', () => {
  it('MAJOR: release() deletes the lock even when another instance owns it (refresh outlived the lock TTL)', async () => {
    const clock = { now: 0 };
    const redis = fakeRedis(clock);
    const a = new RedisStore(async () => redis); // instance A
    const b = new RedisStore(async () => redis); // instance B (same pid "1" in every container)
    const c = new RedisStore(async () => redis);
    const ta = await a.acquire('feed:flights', 30_000);
    expect(ta).toBeTruthy();
    clock.now += 46_300; // default httpRequest worst case: 3 × 15 s timeouts + backoff > 30 s lock
    expect(await b.acquire('feed:flights', 30_000)).toBeTruthy();
    await a.release('feed:flights', ta!); // A finishes late: must not free B's lock
    expect(await c.acquire('feed:flights', 30_000)).toBeNull();
  });
});

describe('review: poller vs stale-on-error', () => {
  it('MAJOR: the feed poll loop bypasses retryAfterErrorMs and hammers a failing upstream every pollMs', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const feed = defineFeed<number[]>({
      key: 'rv-failing',
      ttlMs: 5_000,
      kind: 'live',
      attribution: [{ text: 'x' }],
      count: (d) => d.length,
      retryAfterErrorMs: 60_000,
      async run() {
        calls++;
        throw new HttpError('HTTP 503', 'http', 'https://up.example/', 503);
      },
    });
    await feed.get();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(55_000); // 11 poll ticks inside the 60 s back-off window
    expect(calls).toBe(1);
  });
});

describe('review: user-keyed caches evict feed last-good data', () => {
  it('MAJOR: 500 distinct per-query sourceCache keys push a feed out of L1 and 1000 geocoder keys push it out of the store', async () => {
    let fail = false;
    const quakes = sourceCache<number[]>('feed:rv-quakes', async () => {
      if (fail) throw new HttpError('HTTP 503', 'http', 'x', 503);
      return { data: [1, 2, 3] };
    }, { ttlMs: 1 });
    expect((await quakes.get()).data).toEqual([1, 2, 3]);
    // An anonymous visitor looks up 1000 distinct hosts / callsigns (each a per-query cache).
    for (let i = 0; i < 1000; i++) {
      await sourceCache<{ q: number }>(`osint:dns:host${i}.example`, async () => ({ data: { q: i } }), { ttlMs: 600_000 }).get();
    }
    fail = true;
    await new Promise((r) => setTimeout(r, 5));
    const r = await quakes.get();
    expect(r.data).toEqual([1, 2, 3]);
  });
});
