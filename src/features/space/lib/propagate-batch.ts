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
 * Output layout (compacted to the visible set, ready for deck.gl binary attributes). Rows are
 * SORTED BY CATEGORY (SAT_CATEGORIES order, catalogue order within a category) so the client can
 * draw one IconLayer per mission glyph over `subarray` views — deck.gl's IconLayer cannot take
 * `getIcon` as a binary attribute:
 *   positions        Float32Array  [lng, lat, zMeters] × n   (z = display altitude, see displayAltM)
 *   colors           Uint8Array    [r, g, b, a] × n           (mission colour; alpha dimmed in Earth's shadow)
 *   sizes            Float32Array  [px] × n                   (glyph height; ISS / selected enlarged)
 *   index            Uint32Array   [catalogue index] × n      (picking → row)
 *   categoryOffsets  Uint32Array   [start of category c] × (SAT_CATEGORY_COUNT + 1); rows of
 *                                  category c are [categoryOffsets[c], categoryOffsets[c + 1])
 */
import type { SatRec } from 'satellite.js';
import { isFacing, type FarSideCamera } from '@/lib/map/far-side';
import { propagateAt } from './orbit';
import { ISS_NORAD_ID, displayAltM } from './orbit-math';
import { inEarthShadow, sunDirection } from './shadow';

export { ISS_NORAD_ID, displayAltM } from './orbit-math';
export type { FarSideCamera } from '@/lib/map/far-side';

/** Number of mission categories (SAT_CATEGORIES in catalog.ts; a category index past the end draws as the last one, "other"). */
export const SAT_CATEGORY_COUNT = 6;

/** Glyph height in px: every satellite, the ISS, the selected satellite. */
export const SAT_SIZE_PX = 8;
export const ISS_SIZE_PX = 14;
export const SELECTED_SIZE_PX = 16;

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

export type SelectedTelemetry = {
  noradId: number;
  lng: number;
  lat: number;
  altKm: number;
  velocityKmS: number;
  shadow: boolean;
};

export interface BatchResult {
  at: number;
  count: number;
  positions: Float32Array;
  colors: Uint8Array;
  sizes: Float32Array;
  index: Uint32Array;
  /** Rows of category c are [categoryOffsets[c], categoryOffsets[c + 1]); length SAT_CATEGORY_COUNT + 1. */
  categoryOffsets: Uint32Array;
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

/** The category slot a row draws in (out-of-range indices draw as the last category). */
function slotOf(cat: number): number {
  return cat >= 0 && cat < SAT_CATEGORY_COUNT ? cat : SAT_CATEGORY_COUNT - 1;
}

/**
 * SGP4 for every visible (or selected) satellite at `opts.at`. Pass the previous result as `reuse`
 * to propagate into its buffers (the worker does, every tick: no per-tick allocation once the
 * buffers fit the catalogue); `reuse` is then overwritten and returned.
 */
export function propagateVisible(input: BatchInput, opts: Pick<BatchOptions, 'at' | 'visible' | 'selectedId'>, reuse?: Propagated | null): Propagated {
  const total = input.satrecs.length;
  const fits = !!reuse && reuse.catIndex.length >= total;
  const catIndex = fits ? reuse!.catIndex : new Uint32Array(total);
  const lng = fits ? reuse!.lng : new Float64Array(total);
  const lat = fits ? reuse!.lat : new Float64Array(total);
  const altKm = fits ? reuse!.altKm : new Float64Array(total);
  const dispAlt = fits ? reuse!.displayAltM : new Float64Array(total);
  const velocity = fits ? reuse!.velocityKmS : new Float64Array(total);
  const shadow = fits ? reuse!.shadow : new Uint8Array(total);
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
  const out: Propagated = fits
    ? reuse!
    : {
        at: 0,
        n: 0,
        catIndex,
        lng,
        lat,
        altKm,
        displayAltM: dispAlt,
        velocityKmS: velocity,
        shadow,
        categoryHidden: 0,
        failed: 0,
      };
  out.at = opts.at;
  out.n = n;
  out.categoryHidden = categoryHidden;
  out.failed = failed;
  return out;
}

/** Per-row draw slot for the current filter (255 = not drawn); grown, never shrunk. */
let slotScratch = new Uint8Array(0);
const NOT_DRAWN = 255;
const cursor = new Uint32Array(SAT_CATEGORY_COUNT);

/**
 * Far-side filter, colours, sizes and a category sort for the current view. Cheap (no SGP4): the
 * worker runs it again on the newest propagation whenever the camera moves. Two passes (filter +
 * count, then a counting-sort fill) so the output arrays are allocated once at their exact size —
 * they are transferred to the main thread, so they cannot be reused.
 */
export function compactFrame(
  input: Pick<BatchInput, 'noradIds' | 'categories'>,
  prop: Propagated,
  opts: Pick<BatchOptions, 'palette' | 'visible' | 'camera' | 'selectedId' | 'shadowAlpha'>,
): BatchResult {
  if (slotScratch.length < prop.n) slotScratch = new Uint8Array(prop.n);
  const slots = slotScratch;
  const categoryOffsets = new Uint32Array(SAT_CATEGORY_COUNT + 1);
  const shadowAlpha = opts.shadowAlpha ?? 0.3;
  let count = 0;
  let hidden = prop.categoryHidden;
  let selected: SelectedTelemetry | null = null;

  // Pass 1: which rows draw, and how many per category.
  for (let j = 0; j < prop.n; j++) {
    const i = prop.catIndex[j]!;
    const cat = input.categories[i]!;
    const id = input.noradIds[i]!;
    const isSelected = id === opts.selectedId;
    if (isSelected)
      selected = {
        noradId: id,
        lng: prop.lng[j]!,
        lat: prop.lat[j]!,
        altKm: prop.altKm[j]!,
        velocityKmS: prop.velocityKmS[j]!,
        shadow: prop.shadow[j] === 1,
      };
    if ((!opts.visible.has(cat) && !isSelected) || !isFacing([prop.lng[j]!, prop.lat[j]!], opts.camera, prop.displayAltM[j]!)) {
      slots[j] = NOT_DRAWN;
      hidden++;
      continue;
    }
    const slot = slotOf(cat);
    slots[j] = slot;
    categoryOffsets[slot + 1]!++;
    count++;
  }
  for (let c = 0; c < SAT_CATEGORY_COUNT; c++) {
    categoryOffsets[c + 1]! += categoryOffsets[c]!;
    cursor[c] = categoryOffsets[c]!;
  }

  // Pass 2: counting-sort fill (stable: catalogue order within each category).
  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4);
  const sizes = new Float32Array(count);
  const index = new Uint32Array(count);
  for (let j = 0; j < prop.n; j++) {
    const slot = slots[j]!;
    if (slot === NOT_DRAWN) continue;
    const k = cursor[slot]!++;
    const i = prop.catIndex[j]!;
    const id = input.noradIds[i]!;
    positions[k * 3] = prop.lng[j]!;
    positions[k * 3 + 1] = prop.lat[j]!;
    positions[k * 3 + 2] = prop.displayAltM[j]!;
    const c = opts.palette[input.categories[i]!] ?? opts.palette[opts.palette.length - 1]!;
    colors[k * 4] = c[0];
    colors[k * 4 + 1] = c[1];
    colors[k * 4 + 2] = c[2];
    colors[k * 4 + 3] = Math.round(c[3] * (prop.shadow[j] === 1 ? shadowAlpha : 1));
    sizes[k] = id === opts.selectedId ? SELECTED_SIZE_PX : id === ISS_NORAD_ID ? ISS_SIZE_PX : SAT_SIZE_PX;
    index[k] = i;
  }
  return {
    at: prop.at,
    count,
    positions,
    colors,
    sizes,
    index,
    categoryOffsets,
    hidden,
    failed: prop.failed,
    selected,
    camera: opts.camera ? { ...opts.camera } : null,
  };
}

export function propagateBatch(input: BatchInput, opts: BatchOptions): BatchResult {
  return compactFrame(input, propagateVisible(input, opts), opts);
}
