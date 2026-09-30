import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/tokens';
import {
  GHOST, PRESETS, PRESET_IDS, STUDIO_VAR_NAMES, effectivePalette, exportStudioJson, isEmptyStudio, normHex, paletteContrast,
  parseStudioJson, presetVars, sanitizeStudio, shade, studioVars,
} from './style-engine';

const css = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8');

function block(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, selector).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
}

describe('preset contrast (every preset passes WCAG AA for secondary and muted text)', () => {
  for (const id of PRESET_IDS) {
    it(id, () => {
      for (const row of paletteContrast(PRESETS[id])) expect(row.ratio, `${id} ${row.label}`).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('GHOST', () => {
    for (const row of paletteContrast(GHOST)) expect(row.ratio, `GHOST ${row.label}`).toBeGreaterThanOrEqual(4.5);
  });
  it('accent text stays readable on each preset panel', () => {
    for (const id of PRESET_IDS) expect(contrastRatio(PRESETS[id].accent, PRESETS[id].bgTertiary), id).toBeGreaterThanOrEqual(4.5);
  });
});

describe('static theme blocks mirror presetVars()', () => {
  for (const id of PRESET_IDS.filter((p) => p !== 'HORUS')) {
    it(id, () => {
      const b = block(`:root[data-theme='${id}']`);
      for (const [k, v] of Object.entries(presetVars(PRESETS[id]))) expect(b, `${id} ${k}`).toContain(`${k}: ${v};`);
    });
  }
  it('HORUS values live on :root', () => {
    const b = block(':root');
    for (const [k, v] of Object.entries(presetVars(PRESETS.HORUS))) expect(b, k).toContain(`${k}: ${v};`);
  });
  it('Ghost Protocol is declared after every preset (applied last)', () => {
    const ghost = css.indexOf(':root[data-ghost] {');
    for (const id of PRESET_IDS.filter((p) => p !== 'HORUS')) expect(css.indexOf(`:root[data-theme='${id}']`)).toBeLessThan(ghost);
    const b = block(':root[data-ghost]');
    for (const [k, v] of Object.entries(presetVars(GHOST))) expect(b, k).toContain(`${k}: ${v};`);
  });
});

describe('sanitizeStudio (hostile JSON)', () => {
  it('drops unknown keys, invalid colours and CSS injection attempts', () => {
    const s = sanitizeStudio({
      colours: { accent: 'red;} body{display:none', accent2: '#ABC', textMuted: 'url(javascript:alert(1))', evil: '#ffffff' },
      map: { '--map-cctv': '#00ff00', '--not-a-token': '#ffffff', '--map-fire': 'expression(alert(1))' },
      knobs: { blur: 9999, radius: -5, motion: Number.NaN, scanlines: '0.1', grain: 0.1, bogus: 3 },
      __proto__: { polluted: true },
    });
    expect(s.colours).toEqual({ accent2: '#aabbcc' });
    expect(s.map).toEqual({ '--map-cctv': '#00ff00' });
    expect(s.knobs).toEqual({ blur: 64, radius: 0, grain: 0.1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('returns an empty studio for non-objects', () => {
    for (const v of [null, 42, 'x', [1, 2], undefined]) expect(isEmptyStudio(sanitizeStudio(v))).toBe(true);
  });
  it('parses exported JSON round-trip and validates the theme id', () => {
    const s = sanitizeStudio({ colours: { accent: '#ff8800' }, knobs: { glow: 0.5 } });
    const back = parseStudioJson(exportStudioJson('EMBER', s));
    expect(back.theme).toBe('EMBER');
    expect(back.settings).toEqual(s);
    expect(parseStudioJson('{"theme":"<script>"}').theme).toBeNull();
    expect(() => parseStudioJson('not json')).toThrow(/JSON/);
    expect(() => parseStudioJson(' '.repeat(20_001))).toThrow(/large/);
  });
  it('normHex strips alpha suffixes and rejects named colours', () => {
    expect(normHex('#D4AF3780')).toBe('#d4af37');
    expect(normHex('#fff8')).toBe('#ffffff');
    expect(normHex('red')).toBeNull();
    expect(normHex(12)).toBeNull();
  });
});

describe('studioVars', () => {
  it('derives the accent family and formats knobs as plain numbers/units', () => {
    const v = studioVars({ colours: { accent: '#ff8800' }, map: {}, knobs: { blur: 12, tracking: 0.1, motion: 0 } });
    expect(v['--gold-rgb']).toBe('255, 136, 0');
    expect(v['--gold-light']).toBe(shade('#ff8800', 0.35));
    expect(v['--blur']).toBe('12px');
    expect(v['--hud-tracking']).toBe('0.1em');
    expect(v['--motion-scale']).toBe('0');
  });
  it('Ghost Protocol suppresses colour overrides but keeps knobs', () => {
    const v = studioVars({ colours: { accent: '#ff8800' }, map: { '--map-cctv': '#123456' }, knobs: { grain: 0.1 } }, { ghost: true });
    expect(v['--gold-primary']).toBeUndefined();
    expect(v['--map-cctv']).toBeUndefined();
    expect(v['--fx-grain']).toBe('0.1');
  });
  it('lists every property for Reset', () => {
    expect(STUDIO_VAR_NAMES).toContain('--gold-primary');
    expect(STUDIO_VAR_NAMES).toContain('--map-cctv');
    expect(STUDIO_VAR_NAMES).toContain('--fx-vignette');
  });
  it('effectivePalette reflects edits and ghost', () => {
    expect(effectivePalette('HORUS', false, { colours: { textMuted: '#ffffff' }, map: {}, knobs: {} }).textMuted).toBe('#ffffff');
    expect(effectivePalette('HORUS', true, { colours: { textMuted: '#ffffff' }, map: {}, knobs: {} }).textMuted).toBe(GHOST.textMuted);
  });
});
