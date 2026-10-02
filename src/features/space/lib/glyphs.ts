/**
 * Mission glyphs for the satellite IconLayers: a 6-cell MASK atlas rasterised at runtime (no image
 * asset, no font), one glyph per SAT_CATEGORIES entry. The atlas is white with coverage in alpha;
 * deck.gl tints each glyph with the satellite's `--map-sat-*` colour (`mask: true`) and multiplies
 * in the Earth-shadow dimming. Pure and deterministic: the same pixels every call. Owner: layers-space.
 *
 *   comms       a bus with two solar-panel wings
 *   military    a diamond
 *   navigation  a triangle (apex up)
 *   earth_obs   a ringed dot (an eye on the ground)
 *   science     a four-point star
 *   other       a plain disc
 */
import type { SatCategory } from '@/lib/types';
import { SAT_CATEGORIES } from './catalog';

/** Cell edge in px (the glyphs are minified to ~8–16 px on screen; mipmaps keep them smooth). */
export const GLYPH_CELL_PX = 32;
/** Sub-samples per axis for the coverage (anti-aliased edges). */
const SS = 4;

/** Inside test in glyph space: x right, y UP, both in [-1, 1]. */
type Shape = (x: number, y: number) => boolean;

const SHAPES: Record<SatCategory, Shape> = {
  comms: (x, y) => {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const bus = ax <= 0.24 && ay <= 0.3;
    const wing = ax >= 0.36 && ax <= 0.96 && ay <= 0.22;
    const strut = ax <= 0.96 && ay <= 0.06;
    return bus || wing || strut;
  },
  military: (x, y) => Math.abs(x) + Math.abs(y) <= 0.92,
  navigation: (x, y) => y >= -0.78 && y <= 0.9 && Math.abs(x) <= ((0.9 - y) / 1.68) * 0.95,
  earth_obs: (x, y) => {
    const r = Math.hypot(x, y);
    return r <= 0.34 || (r >= 0.62 && r <= 0.92);
  },
  science: (x, y) => Math.sqrt(Math.abs(x)) + Math.sqrt(Math.abs(y)) <= Math.sqrt(0.98),
  other: (x, y) => Math.hypot(x, y) <= 0.62,
};

export interface GlyphMappingEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  mask: true;
}

export interface GlyphAtlas {
  width: number;
  height: number;
  /** RGBA, white with the glyph's coverage in alpha. */
  data: Uint8ClampedArray;
  /** deck.gl `iconMapping`, keyed by category. */
  mapping: Record<SatCategory, GlyphMappingEntry>;
}

/** Rasterise the six glyphs side by side (SAT_CATEGORIES order) into one RGBA mask atlas. */
export function buildGlyphAtlas(cell = GLYPH_CELL_PX): GlyphAtlas {
  const width = cell * SAT_CATEGORIES.length;
  const height = cell;
  const data = new Uint8ClampedArray(width * height * 4);
  const mapping = {} as Record<SatCategory, GlyphMappingEntry>;
  // One pixel of transparent margin on each side so mipmaps never bleed into a neighbour.
  const inner = cell - 2;
  SAT_CATEGORIES.forEach((cat, c) => {
    const shape = SHAPES[cat];
    const x0 = c * cell;
    mapping[cat] = { x: x0, y: 0, width: cell, height: cell, mask: true };
    for (let py = 1; py < cell - 1; py++) {
      for (let px = 1; px < cell - 1; px++) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const gx = ((px - 1 + (sx + 0.5) / SS) / inner) * 2 - 1;
            const gy = 1 - ((py - 1 + (sy + 0.5) / SS) / inner) * 2;
            if (shape(gx, gy)) hits++;
          }
        }
        if (!hits) continue;
        const o = (py * width + x0 + px) * 4;
        data[o] = 255;
        data[o + 1] = 255;
        data[o + 2] = 255;
        data[o + 3] = Math.round((hits / (SS * SS)) * 255);
      }
    }
  });
  return { width, height, data, mapping };
}
