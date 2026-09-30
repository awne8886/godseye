/**
 * Bulk propagation used by the tle-propagate worker (and its determinism tests). Pure: the same
 * catalogue, time, view and palette always give the same typed arrays. Owner: layers-space.
 *
 * Output layout (compacted to the visible set, ready for deck.gl binary attributes):
 *   positions  Float32Array  [lng, lat, zMeters] × n   (z = display altitude, see displayAltM)
 *   colors     Uint8Array    [r, g, b, a] × n           (mission colour; alpha dimmed in Earth's shadow)
 *   radii      Float32Array  [px] × n                   (ISS / selected highlighted)
 *   index      Uint32Array   [catalogue index] × n      (picking → row)
 */
import type { SatRec } from 'satellite.js';
import { isFacing } from '@/lib/geo';
import { propagateAt } from './orbit';
import { inEarthShadow, sunDirection } from './shadow';

export const ISS_NORAD_ID = 25544;

export interface BatchInput {
  satrecs: readonly (SatRec | null)[];
  noradIds: Int32Array | readonly number[];
  /** Category index per satellite (0…5, SAT_CATEGORIES order). */
  categories: Uint8Array | readonly number[];
}

export interface BatchOptions {
  at: number;
  /** RGBA per category index (SAT_CATEGORIES order). */
  palette: readonly (readonly [number, number, number, number])[];
  /** Category indices to include. */
  visible: ReadonlySet<number>;
  /** Globe view centre for the far-side filter; null in mercator (everything faces the camera). */
  center: [number, number] | null;
  selectedId: number | null;
  /** Alpha multiplier for satellites in Earth's shadow. */
  shadowAlpha?: number;
}

export interface BatchResult {
  at: number;
  count: number;
  positions: Float32Array;
  colors: Uint8Array;
  radii: Float32Array;
  index: Uint32Array;
  /** Propagated but not drawn (far side / hidden category) — counts only. */
  hidden: number;
  /** Failed to propagate (decayed, invalid) — never drawn, never guessed. */
  failed: number;
  /** Position of the selected satellite this tick, if it propagated. */
  selected: { noradId: number; lng: number; lat: number; altKm: number; velocityKmS: number; shadow: boolean } | null;
}

/**
 * Display altitude on the globe, in metres. True altitudes span 160 km (LEO) to 36 000 km (GEO),
 * which would put GEO five Earth radii off the globe; a square-root compression keeps every shell
 * visible and in order (LEO ≈ 450 km, MEO ≈ 1 400 km, GEO ≈ 1 750 km). Cards show the true value.
 */
export function displayAltM(altKm: number): number {
  return (250 + 1500 * Math.sqrt(Math.max(0, altKm) / 36_000)) * 1000;
}

export function propagateBatch(input: BatchInput, opts: BatchOptions): BatchResult {
  const n = input.satrecs.length;
  const positions = new Float32Array(n * 3);
  const colors = new Uint8Array(n * 4);
  const radii = new Float32Array(n);
  const index = new Uint32Array(n);
  const when = new Date(opts.at);
  const sun = sunDirection(opts.at);
  const shadowAlpha = opts.shadowAlpha ?? 0.3;
  let count = 0;
  let hidden = 0;
  let failed = 0;
  let selected: BatchResult['selected'] = null;
  for (let i = 0; i < n; i++) {
    const rec = input.satrecs[i];
    const cat = input.categories[i]!;
    const id = input.noradIds[i]!;
    const isSelected = id === opts.selectedId;
    if (!rec || (!opts.visible.has(cat) && !isSelected)) {
      if (!rec) failed++;
      else hidden++;
      continue;
    }
    const p = propagateAt(rec, when);
    if (!p) {
      failed++;
      continue;
    }
    const shadow = inEarthShadow(p.lat, p.lng, p.altKm, sun);
    if (isSelected) selected = { noradId: id, lng: p.lng, lat: p.lat, altKm: p.altKm, velocityKmS: p.velocityKmS, shadow };
    if (opts.center && !isFacing(opts.center, [p.lng, p.lat], 90)) {
      hidden++;
      continue;
    }
    positions[count * 3] = p.lng;
    positions[count * 3 + 1] = p.lat;
    positions[count * 3 + 2] = displayAltM(p.altKm);
    const c = opts.palette[cat] ?? opts.palette[opts.palette.length - 1]!;
    colors[count * 4] = c[0];
    colors[count * 4 + 1] = c[1];
    colors[count * 4 + 2] = c[2];
    colors[count * 4 + 3] = Math.round(c[3] * (shadow ? shadowAlpha : 1));
    radii[count] = isSelected ? 6 : id === ISS_NORAD_ID ? 5 : 1.6;
    index[count] = i;
    count++;
  }
  return {
    at: opts.at,
    count,
    positions: positions.slice(0, count * 3),
    colors: colors.slice(0, count * 4),
    radii: radii.slice(0, count),
    index: index.slice(0, count),
    hidden,
    failed,
    selected,
  };
}
