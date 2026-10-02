import { describe, expect, it } from 'vitest';
import { SAT_CATEGORIES } from './catalog';
import { GLYPH_CELL_PX, buildGlyphAtlas } from './glyphs';

const atlas = buildGlyphAtlas();

/** Alpha of the glyph cell for category index c, row-major. */
function cellAlpha(c: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < atlas.height; y++) for (let x = 0; x < GLYPH_CELL_PX; x++) out.push(atlas.data[(y * atlas.width + c * GLYPH_CELL_PX + x) * 4 + 3]!);
  return out;
}

describe('satellite mission glyph atlas (L105)', () => {
  it('one mask cell per mission category, side by side', () => {
    expect(atlas.width).toBe(GLYPH_CELL_PX * SAT_CATEGORIES.length);
    expect(atlas.height).toBe(GLYPH_CELL_PX);
    expect(atlas.data).toHaveLength(atlas.width * atlas.height * 4);
    expect(Object.keys(atlas.mapping).sort()).toEqual([...SAT_CATEGORIES].sort());
    SAT_CATEGORIES.forEach((cat, c) => expect(atlas.mapping[cat]).toEqual({ x: c * GLYPH_CELL_PX, y: 0, width: GLYPH_CELL_PX, height: GLYPH_CELL_PX, mask: true }));
  });

  it('is white with coverage in alpha (deck.gl tints masks with the mission colour)', () => {
    for (let o = 0; o < atlas.data.length; o += 4) {
      if (atlas.data[o + 3]! === 0) expect([atlas.data[o], atlas.data[o + 1], atlas.data[o + 2]]).toEqual([0, 0, 0]);
      else expect([atlas.data[o], atlas.data[o + 1], atlas.data[o + 2]]).toEqual([255, 255, 255]);
    }
  });

  it('every glyph is visible, inside its cell (1 px margin) and anti-aliased', () => {
    SAT_CATEGORIES.forEach((cat, c) => {
      const a = cellAlpha(c);
      const covered = a.filter((v) => v > 0).length / a.length;
      expect(covered, cat).toBeGreaterThan(0.15);
      expect(covered, cat).toBeLessThan(0.8);
      expect(a.some((v) => v > 0 && v < 255), `${cat} edges`).toBe(true);
      for (let i = 0; i < GLYPH_CELL_PX; i++) {
        expect(a[i], `${cat} top`).toBe(0);
        expect(a[(GLYPH_CELL_PX - 1) * GLYPH_CELL_PX + i], `${cat} bottom`).toBe(0);
        expect(a[i * GLYPH_CELL_PX], `${cat} left`).toBe(0);
        expect(a[i * GLYPH_CELL_PX + GLYPH_CELL_PX - 1], `${cat} right`).toBe(0);
      }
    });
  });

  it('the six glyphs are distinct shapes', () => {
    const cells = SAT_CATEGORIES.map((_, c) => cellAlpha(c));
    for (let a = 0; a < cells.length; a++) {
      for (let b = a + 1; b < cells.length; b++) {
        let diff = 0;
        for (let i = 0; i < cells[a]!.length; i++) if (Math.abs(cells[a]![i]! - cells[b]![i]!) > 128) diff++;
        expect(diff, `${SAT_CATEGORIES[a]} vs ${SAT_CATEGORIES[b]}`).toBeGreaterThan(40);
      }
    }
  });

  it('the navigation triangle points up (wide base at the bottom)', () => {
    const a = cellAlpha(SAT_CATEGORIES.indexOf('navigation'));
    const rowWidth = (y: number) => a.slice(y * GLYPH_CELL_PX, (y + 1) * GLYPH_CELL_PX).filter((v) => v > 128).length;
    expect(rowWidth(26)).toBeGreaterThan(rowWidth(8) + 10);
  });

  it('is deterministic', () => {
    expect(Array.from(buildGlyphAtlas().data)).toEqual(Array.from(atlas.data));
  });
});
