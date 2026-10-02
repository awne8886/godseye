import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONTEXT_ATTRIBUTE_LADDER, DESKTOP_MIN_ZOOM, effectiveProjection, GLOBE_SKY, initialCamera, mediaQueryStore, minZoomFor, normalizeCamera, PHONE_LAYOUT_QUERY, PHONE_MIN_ZOOM, projectionPitchEase } from './view';

describe('R1r4-m5: phone minZoom follows the HUD phone-layout media query', () => {
  it('uses the same query as the HUD (useIsMobile)', () => {
    const hud = readFileSync(new URL('../../components/hud/hooks.ts', import.meta.url), 'utf8');
    expect(hud).toContain(`'${PHONE_LAYOUT_QUERY}'`);
  });
  it('phone layout (portrait < 768 px or a landscape phone) zooms out to 0.3, else 1.2', () => {
    expect(minZoomFor(true)).toBe(PHONE_MIN_ZOOM);
    expect(minZoomFor(false)).toBe(DESKTOP_MIN_ZOOM);
  });
  it('re-reads the query on change (rotation / resize)', () => {
    let matches = false;
    const listeners = new Set<() => void>();
    const mql = { get matches() { return matches; }, addEventListener: (_: string, cb: () => void) => listeners.add(cb), removeEventListener: (_: string, cb: () => void) => listeners.delete(cb) };
    const store = mediaQueryStore(PHONE_LAYOUT_QUERY, { matchMedia: () => mql as unknown as MediaQueryList });
    const seen: boolean[] = [];
    const off = store.subscribe(() => seen.push(store.get()));
    expect(store.get()).toBe(false);
    matches = true; // 844×390 landscape phone after rotation
    for (const cb of listeners) cb();
    expect(seen).toEqual([true]);
    off();
    expect(listeners.size).toBe(0);
    expect(mediaQueryStore(PHONE_LAYOUT_QUERY, undefined).get()).toBe(false);
  });
});

describe('projection', () => {
  it('is mercator while terrain is engaged, else the user choice', () => {
    expect(effectiveProjection('globe', true)).toBe('mercator');
    expect(effectiveProjection('globe', false)).toBe('globe');
    expect(effectiveProjection('mercator', false)).toBe('mercator');
  });
  it('eases pitch on a user switch: flat into 2D, tilted onto the globe', () => {
    expect(projectionPitchEase('mercator', 45)).toEqual({ pitch: 0, duration: 350 });
    expect(projectionPitchEase('mercator', 0)).toBeNull();
    expect(projectionPitchEase('globe', 0)).toEqual({ pitch: 20, duration: 1200 });
    expect(projectionPitchEase('globe', 30)).toBeNull();
  });
});

describe('camera normalisation and context ladder', () => {
  it('wraps longitudes before the camera reaches the store/URL', () => {
    expect(normalizeCamera({ longitude: 190, latitude: 10, zoom: 3, pitch: 0, bearing: 0 }).lng).toBe(-170);
    expect(normalizeCamera({ longitude: -540, latitude: 91, zoom: 3, pitch: 0, bearing: 0 })).toMatchObject({ lng: -180, lat: 90 });
    expect(normalizeCamera({ longitude: 12.5, latitude: 0, zoom: 1, pitch: 20, bearing: 5 })).toEqual({ lng: 12.5, lat: 0, zoom: 1, pitch: 20, bearing: 5 });
  });
  it('walks from default to low-power to no-antialias', () => {
    expect(CONTEXT_ATTRIBUTE_LADDER).toHaveLength(3);
    expect(CONTEXT_ATTRIBUTE_LADDER[0]).toBeUndefined();
    expect(CONTEXT_ATTRIBUTE_LADDER[2]).toMatchObject({ powerPreference: 'low-power', antialias: false });
  });
});

describe('initial camera', () => {
  it('faces the viewer timezone', () => {
    expect(initialCamera(240).longitude).toBe(-60); // New York (UTC−4)
    expect(initialCamera(-330).longitude).toBe(82.5); // India (UTC+5:30)
    expect(initialCamera(-900).longitude).toBe(180); // clamped
    expect(initialCamera(0)).toEqual({ longitude: -0, latitude: 20, zoom: 1.8, pitch: 20, bearing: 0 });
  });
  it('uses the §5 atmosphere', () => {
    // #05070D at zero alpha: the starfield behind the canvas shows through (r10).
    expect(GLOBE_SKY['sky-color']).toBe('rgba(5, 7, 13, 0)');
    expect(GLOBE_SKY['atmosphere-blend']).toEqual(['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0]);
  });
});
