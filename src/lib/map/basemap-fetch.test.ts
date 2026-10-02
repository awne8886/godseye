import { describe, expect, it, vi } from 'vitest';
import darkStyle from './__fixtures__/openfreemap-dark.2026-09-30.json';
import planet from './__fixtures__/openfreemap-planet-tilejson.2026-09-30.json';
import { BASEMAP_FETCH_TIMEOUT_MS, createBasemapStyleLoader, fetchBasemapStyle, loadBasemapWithRetry, STYLE_RETRY_BASE_MS, styleRetryDelayMs } from './basemap-fetch';
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

describe('R1r5-m2: a retry refetches only the document that failed (memoised per URL)', () => {
  // The real documents as probed (OpenFreeMap dark style + planet TileJSON, 2026-09-30).
  const okFor = (url: string) => (url === BASEMAP_STYLE_URL ? ok(darkStyle) : ok(planet));
  type Res = { ok: boolean; status: number; json: () => Promise<unknown> };

  it('attempt 1: style 200 / TileJSON fails → attempt 2 asks for the TileJSON only', async () => {
    const calls: string[] = [];
    let tileJsonUp = false;
    const fetchFn = vi.fn((url: string): Promise<Res> => {
      calls.push(url);
      if (url === BASEMAP_TILEJSON_URL && !tileJsonUp) return Promise.reject(new TypeError('net::ERR_TOO_MANY_RETRIES'));
      return okFor(url);
    });
    const load = createBasemapStyleLoader(fetchFn);
    const signal = new AbortController().signal;
    await expect(load(signal)).rejects.toThrow('ERR_TOO_MANY_RETRIES');
    expect([...calls].sort()).toEqual([BASEMAP_STYLE_URL, BASEMAP_TILEJSON_URL].sort());
    calls.length = 0;
    tileJsonUp = true;
    const out = await load(signal);
    expect(calls).toEqual([BASEMAP_TILEJSON_URL]);
    expect((out.sources.openmaptiles as { tiles: string[] }).tiles[0]).toContain('/planet/20260927_080001_pt/');
    expect(out.layers.length).toBe(darkStyle.layers.length);
  });

  it('attempt 1: TileJSON 200 / style fails → attempt 2 asks for the style only', async () => {
    const calls: string[] = [];
    let styleUp = false;
    const fetchFn = vi.fn((url: string): Promise<Res> => {
      calls.push(url);
      return url === BASEMAP_STYLE_URL && !styleUp ? fail(502) : okFor(url);
    });
    const load = createBasemapStyleLoader(fetchFn);
    const signal = new AbortController().signal;
    await expect(load(signal)).rejects.toThrow('basemap style HTTP 502');
    calls.length = 0;
    styleUp = true;
    await expect(load(signal)).resolves.toMatchObject({ version: 8 });
    expect(calls).toEqual([BASEMAP_STYLE_URL]);
  });

  it('through loadBasemapWithRetry (trace #84): loaded on the 2nd attempt, the style fetched once', async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      // Attempt 1: style answers, TileJSON fails. Attempt 2: the style host now fails, the TileJSON answers.
      const fetchFn = (url: string): Promise<Res> => {
        calls.push(url);
        const first = calls.length <= 2;
        if (url === BASEMAP_TILEJSON_URL) return first ? fail(503) : ok(planet);
        return first ? ok(darkStyle) : fail(503);
      };
      const loaded: unknown[] = [];
      const failed: unknown[] = [];
      const cancel = loadBasemapWithRetry(createBasemapStyleLoader(fetchFn), { onLoaded: (s) => loaded.push(s), onFailed: (e) => failed.push(e) });
      await vi.advanceTimersByTimeAsync(STYLE_RETRY_BASE_MS + 10);
      expect(failed.length).toBe(1);
      expect(loaded.length).toBe(1);
      expect(calls.filter((u) => u === BASEMAP_STYLE_URL).length).toBe(1);
      expect(calls.filter((u) => u === BASEMAP_TILEJSON_URL).length).toBe(2);
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a request still in flight is shared by the next attempt (no duplicate request)', async () => {
    let releaseTileJson: (v: Res) => void = () => undefined;
    const calls: string[] = [];
    let styleUp = false;
    const fetchFn = (url: string): Promise<Res> => {
      calls.push(url);
      if (url === BASEMAP_TILEJSON_URL) return new Promise<Res>((r) => (releaseTileJson = r));
      return styleUp ? ok(darkStyle) : fail(500);
    };
    const load = createBasemapStyleLoader(fetchFn);
    const signal = new AbortController().signal;
    await expect(load(signal)).rejects.toThrow('basemap style HTTP 500');
    styleUp = true;
    const second = load(signal);
    releaseTileJson({ ok: true, status: 200, json: () => Promise.resolve(planet) });
    await expect(second).resolves.toMatchObject({ version: 8 });
    expect(calls.filter((u) => u === BASEMAP_TILEJSON_URL).length).toBe(1);
  });

  it('an invalid document is never kept: a 200 that is not a style, or a TileJSON without usable tiles, is fetched again', async () => {
    const calls: string[] = [];
    let good = false;
    const fetchFn = (url: string): Promise<Res> => {
      calls.push(url);
      if (url === BASEMAP_STYLE_URL) return ok(good ? darkStyle : { error: 'rate limited' });
      return ok(good ? planet : { tiles: ['http://evil.example/{z}/{x}/{y}.pbf'] });
    };
    const load = createBasemapStyleLoader(fetchFn);
    const signal = new AbortController().signal;
    await expect(load(signal)).rejects.toThrow('basemap style is not a MapLibre v8 style');
    good = true;
    calls.length = 0;
    await expect(load(signal)).resolves.toMatchObject({ version: 8 });
    expect([...calls].sort()).toEqual([BASEMAP_STYLE_URL, BASEMAP_TILEJSON_URL].sort());
  });
});
