import { afterEach, describe, expect, it, vi } from 'vitest';
import { solarElevation, subsolarPoint } from '@/lib/solar';
import { blackMarbleUrl } from './imagery';
import {
  applyNightAlpha,
  createNightTileLoader,
  lightAlpha,
  nightAlpha,
  nightBucket,
  nightTileTemplate,
  parseNightUrl,
  tileIsDaylit,
  tilePixelLngLat,
} from './night-lights';
import type { RawImage } from './style-images';

const AT = Date.UTC(2026, 8, 30, 18, 0);

describe('night-light alpha vs solar elevation', () => {
  it('is 0 in daylight, 1 from nautical dusk (−12°), smooth and monotonic between', () => {
    expect(nightAlpha(30)).toBe(0);
    expect(nightAlpha(0)).toBe(0);
    expect(nightAlpha(-6)).toBeCloseTo(0.5, 6);
    expect(nightAlpha(-12)).toBe(1);
    expect(nightAlpha(-40)).toBe(1);
    let prev = 0;
    for (let e = 0; e >= -12; e -= 0.5) {
      const a = nightAlpha(e);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });

  it('keeps Black Marble dark ground transparent and lights opaque', () => {
    expect(lightAlpha(5, 8, 20)).toBe(0);
    expect(lightAlpha(255, 230, 160)).toBe(1);
  });

  it('maps tile pixels to lng/lat (Web Mercator)', () => {
    expect(tilePixelLngLat(0, 0, 0, 0, 0, 256)[0]).toBe(-180);
    expect(tilePixelLngLat(0, 0, 0, 128, 128, 256)).toEqual([0, 0]);
    expect(tilePixelLngLat(0, 0, 0, 0, 0, 256)[1]).toBeCloseTo(85.0511, 3);
  });

  it('clips a tile per pixel: lit pixels on the night side keep alpha, day side goes to 0', () => {
    const size = 16;
    const src: RawImage = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(255) };
    const out = applyNightAlpha(src, 0, 0, 0, AT);
    expect(src.data[3]).toBe(255); // input untouched
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const e = solarElevation(tilePixelLngLat(0, 0, 0, px + 0.5, py + 0.5, size), AT);
        const a = out.data[(py * size + px) * 4 + 3]!;
        if (e >= 0) expect(a).toBe(0);
        if (e <= -12) expect(a).toBe(255);
      }
    }
  });

  it('skips fetching tiles that are wholly in daylight', () => {
    const sun = subsolarPoint(AT);
    const n = 2 ** 6;
    const x = Math.floor(((sun.lng + 180) / 360) * n);
    const latRad = (sun.lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
    expect(tileIsDaylit(6, x, y, AT)).toBe(true);
    expect(tileIsDaylit(6, (x + n / 2) % n, y, AT)).toBe(false);
    expect(tileIsDaylit(1, 0, 0, AT)).toBe(false);
  });
});

describe('night-lights URLs', () => {
  it('buckets refreshes to 5 minutes and parses tile URLs', () => {
    const b = nightBucket(AT + 299_999);
    expect(b).toBe(AT);
    expect(nightTileTemplate(b)).toBe(`godseye-night://{z}/{x}/{y}?t=${AT}`);
    expect(parseNightUrl(`godseye-night://3/4/2?t=${AT}`)).toEqual({ z: 3, x: 4, y: 2, t: AT });
    expect(parseNightUrl(`godseye-night://9/0/0?t=${AT}`)).toBeNull(); // GIBS Level8
    expect(parseNightUrl(`godseye-night://2/4/0?t=${AT}`)).toBeNull(); // out of range
    expect(parseNightUrl('https://example.com/1/2/3')).toBeNull();
    expect(blackMarbleUrl(3, 4, 2)).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/3/2/4.png',
    );
  });
});

