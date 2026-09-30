import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_TOKENS, UI_TOKENS, contrastRatio, hexToRgba } from './tokens';

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

  it('parses hex colours', () => {
    expect(hexToRgba('#d4af37')).toEqual([212, 175, 55, 255]);
    expect(hexToRgba('#fff', 0.5)).toEqual([255, 255, 255, 128]);
    expect(hexToRgba('#00000080')).toEqual([0, 0, 0, 128]);
    expect(() => hexToRgba('red')).toThrow();
  });
});
