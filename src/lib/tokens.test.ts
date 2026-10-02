import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_TOKENS, UI_TOKENS, compositeOver, contrastRatio, hexToRgba, parseCssColor } from './tokens';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
const cssVar = (name: string) => css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`))?.[1]?.toLowerCase();

describe('design tokens', () => {
  it('mirrors every --map-* token in tokens.css exactly', () => {
    for (const [name, value] of Object.entries(MAP_TOKENS)) expect(cssVar(name), name).toBe(value);
    const cssNames = [...css.matchAll(/(--map-[a-z0-9-]+):/g)].map((m) => m[1]);
    expect(new Set(cssNames)).toEqual(new Set(Object.keys(MAP_TOKENS)));
  });

  it('keeps the HORUS core palette from §7', () => {
    expect(cssVar('--bg-void')).toBe('#04040a');
    expect(cssVar('--gold-primary')).toBe('#d4af37');
    expect(cssVar('--cyan-primary')).toBe('#00e5ff');
    for (const [name, value] of Object.entries(UI_TOKENS)) expect(cssVar(name), name).toBe(value);
  });

  it('muted and secondary text pass WCAG AA (4.5:1) on the primary background', () => {
    expect(contrastRatio(UI_TOKENS['--text-muted'], UI_TOKENS['--bg-primary'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI_TOKENS['--text-secondary'], UI_TOKENS['--bg-primary'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI_TOKENS['--gold-primary'], UI_TOKENS['--bg-primary'])).toBeGreaterThan(9);
  });

  it('muted text passes 4.5:1 on the tertiary surface and on the glass panel over the void', () => {
    const muted = UI_TOKENS['--text-muted'];
    expect(contrastRatio(muted, UI_TOKENS['--bg-tertiary'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted, UI_TOKENS['--bg-secondary'])).toBeGreaterThanOrEqual(4.5);
    const panel = css.match(/--bg-panel:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    expect(panel).not.toBeNull();
    const [, r, g, b, a] = panel!;
    const glass = compositeOver([Number(r), Number(g), Number(b), Math.round(Number(a) * 255)], UI_TOKENS['--bg-void']);
    expect(contrastRatio(muted, glass)).toBeGreaterThanOrEqual(4.5);
    // Worst realistic backdrop: glass over the brightest basemap land colour.
    expect(contrastRatio(muted, compositeOver([Number(r), Number(g), Number(b), Math.round(Number(a) * 255)], '#1c2233'))).toBeGreaterThanOrEqual(4.5);
  });

  it('parses rgb()/rgba() in comma and space syntax', () => {
    expect(parseCssColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 255]);
    expect(parseCssColor('rgba(10 20 30 / 0.5)', 0.5)).toEqual([10, 20, 30, 128]);
    expect(parseCssColor('#fff')).toEqual([255, 255, 255, 255]);
    expect(parseCssColor('tomato')).toBeNull();
  });

  it('parses hex colours', () => {
    expect(hexToRgba('#d4af37')).toEqual([212, 175, 55, 255]);
    expect(hexToRgba('#fff', 0.5)).toEqual([255, 255, 255, 128]);
    expect(hexToRgba('#00000080')).toEqual([0, 0, 0, 128]);
    expect(() => hexToRgba('red')).toThrow();
  });
});
