/**
 * Zero-render pointer and view feeds for the HUD readout and scale bar. The map host publishes
 * the cursor on (rAF-throttled) mousemove and the view on move; design-system-hud subscribes and
 * writes straight into DOM refs, so no React state changes per mousemove.
 * Owner: map-engine. Pure and unit-tested.
 */

/** MapLibre's world is 512 px wide at zoom 0 (WGS84 equatorial circumference, metres). */
export const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export interface MapPoint {
  lng: number;
  lat: number;
  zoom: number;
}

/** Ground metres per CSS pixel at latitude `lat` and zoom `zoom` (Web Mercator, 512 px tiles). */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI) / 180)) / (512 * 2 ** zoom);
}

type Listener<T> = (v: T) => void;

function channel<T>() {
  let last: T | null = null;
  const subs = new Set<Listener<T | null>>();
  return {
    publish(v: T | null) {
      last = v;
      for (const fn of subs) fn(v);
    },
    subscribe(fn: Listener<T | null>) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    get: () => last,
  };
}

const cursor = channel<MapPoint>();
const view = channel<MapPoint>();

/** Pointer position over the map (null when it leaves the canvas). */
export const publishCursor = cursor.publish;
export const subscribeCursor = cursor.subscribe;
export const getCursor = cursor.get;

/** Map centre and zoom (updated on every move; for the scale bar and telemetry). */
export const publishView = view.publish;
export const subscribeView = view.subscribe;
export const getView = view.get;

/**
 * A "nice" scale-bar length (1/2/5 × 10^n metres) that fits in `maxPx` pixels, and its width.
 * Returns metres; the HUD converts to its unit setting.
 */
export function scaleBar(lat: number, zoom: number, maxPx = 100): { meters: number; px: number } {
  const mpp = metersPerPixel(lat, zoom);
  const maxMeters = mpp * maxPx;
  const pow = 10 ** Math.floor(Math.log10(maxMeters));
  const step = [5, 2, 1].map((s) => s * pow).find((m) => m <= maxMeters) ?? pow;
  return { meters: step, px: step / mpp };
}
