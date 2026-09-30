/**
 * Camera and atmosphere constants for the globe (§1, §5). Owner: map-engine.
 */
import type { SkySpecification } from 'maplibre-gl';

export interface InitialCamera {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

/** Open facing the viewer's timezone: lng = −tzOffsetMinutes / 4, zoom 1.8, pitch 20. */
export function initialCamera(tzOffsetMinutes: number): InitialCamera {
  const lng = Math.max(-180, Math.min(180, -tzOffsetMinutes / 4));
  return { longitude: lng, latitude: 20, zoom: 1.8, pitch: 20, bearing: 0 };
}

/** Atmosphere per §5: sky #05070D, horizon #0E1A2B, atmosphere-blend 0:1 → 5:1 → 7:0. */
export const GLOBE_SKY: SkySpecification = {
  'sky-color': '#05070D',
  'horizon-color': '#0E1A2B',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.4,
  'fog-color': '#04040A',
  'fog-ground-blend': 0.9,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
};

export const RESET_VIEW = { latitude: 20, longitude: 0, zoom: 2.5, pitch: 20, bearing: 0 } as const;

/** Stacked twilight fills: civil, nautical, astronomical, night (opacity adds up where they overlap). */
export const TWILIGHT_OPACITY: Record<string, number> = { civil: 0.12, nautical: 0.14, astronomical: 0.16, night: 0.2 };
