/**
 * Pure helpers for the scale bar and cursor readout. Owner: design-system-hud.
 */
import type { Settings } from '@/lib/store';

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

/** Ground metres per CSS pixel at a latitude for MapLibre's 512 px world tile. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

const NICE = [1, 2, 3, 5];

function niceBelow(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  let best = p;
  for (const n of NICE) if (n * p <= v) best = n * p;
  return best;
}

export interface ScaleBar {
  widthPx: number;
  label: string;
}

/** A round distance that fits in `maxPx`, in the visitor's units (aviation = nautical miles). */
export function scaleBar(mpp: number, maxPx: number, units: Settings['units']): ScaleBar | null {
  if (!(mpp > 0) || !Number.isFinite(mpp)) return null;
  const maxM = mpp * maxPx;
  if (units === 'metric') {
    if (maxM >= 1000) {
      const km = niceBelow(maxM / 1000);
      return { widthPx: (km * 1000) / mpp, label: `${km.toLocaleString('en-US')} KM` };
    }
    const m = niceBelow(maxM);
    return { widthPx: m / mpp, label: `${m} M` };
  }
  if (units === 'imperial') {
    const mi = maxM / 1609.344;
    if (mi >= 1) {
      const n = niceBelow(mi);
      return { widthPx: (n * 1609.344) / mpp, label: `${n.toLocaleString('en-US')} MI` };
    }
    const ft = niceBelow(maxM / 0.3048);
    return { widthPx: (ft * 0.3048) / mpp, label: `${ft} FT` };
  }
  const nm = maxM / 1852;
  if (nm >= 1) {
    const n = niceBelow(nm);
    return { widthPx: (n * 1852) / mpp, label: `${n.toLocaleString('en-US')} NM` };
  }
  const ft = niceBelow(maxM / 0.3048);
  return { widthPx: (ft * 0.3048) / mpp, label: `${ft} FT` };
}

export function formatLatLng(lat: number, lng: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}°${ns} ${Math.abs(lng).toFixed(3)}°${ew}`;
}

/** 0.1° cache cell for reverse geocoding. */
export function geoCell(lat: number, lng: number): string {
  return `${(Math.round(lat * 10) / 10).toFixed(1)},${(Math.round(lng * 10) / 10).toFixed(1)}`;
}
