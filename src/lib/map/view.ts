/**
 * Camera and atmosphere constants for the globe (§1, §5). Owner: map-engine.
 */
import type { SkySpecification } from 'maplibre-gl';
import { normalizeLng } from '@/lib/geo';

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

/** Projection handed to `<Map projection>`: mercator while terrain is engaged (§4), else the user's. */
export function effectiveProjection(user: 'globe' | 'mercator', terrainEngaged: boolean): 'globe' | 'mercator' {
  return terrainEngaged ? 'mercator' : user;
}

/**
 * Camera ease on a user projection switch (OSIRIS map-projection.ts): to mercator, flatten the
 * pitch (350 ms); to globe, tilt a flat camera to 20° (1200 ms). null = no ease needed.
 */
export function projectionPitchEase(next: 'globe' | 'mercator', pitch: number): { pitch: number; duration: number } | null {
  if (next === 'mercator' && pitch > 0.5) return { pitch: 0, duration: 350 };
  if (next === 'globe' && pitch < 0.5) return { pitch: 20, duration: 1200 };
  return null;
}

/**
 * WebGL context attempts, strongest first (OSIRIS OsirisMap.tsx ~350): default → low-power
 * without failIfMajorPerformanceCaveat → also without antialias. MapLibre 6 is WebGL2-only.
 */
export const CONTEXT_ATTRIBUTE_LADDER: readonly (WebGLContextAttributes | undefined)[] = [
  undefined,
  { powerPreference: 'low-power', failIfMajorPerformanceCaveat: false },
  { powerPreference: 'low-power', failIfMajorPerformanceCaveat: false, antialias: false },
];

/** Camera for the store/URL: longitude wrapped into [-180, 180], finite values only. */
export function normalizeCamera(v: { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number }) {
  return {
    lng: normalizeLng(v.longitude),
    lat: Math.max(-90, Math.min(90, v.latitude)),
    zoom: v.zoom,
    pitch: v.pitch,
    bearing: v.bearing,
  };
}
