/**
 * Style Studio token engine (pure, isomorphic). Presets are static `:root[data-theme=…]` blocks in
 * src/styles/tokens.css (so the pre-paint boot script can apply them); `presetVars()` derives the
 * same values and a unit test pins the CSS to it. Custom edits are applied as inline custom
 * properties on <html>; every knob is a CSS variable, so no stylesheet text is ever generated from
 * user input. Imported JSON is sanitised: known keys only, colours must match HEX_RE, numbers are
 * clamped. Owner: design-system-hud.
 */
import { MAP_TOKENS, compositeOver, contrastRatio, hexToRgba, type MapToken } from '@/lib/tokens';

export const STUDIO_STORAGE_KEY = 'godseye:style-studio';
/** Window event fired after any theme/studio/ghost change so the map re-reads --map-* colours. */
export const STYLE_EVENT = 'godseye:style';

export const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export interface Palette {
  accent: string;
  accent2: string;
  bg: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textHeading: string;
  glow: number;
  scanlines?: number;
  grain?: number;
  vignette?: number;
  /** Hand-tuned light/dim variants (HORUS keeps the §7 values instead of derived ones). */
  accentLight?: string;
  accentDim?: string;
  accent2Dim?: string;
  panelRgb?: string;
}

export const PRESET_IDS = ['HORUS', 'PHANTOM', 'TERMINAL', 'CRIMSON', 'ARCTIC', 'BLACKOUT', 'EMBER', 'MONO', 'NVG'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/**
 * The six OSIRIS presets (docs/reference/12 §2) with GODSEYE's researched muted/secondary fixes
 * (each passes 4.5:1 on its glass panel and tertiary surface), plus EMBER, MONO and NVG.
 */
export const PRESETS: Record<PresetId, Palette> = {
  HORUS: {
    accent: '#d4af37', accent2: '#00e5ff', bg: '#04040a', bgPrimary: '#06060c', bgSecondary: '#0c0e1a', bgTertiary: '#121628',
    textPrimary: '#e8e6e0', textSecondary: '#9b978e', textMuted: '#848178', textHeading: '#f5f0e0', glow: 0.3,
    accentLight: '#f0d060', accentDim: '#8b7325', accent2Dim: '#006b7a', panelRgb: '8, 10, 20',
  },
  PHANTOM: {
    accent: '#b388ff', accent2: '#8f66ff', bg: '#05000f', bgPrimary: '#08001a', bgSecondary: '#0d0025', bgTertiary: '#140033',
    textPrimary: '#e1bee7', textSecondary: '#9575cd', textMuted: '#8b6cc0', textHeading: '#b388ff', glow: 0.35,
  },
  TERMINAL: {
    accent: '#00ff9c', accent2: '#00b36b', bg: '#000a06', bgPrimary: '#001410', bgSecondary: '#00201a', bgTertiary: '#002d24',
    textPrimary: '#c8ffe4', textSecondary: '#5fbf95', textMuted: '#4c9e7b', textHeading: '#7dffc4', glow: 0.4, scanlines: 0.05,
  },
  CRIMSON: {
    accent: '#ff4d5a', accent2: '#ff9500', bg: '#0c0204', bgPrimary: '#140407', bgSecondary: '#1e070b', bgTertiary: '#2a0a10',
    textPrimary: '#ffd9dd', textSecondary: '#c98089', textMuted: '#b06d75', textHeading: '#ff8f97', glow: 0.35,
  },
  ARCTIC: {
    accent: '#8fd3ff', accent2: '#4fc3f7', bg: '#04080f', bgPrimary: '#070d18', bgSecondary: '#0b1524', bgTertiary: '#101f33',
    textPrimary: '#e3f2fd', textSecondary: '#90a4b8', textMuted: '#76899d', textHeading: '#c9e7ff', glow: 0.25,
  },
  BLACKOUT: {
    accent: '#9e9e9e', accent2: '#8a8a8a', bg: '#000000', bgPrimary: '#070707', bgSecondary: '#0e0e0e', bgTertiary: '#161616',
    textPrimary: '#e0e0e0', textSecondary: '#a0a0a0', textMuted: '#828282', textHeading: '#f0f0f0', glow: 0.08,
  },
  EMBER: {
    accent: '#ff8a3d', accent2: '#ffcf5c', bg: '#0b0503', bgPrimary: '#130904', bgSecondary: '#1d0f07', bgTertiary: '#29160b',
    textPrimary: '#ffe6d1', textSecondary: '#d1a483', textMuted: '#ad8266', textHeading: '#ffc38a', glow: 0.35,
  },
  MONO: {
    accent: '#ffffff', accent2: '#c7c7c7', bg: '#050505', bgPrimary: '#0b0b0b', bgSecondary: '#141414', bgTertiary: '#1e1e1e',
    textPrimary: '#f2f2f2', textSecondary: '#b3b3b3', textMuted: '#8f8f8f', textHeading: '#ffffff', glow: 0,
  },
  NVG: {
    accent: '#8dff4f', accent2: '#3dffa2', bg: '#010601', bgPrimary: '#030d03', bgSecondary: '#061706', bgTertiary: '#0a220a',
    textPrimary: '#dcffc9', textSecondary: '#94d27c', textMuted: '#6fae5c', textHeading: '#b6ff8c', glow: 0.45, scanlines: 0.04, grain: 0.12, vignette: 0.5,
  },
};

/** Ghost Protocol (applied last, over any preset): violet palette with readable muted text. */
export const GHOST: Palette = {
  accent: '#b388ff', accent2: '#8f66ff', bg: '#05000f', bgPrimary: '#08001a', bgSecondary: '#0d0025', bgTertiary: '#140033',
  textPrimary: '#e1bee7', textSecondary: '#a88fdc', textMuted: '#8c6ac6', textHeading: '#b388ff', glow: 0.3,
  accentLight: '#d1c4e9', accentDim: '#6a1b9a', panelRgb: '8, 0, 26',
};

/** Signal colours are shared by every preset (they carry meaning). */
export const SIGNAL_DEFAULTS: Record<'alertRed' | 'alertOrange' | 'alertGreen' | 'alertBlue', string> = {
  alertRed: '#ff3d3d',
  alertOrange: '#ff9500',
  alertGreen: '#00e676',
  alertBlue: '#448aff',
};

export const PANEL_ALPHA = 0.88;
export const BORDER_ALPHA = 0.15;

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === 'string' && (PRESET_IDS as readonly string[]).includes(v);
}

