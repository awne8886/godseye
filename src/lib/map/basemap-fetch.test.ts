import { describe, expect, it, vi } from 'vitest';
import planet from './__fixtures__/openfreemap-planet-tilejson.2026-09-30.json';
import { BASEMAP_FETCH_TIMEOUT_MS, fetchBasemapStyle, loadBasemapWithRetry, STYLE_RETRY_BASE_MS, styleRetryDelayMs } from './basemap-fetch';
import { BASEMAP_STYLE_URL, BASEMAP_TILEJSON_URL } from './basemap-urls';

const style = (url: string) => ({ version: 8, sources: { openmaptiles: { type: 'vector', url } }, layers: [] });
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const fail = (status: number) => Promise.resolve({ ok: false, status, json: () => Promise.reject(new Error('no body')) });

describe('fetchBasemapStyle (first paint: style and TileJSON in parallel)', () => {
  it('requests the expected TileJSON alongside the style and inlines it', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn((url: string) => {
      calls.push(url);
      return url === BASEMAP_STYLE_URL ? ok(style(BASEMAP_TILEJSON_URL)) : ok(planet);
    });
    const out = await fetchBasemapStyle(new AbortController().signal, fetchFn);
    // Both requests are in flight before the style body is read.
    expect(calls.slice(0, 2).sort()).toEqual([BASEMAP_STYLE_URL, BASEMAP_TILEJSON_URL].sort());
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const src = out.sources.openmaptiles as { url?: string; tiles?: string[] };
    expect(src.url).toBeUndefined();
    expect(src.tiles?.[0]).toMatch(/^https:\/\/tiles\.openfreemap\.org\/planet\//);
  });

  it('fetches a different TileJSON named by the style after it (the early one is ignored)', async () => {
    const other = 'https://tiles.openfreemap.org/planet-v2';
    const fetchFn = vi.fn((url: string) => (url === BASEMAP_STYLE_URL ? ok(style(other)) : url === other ? ok({ ...planet, tiles: planet.tiles.map((t: string) => t.replace('/planet/', '/planet-v2/')) }) : fail(404)));
    const out = await fetchBasemapStyle(new AbortController().signal, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect((out.sources.openmaptiles as { tiles: string[] }).tiles[0]).toContain('/planet-v2/');
  });

  it('rejects when the TileJSON the style needs failed (the caller retries; no blank globe)', async () => {
    const fetchFn = vi.fn((url: string) => (url === BASEMAP_STYLE_URL ? ok(style(BASEMAP_TILEJSON_URL)) : fail(503)));
    await expect(fetchBasemapStyle(new AbortController().signal, fetchFn)).rejects.toThrow('basemap TileJSON HTTP 503');
  });

  it('rejects on a failed style', async () => {
    const fetchFn = vi.fn((url: string) => (url === BASEMAP_STYLE_URL ? fail(502) : ok(planet)));
    await expect(fetchBasemapStyle(new AbortController().signal, fetchFn)).rejects.toThrow('basemap style HTTP 502');
  });
});

describe('R1r4-m1: a hung style request times out and is retried (BASEMAP UNAVAILABLE, never a blank page)', () => {
  it('aborts and rejects a request that never answers, even when fetch ignores its signal', async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const hung = (_url: string, init: RequestInit) => {
        signals.push(init.signal!);
        return new Promise<never>(() => undefined);
      };
      const outcome = fetchBasemapStyle(new AbortController().signal, hung).then(
        () => 'resolved',
        (e: Error) => e.message,
      );
      await vi.advanceTimersByTimeAsync(BASEMAP_FETCH_TIMEOUT_MS - 1);
      expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toBe('basemap style timed out after 15 s');
      expect(signals.length).toBe(2);
      expect(signals.every((s) => s.aborted)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a slow but answering request is not cut short', async () => {
    vi.useFakeTimers();
    try {
      const later = (body: unknown) =>
        new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((r) => setTimeout(() => r({ ok: true, status: 200, json: () => Promise.resolve(body) }), 9000));
      const fetchFn = (url: string) => (url === BASEMAP_STYLE_URL ? later(style(BASEMAP_TILEJSON_URL)) : later(planet));
      const out = fetchBasemapStyle(new AbortController().signal, fetchFn);
      await vi.advanceTimersByTimeAsync(9000);
      await expect(out).resolves.toMatchObject({ version: 8 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries after 2, 4, 8, 16 then every 30 s, reports each failure, and stops once loaded', async () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      const starts: number[] = [];
      let answer = false;
      const load = () => {
        starts.push(Date.now() - t0);
        return answer ? Promise.resolve('style') : Promise.reject(new Error('basemap style timed out after 15 s'));
      };
      const waits: number[] = [];
      const loaded: string[] = [];
      const cancel = loadBasemapWithRetry(load, { onLoaded: (s) => loaded.push(s), onFailed: (_e, wait) => waits.push(wait) });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(starts).toEqual([0, 2000, 6000, 14_000, 30_000, 60_000]);
      expect(waits).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000]);
      answer = true;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(loaded).toEqual(['style']);
      const n = starts.length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(starts.length).toBe(n);
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel aborts the request in flight and schedules nothing more', async () => {
    vi.useFakeTimers();
    try {
      const seen: AbortSignal[] = [];
      const load = (signal: AbortSignal) => {
        seen.push(signal);
        return Promise.reject(new Error('down'));
      };
      const onFailed = vi.fn();
      const cancel = loadBasemapWithRetry(load, { onLoaded: vi.fn(), onFailed });
      await vi.advanceTimersByTimeAsync(0);
      cancel();
      expect(seen[0]!.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onFailed).toHaveBeenCalledTimes(1);
      expect(styleRetryDelayMs(1)).toBe(STYLE_RETRY_BASE_MS);
    } finally {
      vi.useRealTimers();
    }
  });
});
