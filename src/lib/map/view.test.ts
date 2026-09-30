import { describe, expect, it } from 'vitest';
import { GLOBE_SKY, initialCamera } from './view';

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
