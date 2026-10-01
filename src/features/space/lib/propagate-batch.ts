/**
 * Bulk propagation used by the tle-propagate worker (and its determinism tests). Pure: the same
 * catalogue, time, view and palette always give the same typed arrays. Owner: layers-space.
 *
 * Two steps, so a camera move re-filters the newest propagation without running SGP4 again:
 *   propagateVisible  SGP4 for every satellite in a visible category (or selected) at `at`;
 *   compactFrame      far-side filter + colours + compaction for the current camera and palette.
 * `propagateBatch` runs both.
 *
 * Far side (§3, CLAUDE.md globe rules): a satellite is drawn only while it is above the camera's
 * horizon AT THE ALTITUDE IT IS DRAWN AT — `isFacing(p, camera, displayAltM(altKm))` from
 * src/lib/map/far-side.ts. Behind-globe satellites are neither drawn nor pickable (the picker only
 * sees drawn rows). A plain "within 90° of the map centre" test is wrong both ways: it drew LEO
 * satellites behind the limb and hid GEO satellites that rise above it.
 *
 * Output layout (compacted to the visible set, ready for deck.gl binary attributes):
 *   positions  Float32Array  [lng, lat, zMeters] × n   (z = display altitude, see displayAltM)
 *   colors     Uint8Array    [r, g, b, a] × n           (mission colour; alpha dimmed in Earth's shadow)
 *   radii      Float32Array  [px] × n                   (ISS / selected highlighted)
 *   index      Uint32Array   [catalogue index] × n      (picking → row)
 */
import type { SatRec } from 'satellite.js';
import { isFacing, type FarSideCamera } from '@/lib/map/far-side';
import { propagateAt } from './orbit';
import { ISS_NORAD_ID, displayAltM } from './orbit-math';
import { inEarthShadow, sunDirection } from './shadow';

export { ISS_NORAD_ID, displayAltM } from './orbit-math';
export type { FarSideCamera } from '@/lib/map/far-side';

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
  /**
   * Far-side camera on the globe (ground point under the camera + its altitude in metres, as the
   * map host publishes it for `isFacing()`); null in mercator, where everything faces the viewer.
   */
  camera: FarSideCamera | null;
  selectedId: number | null;
  /** Alpha multiplier for satellites in Earth's shadow. */
  shadowAlpha?: number;
}

export type SelectedTelemetry = { noradId: number; lng: number; lat: number; altKm: number; velocityKmS: number; shadow: boolean };

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
  selected: SelectedTelemetry | null;
  /** The camera this frame was far-side filtered with (null: mercator / not published yet). */
  camera: FarSideCamera | null;
}

/** One tick of SGP4 for the visible categories, before the far-side filter (worker-internal). */
export interface Propagated {
  at: number;
  /** Rows propagated successfully. */
  n: number;
  catIndex: Uint32Array;
  lng: Float64Array;
  lat: Float64Array;
  altKm: Float64Array;
  /** Display altitude (m) the marker is drawn at — the altitude the far-side test lifts it by. */
  displayAltM: Float64Array;
  velocityKmS: Float64Array;
  shadow: Uint8Array;
  /** Skipped because their category was hidden (and they were not selected). */
  categoryHidden: number;
  failed: number;
}

export function propagateVisible(input: BatchInput, opts: Pick<BatchOptions, 'at' | 'visible' | 'selectedId'>): Propagated {
  const total = input.satrecs.length;
  const catIndex = new Uint32Array(total);
  const lng = new Float64Array(total);
  const lat = new Float64Array(total);
  const altKm = new Float64Array(total);
  const dispAlt = new Float64Array(total);
  const velocity = new Float64Array(total);
  const shadow = new Uint8Array(total);
  const when = new Date(opts.at);
  const sun = sunDirection(opts.at);
  let n = 0;
  let categoryHidden = 0;
  let failed = 0;
  for (let i = 0; i < total; i++) {
    const rec = input.satrecs[i];
    if (!rec) {
      failed++;
      continue;
    }
    if (!opts.visible.has(input.categories[i]!) && input.noradIds[i] !== opts.selectedId) {
      categoryHidden++;
      continue;
    }
    const p = propagateAt(rec, when);
    if (!p) {
      failed++;
      continue;
    }
    catIndex[n] = i;
    lng[n] = p.lng;
    lat[n] = p.lat;
    altKm[n] = p.altKm;
    dispAlt[n] = displayAltM(p.altKm);
    velocity[n] = p.velocityKmS;
    shadow[n] = inEarthShadow(p.lat, p.lng, p.altKm, sun) ? 1 : 0;
    n++;
  }
  return { at: opts.at, n, catIndex, lng, lat, altKm, displayAltM: dispAlt, velocityKmS: velocity, shadow, categoryHidden, failed };
}

/**
 * Far-side filter, colours and compaction for the current view. Cheap (no SGP4): the worker runs
 * it again on the newest propagation whenever the camera moves.
 */
export function compactFrame(
  input: Pick<BatchInput, 'noradIds' | 'categories'>,
  prop: Propagated,
  opts: Pick<BatchOptions, 'palette' | 'visible' | 'camera' | 'selectedId' | 'shadowAlpha'>,
): BatchResult {
  const positions = new Float32Array(prop.n * 3);
  const colors = new Uint8Array(prop.n * 4);
  const radii = new Float32Array(prop.n);
  const index = new Uint32Array(prop.n);
  const shadowAlpha = opts.shadowAlpha ?? 0.3;
  let count = 0;
  let hidden = prop.categoryHidden;
  let selected: SelectedTelemetry | null = null;
  for (let j = 0; j < prop.n; j++) {
    const i = prop.catIndex[j]!;
    const cat = input.categories[i]!;
    const id = input.noradIds[i]!;
    const isSelected = id === opts.selectedId;
    const lng = prop.lng[j]!;
    const lat = prop.lat[j]!;
    const inShadow = prop.shadow[j] === 1;
    if (isSelected) selected = { noradId: id, lng, lat, altKm: prop.altKm[j]!, velocityKmS: prop.velocityKmS[j]!, shadow: inShadow };
    if (!opts.visible.has(cat) && !isSelected) {
      hidden++;
      continue;
    }
    const altM = prop.displayAltM[j]!;
    if (!isFacing([lng, lat], opts.camera, altM)) {
      hidden++;
      continue;
    }
    positions[count * 3] = lng;
    positions[count * 3 + 1] = lat;
    positions[count * 3 + 2] = altM;
    const c = opts.palette[cat] ?? opts.palette[opts.palette.length - 1]!;
    colors[count * 4] = c[0];
    colors[count * 4 + 1] = c[1];
    colors[count * 4 + 2] = c[2];
    colors[count * 4 + 3] = Math.round(c[3] * (inShadow ? shadowAlpha : 1));
    radii[count] = isSelected ? 6 : id === ISS_NORAD_ID ? 5 : 1.6;
    index[count] = i;
    count++;
  }
  return {
    at: prop.at,
    count,
    positions: positions.slice(0, count * 3),
    colors: colors.slice(0, count * 4),
    radii: radii.slice(0, count),
    index: index.slice(0, count),
    hidden,
    failed: prop.failed,
    selected,
    camera: opts.camera ? { ...opts.camera } : null,
  };
}

export function propagateBatch(input: BatchInput, opts: BatchOptions): BatchResult {
  return compactFrame(input, propagateVisible(input, opts), opts);
}