// ── colour helpers ───────────────────────────────────────────────────────────
function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/** Normalise `#rgb`/`#rrggbb` (and strip a `#rrggbbaa` alpha) to lower-case `#rrggbb`; null if invalid. */
export function normHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (/^#[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 7);
  if (/^#[0-9a-f]{4}$/i.test(s)) s = s.slice(0, 4);
  if (!HEX_RE.test(s)) return null;
  const [r, g, b] = hexToRgba(s);
  return toHex(r, g, b);
}

/** Lerp toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgba(hex);
  const t = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  return toHex(r + (t - r) * a, g + (t - g) * a, b + (t - b) * a);
}

export function rgbList(hex: string): string {
  const [r, g, b] = hexToRgba(hex);
  return `${r}, ${g}, ${b}`;
}

export function rgba(hex: string, a: number): string {
  return `rgba(${rgbList(hex)}, ${Number(a.toFixed(3))})`;
}

/** The core custom properties a palette sets (the static theme blocks in tokens.css mirror this). */
export function presetVars(p: Palette): Record<string, string> {
  const vars: Record<string, string> = {
    '--gold-rgb': rgbList(p.accent),
    '--cyan-rgb': rgbList(p.accent2),
    '--panel-rgb': p.panelRgb ?? rgbList(p.bgPrimary),
    '--bg-void': p.bg,
    '--bg-primary': p.bgPrimary,
    '--bg-secondary': p.bgSecondary,
    '--bg-tertiary': p.bgTertiary,
    '--bg-panel-solid': p.bgSecondary,
    '--gold-primary': p.accent,
    '--gold-light': p.accentLight ?? shade(p.accent, 0.35),
    '--gold-dim': p.accentDim ?? shade(p.accent, -0.45),
    '--cyan-primary': p.accent2,
    '--cyan-dim': p.accent2Dim ?? shade(p.accent2, -0.5),
    '--text-primary': p.textPrimary,
    '--text-secondary': p.textSecondary,
    '--text-muted': p.textMuted,
    '--text-heading': p.textHeading,
    '--glow': String(p.glow),
    '--fx-scanlines': String(p.scanlines ?? 0),
    '--fx-grain': String(p.grain ?? 0),
    '--fx-vignette': String(p.vignette ?? 0),
  };
  return vars;
}

/** Glass panel colour as seen over the void (for contrast checks). */
export function panelSurface(p: Palette, alpha = PANEL_ALPHA): string {
  const [r, g, b] = (p.panelRgb ?? rgbList(p.bgPrimary)).split(',').map((s) => Number(s.trim())) as [number, number, number];
  return compositeOver([r, g, b, Math.round(alpha * 255)], p.bg);
}

export interface ContrastRow {
  label: string;
  ratio: number;
  pass: boolean;
}

/** Text-on-surface contrast for a palette (live readout + unit test). */
export function paletteContrast(p: Palette, alpha = PANEL_ALPHA): ContrastRow[] {
  const glass = panelSurface(p, alpha);
  const rows: [string, string, string][] = [
    ['PRIMARY / PANEL', p.textPrimary, glass],
    ['SECONDARY / PANEL', p.textSecondary, glass],
    ['MUTED / PANEL', p.textMuted, glass],
    ['SECONDARY / TERTIARY', p.textSecondary, p.bgTertiary],
    ['MUTED / TERTIARY', p.textMuted, p.bgTertiary],
  ];
  return rows.map(([label, fg, bg]) => {
    const ratio = contrastRatio(fg, bg);
    return { label, ratio, pass: ratio >= 4.5 };
  });
}

// ── Studio settings (custom edits over the active preset) ────────────────────
export const COLOUR_KEYS = ['accent', 'accent2', 'alertRed', 'alertOrange', 'alertGreen', 'alertBlue', 'bg', 'textPrimary', 'textSecondary', 'textMuted', 'textHeading'] as const;
export type ColourKey = (typeof COLOUR_KEYS)[number];

export const KNOBS = {
  panelAlpha: { min: 0.2, max: 1, step: 0.01, label: 'PANEL' },
  borderAlpha: { min: 0, max: 0.6, step: 0.01, label: 'BORDER' },
  glow: { min: 0, max: 1, step: 0.01, label: 'GLOW' },
  blur: { min: 0, max: 64, step: 1, label: 'BLUR' },
  radius: { min: 0, max: 2.5, step: 0.05, label: 'RADIUS' },
  tracking: { min: -0.05, max: 0.4, step: 0.005, label: 'TRACKING' },
  motion: { min: 0, max: 2, step: 0.05, label: 'MOTION' },
  scanlines: { min: 0, max: 0.2, step: 0.005, label: 'SCANLINES' },
  grain: { min: 0, max: 0.3, step: 0.005, label: 'GRAIN' },
  vignette: { min: 0, max: 1, step: 0.01, label: 'VIGNETTE' },
} as const;
export type KnobKey = keyof typeof KNOBS;

export interface StudioSettings {
  /** Custom colours over the preset (absent = the preset's value). */
  colours: Partial<Record<ColourKey, string>>;
  /** Per-class map colours (absent = token default). */
  map: Partial<Record<MapToken, string>>;
  /** Knobs; absent = AUTO (the preset's own value). */
  knobs: Partial<Record<KnobKey, number>>;
}

export const EMPTY_STUDIO: StudioSettings = { colours: {}, map: {}, knobs: {} };

export function isEmptyStudio(s: StudioSettings): boolean {
  return !Object.keys(s.colours).length && !Object.keys(s.map).length && !Object.keys(s.knobs).length;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Sanitise stored or pasted JSON: known keys only, hex colours only, clamped finite numbers. */
export function sanitizeStudio(raw: unknown): StudioSettings {
  const out: StudioSettings = { colours: {}, map: {}, knobs: {} };
  if (!isRecord(raw)) return out;
  if (isRecord(raw.colours)) {
    for (const k of COLOUR_KEYS) {
      const v = normHex(raw.colours[k]);
      if (v) out.colours[k] = v;
    }
  }
  if (isRecord(raw.map)) {
    for (const k of Object.keys(MAP_TOKENS) as MapToken[]) {
      const v = normHex(raw.map[k]);
      if (v) out.map[k] = v;
    }
  }
  if (isRecord(raw.knobs)) {
    for (const [k, spec] of Object.entries(KNOBS) as [KnobKey, (typeof KNOBS)[KnobKey]][]) {
      const v = raw.knobs[k];
      if (typeof v === 'number' && Number.isFinite(v)) out.knobs[k] = Number(clamp(v, spec.min, spec.max).toFixed(3));
    }
  }
  return out;
}

/** Parse clipboard/file text; throws a readable error for non-JSON. */
export function parseStudioJson(text: string): { theme: PresetId | null; settings: StudioSettings } {
  if (text.length > 20_000) throw new Error('Theme JSON is too large');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON');
  }
  const theme = isRecord(raw) && isPresetId(raw.theme) ? raw.theme : null;
  return { theme, settings: sanitizeStudio(raw) };
}

export function exportStudioJson(theme: string, s: StudioSettings): string {
  return JSON.stringify({ app: 'godseye', version: 1, theme, colours: s.colours, map: s.map, knobs: s.knobs }, null, 2);
}

/**
 * The inline custom properties for a studio state. Colour keys derive their families (light/dim,
 * rgb, borders, glow) like the preset blocks do. `ghost` skips colour overrides so Ghost Protocol
 * stays on top; knobs still apply.
 */
export function studioVars(s: StudioSettings, opts: { ghost?: boolean } = {}): Record<string, string> {
  const v: Record<string, string> = {};
  const c = s.colours;
  if (!opts.ghost) {
    if (c.accent) {
      v['--gold-primary'] = c.accent;
      v['--gold-rgb'] = rgbList(c.accent);
      v['--gold-light'] = shade(c.accent, 0.35);
      v['--gold-dim'] = shade(c.accent, -0.45);
    }
    if (c.accent2) {
      v['--cyan-primary'] = c.accent2;
      v['--cyan-rgb'] = rgbList(c.accent2);
      v['--cyan-dim'] = shade(c.accent2, -0.5);
    }
    if (c.alertRed) v['--alert-red'] = c.alertRed;
    if (c.alertOrange) v['--alert-orange'] = c.alertOrange;
    if (c.alertGreen) v['--alert-green'] = c.alertGreen;
    if (c.alertBlue) v['--alert-blue'] = c.alertBlue;
    if (c.bg) {
      v['--bg-void'] = c.bg;
      v['--bg-primary'] = shade(c.bg, 0.03);
      v['--bg-secondary'] = shade(c.bg, 0.07);
      v['--bg-tertiary'] = shade(c.bg, 0.12);
      v['--bg-panel-solid'] = shade(c.bg, 0.07);
      v['--panel-rgb'] = rgbList(shade(c.bg, 0.03));
    }
    if (c.textPrimary) v['--text-primary'] = c.textPrimary;
    if (c.textSecondary) v['--text-secondary'] = c.textSecondary;
    if (c.textMuted) v['--text-muted'] = c.textMuted;
    if (c.textHeading) v['--text-heading'] = c.textHeading;
    for (const [k, hex] of Object.entries(s.map)) if (hex) v[k] = hex;
  }
  const k = s.knobs;
  if (k.panelAlpha !== undefined) v['--panel-alpha'] = String(k.panelAlpha);
  if (k.borderAlpha !== undefined) v['--border-alpha'] = String(k.borderAlpha);
  if (k.glow !== undefined) v['--glow'] = String(k.glow);
  if (k.blur !== undefined) v['--blur'] = `${k.blur}px`;
  if (k.radius !== undefined) v['--radius-scale'] = String(k.radius);
  if (k.tracking !== undefined) v['--hud-tracking'] = `${k.tracking}em`;
  if (k.motion !== undefined) v['--motion-scale'] = String(k.motion);
  if (k.scanlines !== undefined) v['--fx-scanlines'] = String(k.scanlines);
  if (k.grain !== undefined) v['--fx-grain'] = String(k.grain);
  if (k.vignette !== undefined) v['--fx-vignette'] = String(k.vignette);
  return v;
}

/** Every property studioVars can ever set (Reset removes these). */
export const STUDIO_VAR_NAMES: readonly string[] = Object.keys(
  studioVars({
    colours: Object.fromEntries(COLOUR_KEYS.map((k) => [k, '#000000'])),
    map: Object.fromEntries(Object.keys(MAP_TOKENS).map((k) => [k, '#000000'])),
    knobs: Object.fromEntries(Object.keys(KNOBS).map((k) => [k, 0])),
  }),
);

/** The effective palette of a preset after studio colour edits (for the contrast readout). */
export function effectivePalette(theme: PresetId, ghost: boolean, s: StudioSettings): Palette {
  const base = ghost ? GHOST : PRESETS[theme];
  if (ghost) return base;
  const c = s.colours;
  const bg = c.bg;
  return {
    ...base,
    accent: c.accent ?? base.accent,
    accent2: c.accent2 ?? base.accent2,
    bg: bg ?? base.bg,
    bgPrimary: bg ? shade(bg, 0.03) : base.bgPrimary,
    bgSecondary: bg ? shade(bg, 0.07) : base.bgSecondary,
    bgTertiary: bg ? shade(bg, 0.12) : base.bgTertiary,
    panelRgb: bg ? rgbList(shade(bg, 0.03)) : base.panelRgb,
    textPrimary: c.textPrimary ?? base.textPrimary,
    textSecondary: c.textSecondary ?? base.textSecondary,
    textMuted: c.textMuted ?? base.textMuted,
    textHeading: c.textHeading ?? base.textHeading,
  };
}
