import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore, clearL1, setStore } from './cache';
import { allFeeds, defineFeed, getFeed, resetFeeds, runProvider, skippedProvider } from './feeds';
import { HttpError } from './http';

beforeEach(() => {
  clearL1();
  resetFeeds();
  setStore(new MemoryStore());
});
afterEach(() => {
  resetFeeds();
  setStore(undefined);
});

describe('feeds', () => {
  it('reports providers with ok/count/ms/age_s and live meta', async () => {
    const feed = defineFeed<number[]>({
      key: 'test-live',
      ttlMs: 60_000,
      kind: 'live',
      attribution: [{ text: 'Test data' }],
      count: (d) => d.length,
      async run() {
        const a = await runProvider(async () => [1, 2, 3], (r) => r.length);
        const b = await runProvider<number[]>(async () => {
          throw new HttpError('HTTP 503', 'http', 'x', 503);
        }, (r) => r.length);
        return { data: [...(a.result ?? []), ...(b.result ?? [])], providers: { a: a.run, b: b.run, c: skippedProvider('not-configured') }, observedAt: Date.parse('2026-09-30T15:59:00Z') };
      },
    });
    const r = await feed.get();
    expect(r.data).toEqual([1, 2, 3]);
    expect(r.meta).toMatchObject({ feed: 'test-live', kind: 'live', state: 'live', stale: false, ttlSeconds: 60, observedAt: '2026-09-30T15:59:00.000Z' });
    expect(r.providers.a).toMatchObject({ ok: true, count: 3, age_s: 0 });
    expect(r.providers.b).toMatchObject({ ok: false, count: 0, error: 'http_503', age_s: null });
    expect(r.providers.c).toMatchObject({ ok: false, skipped: 'not-configured' });
    expect(feed.health()).toMatchObject({ state: 'live', count: 3 });
  });

  it('is offline (never an empty truth) when the first refresh fails or is empty', async () => {
    const feed = defineFeed<number[]>({
      key: 'test-offline', ttlMs: 60_000, kind: 'live', attribution: [], count: (d) => d.length,
      async run() {
        return { data: [], providers: {} };
      },
    });
    const r = await feed.get();
    expect(r.data).toBeNull();
    expect(r.meta.state).toBe('offline');
  });

  it('marks reference feeds as reference, never live', async () => {
    const feed = defineFeed<string[]>({
      key: 'test-ref', ttlMs: 86_400_000, kind: 'reference', attribution: [], count: (d) => d.length,
      async run() {
        return { data: ['chokepoint'], providers: {} };
      },
    });
    expect((await feed.get()).meta.state).toBe('reference');
  });

  it('caps a derived feed at its stateCap, on every read and in health, but never freshens it', async () => {
    let cap: 'recent' | 'stale' | 'live' | null = 'stale';
    const feed = defineFeed<number[]>({
      key: 'test-capped',
      ttlMs: 60_000,
      kind: 'live',
      attribution: [{ text: 'Test data' }],
      count: (d) => d.length,
      stateCap: () => cap,
      async run() {
        return { data: [1], providers: {}, observedAt: Date.now() };
      },
    });
    expect((await feed.get()).meta.state).toBe('stale');
    expect(feed.health().state).toBe('stale');
    cap = 'recent';
    expect(feed.peek().meta.state).toBe('recent');
    cap = null;
    expect(feed.peek().meta.state).toBe('live');
    cap = 'live';
    expect(feed.peek().meta.state).toBe('live');
  });

  it('registers one writer per key', () => {
    const def = { key: 'dup', ttlMs: 1000, kind: 'live' as const, attribution: [], count: () => 1, run: async () => ({ data: 1, providers: {} }) };
    const a = defineFeed(def);
    const b = defineFeed(def);
    expect(a).toBe(b);
    expect(getFeed('dup')).toBe(a);
    expect(allFeeds()).toHaveLength(1);
  });
});
