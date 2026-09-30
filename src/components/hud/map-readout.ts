/**
 * Scale-bar labels in the visitor's units and cursor formatting, on top of map-engine's
 * metersPerPixel()/scaleBar() (src/lib/map/cursor.ts). Pure. Owner: design-system-hud.
 */
import { metersPerPixel, scaleBar as metricScaleBar } from '@/lib/map/cursor';
import type { Settings } from '@/lib/store';

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

/** A round distance that fits in `maxPx` at the view centre, in metric, imperial or aviation (NM) units. */
export function scaleBarFor(lat: number, zoom: number, maxPx: number, units: Settings['units']): ScaleBar | null {
  if (!Number.isFinite(lat) || !Number.isFinite(zoom)) return null;
  const mpp = metersPerPixel(lat, zoom);
  if (!(mpp > 0) || !Number.isFinite(mpp)) return null;
  if (units === 'metric') {
    const { meters, px } = metricScaleBar(lat, zoom, maxPx);
    return { widthPx: px, label: meters >= 1000 ? `${(meters / 1000).toLocaleString('en-US')} KM` : `${meters} M` };
  }
  const maxM = mpp * maxPx;
  const big = units === 'imperial' ? 1609.344 : 1852;
  const unit = units === 'imperial' ? 'MI' : 'NM';
  if (maxM / big >= 1) {
    const n = niceBelow(maxM / big);
    return { widthPx: (n * big) / mpp, label: `${n.toLocaleString('en-US')} ${unit}` };
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
