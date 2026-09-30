import { describe, expect, it, vi } from 'vitest';
import { EARTH_CIRCUMFERENCE_M, getCursor, getView, metersPerPixel, publishCursor, publishView, scaleBar, subscribeCursor, subscribeView } from './cursor';

describe('metersPerPixel', () => {
  it('matches Web Mercator with 512 px tiles', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(EARTH_CIRCUMFERENCE_M / 512, 6); // ≈ 78 271.5 m
    expect(metersPerPixel(0, 1)).toBeCloseTo(metersPerPixel(0, 0) / 2, 6);
    expect(metersPerPixel(60, 10)).toBeCloseTo(metersPerPixel(0, 10) / 2, 6); // cos 60° = ½
    expect(metersPerPixel(0, 17)).toBeCloseTo(0.597, 3);
  });
  it('clamps to the Mercator latitude limit', () => {
    expect(metersPerPixel(90, 3)).toBeCloseTo(metersPerPixel(85.051129, 3), 9);
    expect(metersPerPixel(90, 3)).toBeGreaterThan(0);
  });
});

describe('scale bar', () => {
  it('picks a 1/2/5 × 10ⁿ length that fits', () => {
    const s = scaleBar(0, 10, 100); // 76.44 m/px → 7 644 m max → 5 km
    expect(s.meters).toBe(5000);
    expect(s.px).toBeCloseTo(5000 / metersPerPixel(0, 10), 6);
    expect(scaleBar(0, 2, 100).meters).toBe(1_000_000); // 1 956 km max → 1 000 km
    expect(scaleBar(0, 4, 100).meters).toBe(200_000); // 489 km max → 200 km
  });
});

describe('cursor and view feeds (no React state)', () => {
  it('publish to subscribers and remember the last value', () => {
    const fn = vi.fn();
    const off = subscribeCursor(fn);
    publishCursor({ lng: 2.35, lat: 48.86, zoom: 5 });
    expect(fn).toHaveBeenCalledWith({ lng: 2.35, lat: 48.86, zoom: 5 });
    expect(getCursor()).toEqual({ lng: 2.35, lat: 48.86, zoom: 5 });
    publishCursor(null);
    expect(fn).toHaveBeenLastCalledWith(null);
    off();
    publishCursor({ lng: 0, lat: 0, zoom: 1 });
    expect(fn).toHaveBeenCalledTimes(2);

    const v = vi.fn();
    const offView = subscribeView(v);
    publishView({ lng: 10, lat: 20, zoom: 3 });
    expect(getView()).toEqual({ lng: 10, lat: 20, zoom: 3 });
    expect(v).toHaveBeenCalledTimes(1);
    offView();
  });
});
