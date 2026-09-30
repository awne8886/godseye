import { describe, expect, it } from 'vitest';
import { CONTEXT_ATTRIBUTE_LADDER, effectiveProjection, GLOBE_SKY, initialCamera, normalizeCamera, projectionPitchEase } from './view';

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
    expect(GLOBE_SKY['sky-color']).toBe('#05070D');
    expect(GLOBE_SKY['atmosphere-blend']).toEqual(['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0]);
  });
});