describe('night-lights tile loader', () => {
  const tile = (): RawImage => ({ width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) });
  const encode = vi.fn(async (img: RawImage) => new Uint8Array([img.width, img.height]).buffer);
  const night = (z: number, x: number, y: number) => `godseye-night://${z}/${x}/${y}?t=${AT}`;
  // z 1 tiles always contain night somewhere, so they always go through the fetch path.
  afterEach(() => vi.useRealTimers());

  it('caches decoded tiles (LRU) and re-renders them for new times without refetching', async () => {
    const fetchTile = vi.fn(async () => tile());
    const loader = createNightTileLoader({ fetchTile, encode, maxEntries: 2 });
    const ac = new AbortController();
    await loader.load(night(1, 0, 0), ac.signal);
    await loader.load(`godseye-night://1/0/0?t=${AT + 300_000}`, ac.signal);
    expect(fetchTile).toHaveBeenCalledTimes(1);
    await loader.load(night(1, 1, 0), ac.signal);
    await loader.load(night(1, 0, 1), ac.signal); // evicts 1/0/0
    expect(loader.cacheSize()).toBe(2);
    await loader.load(night(1, 0, 0), ac.signal);
    expect(fetchTile).toHaveBeenCalledTimes(4);
  });

  it('runs at most 2 fetches at once and de-duplicates identical tiles', async () => {
    const resolvers: (() => void)[] = [];
    let inFlight = 0;
    let peak = 0;
    const fetchTile = vi.fn(
      () =>
        new Promise<RawImage>((resolve) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          resolvers.push(() => {
            inFlight--;
            resolve(tile());
          });
        }),
    );
    const loader = createNightTileLoader({ fetchTile, encode });
    const ac = new AbortController();
    const all = Promise.all([night(1, 0, 0), night(1, 0, 0), night(1, 1, 0), night(1, 0, 1), night(1, 1, 1)].map((u) => loader.load(u, ac.signal)));
    await Promise.resolve();
    expect(fetchTile).toHaveBeenCalledTimes(2);
    while (resolvers.length) {
      resolvers.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    await all;
    expect(fetchTile).toHaveBeenCalledTimes(4);
    expect(peak).toBe(2);
  });

  it('aborts a queued request without fetching it, and a lone in-flight one upstream', async () => {
    const signals: AbortSignal[] = [];
    const fetchTile = vi.fn(
      (_z: number, _x: number, _y: number, signal: AbortSignal) =>
        new Promise<RawImage>((_resolve, reject) => {
          signals.push(signal);
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    const loader = createNightTileLoader({ fetchTile, encode, maxConcurrent: 1 });
    const a = new AbortController();
    const b = new AbortController();
    const pa = loader.load(night(1, 0, 0), a.signal);
    const pb = loader.load(night(1, 1, 0), b.signal);
    b.abort(new Error('panned away'));
    await expect(pb).rejects.toThrow('panned away');
    a.abort(new Error('zoomed'));
    await expect(pa).rejects.toThrow('zoomed');
    expect(fetchTile).toHaveBeenCalledTimes(1);
    expect(signals[0]!.aborted).toBe(true);
  });

  it('times out a stuck upstream request', async () => {
    vi.useFakeTimers();
    const fetchTile = (_z: number, _x: number, _y: number, signal: AbortSignal) =>
      new Promise<RawImage>((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    const loader = createNightTileLoader({ fetchTile, encode, timeoutMs: 1000 });
    const p = loader.load(night(1, 0, 0), new AbortController().signal);
    const check = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(1001);
    await check;
  });

  it('answers daylit tiles with an empty image and rejects malformed URLs', async () => {
    const fetchTile = vi.fn(async () => tile());
    const loader = createNightTileLoader({ fetchTile, encode });
    const sun = subsolarPoint(AT);
    const x = Math.floor(((sun.lng + 180) / 360) * 64);
    const latRad = (sun.lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 64);
    const buf = await loader.load(`godseye-night://6/${x}/${y}?t=${AT}`, new AbortController().signal);
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 1]));
    expect(fetchTile).not.toHaveBeenCalled();
    await expect(loader.load('godseye-night://nope', new AbortController().signal)).rejects.toThrow(/Invalid/);
  });
});
