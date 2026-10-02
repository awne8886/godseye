/**
 * TS mirror of the --map-* tokens in src/styles/tokens.css. deck.gl accessors need RGBA
 * arrays, and server code (e.g. mission colours) needs the same values. tokens.test.ts pins
 * this object to the CSS file. At runtime the map re-reads the live CSS variables through
 * readCssColor() so Style Studio / Ghost Protocol overrides recolour layers in place.
 */

export const MAP_TOKENS = {
  '--map-cctv': '#00e676',
  '--map-sat-comms': '#00e676',
  '--map-sat-military': '#ff3d3d',
  '--map-sat-navigation': '#448aff',
  '--map-alt-0': '#ffffff',
  '--map-alt-1': '#ffd700',
  '--map-alt-2': '#00e676',
  '--map-alt-3': '#00e5ff',
  '--map-alt-4': '#448aff',
  '--map-alt-5': '#b04cff',
  '--map-alt-6': '#ff3d3d',
  '--map-sat-earth': '#90ee90',
  '--map-sat-science': '#ffd700',
  '--map-sat-other': '#00e5ff',
  '--map-flight-civil': '#00e5ff',
  '--map-flight-private': '#ffd700',
  '--map-flight-gov': '#ff9500',
  '--map-flight-military': '#ff0000',
  '--map-flight-unknown': '#546e7a',
  '--map-flight-emergency': '#ff3d3d',
  '--map-flight-watch': '#ffb300',
  '--map-alt-low': '#ffd700',
  '--map-alt-high': '#00e5ff',
  '--map-seismic': '#e65100',
  '--map-seismic-low': '#f9a825',
  '--map-seismic-high': '#d32f2f',
  '--map-fire': '#e65100',
  '--map-weather': '#7e57c2',
  '--map-volcano': '#d32f2f',
  '--map-nuclear': '#26a69a',
  '--map-nuclear-seismic': '#e65100',
  '--map-nuclear-conflict': '#d32f2f',
  '--map-nuclear-decommissioned': '#546e7a',
  '--map-nuclear-construction': '#ffa726',
  '--map-port': '#26c6da',
  '--map-port-naval': '#d32f2f',
  '--map-port-energy': '#e65100',
  '--map-choke-critical': '#d32f2f',
  '--map-choke-high': '#e65100',
  '--map-choke-elevated': '#f9a825',
  '--map-choke-low': '#26a69a',
  '--map-ship-military': '#d32f2f',
  '--map-ship-tanker': '#e65100',
  '--map-ship-cargo': '#26c6da',
  '--map-ship-other': '#b0bec5',
  '--map-news': '#ec407a',
  '--map-malware': '#d32f2f',
  '--map-malware-ring': '#ff1744',
  '--map-c2-online': '#ff6d00',
  '--map-c2-offline': '#555555',
  '--map-gdelt-1': '#00e676',
  '--map-gdelt-2': '#00e5ff',
  '--map-gdelt-3': '#ff9500',
  '--map-gdelt-4': '#ff3d3d',
  '--map-outage': '#ffb300',
  '--map-outage-resolved': '#8b7325',
  '--map-attack': '#ff3d3d',
  '--map-alert-rocket': '#ff3d3d',
  '--map-alert-event': '#ff9500',
  '--map-alert-news': '#00e5ff',
  '--map-incident': '#d32f2f',
  '--map-conflict': '#d32f2f',
  '--map-risk': '#e65100',
  '--map-cable': '#1976d2',
  '--map-gps-jam': '#ff9500',
  '--map-air-quality': '#9ccc65',
  '--map-night': '#000022',
  '--map-directions': '#00e5ff',
  '--map-directions-casing': '#001014',
  '--map-directions-active': '#d4af37',
  '--map-draw': '#d4af37',
  '--map-arcgis': '#00e5ff',
  '--map-airport-watch': '#ffb300',
  '--map-route-planned': '#d4af37',
  '--map-route-filed': '#00e5ff',
  '--map-route-airways': '#448aff',
} as const;

export type MapToken = keyof typeof MAP_TOKENS;

/** Core UI colours used by non-CSS renderers (canvas, charts). */
export const UI_TOKENS = {
  '--bg-void': '#04040a',
  '--bg-primary': '#06060c',
  '--bg-secondary': '#0c0e1a',
  '--bg-tertiary': '#121628',
  '--gold-primary': '#d4af37',
  '--cyan-primary': '#00e5ff',
  '--text-primary': '#e8e6e0',
  '--text-secondary': '#9b978e',
  '--text-muted': '#848178',
  '--up': '#00e676',
  '--down': '#ff3d3d',
} as const;

export type Rgba = [number, number, number, number];

/** `#rgb`, `#rrggbb` or `#rrggbbaa` → [r, g, b, a] with a in 0–255. */
export function hexToRgba(hex: string, alpha = 1): Rgba {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) throw new Error(`Not a hex colour: ${hex}`);
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  const a = h.length === 8 ? n(6) : Math.round(alpha * 255);
  return [n(0), n(2), n(4), a];
}

/** Parse `#hex`, `rgb()`/`rgba()` (comma or space syntax). Returns null for anything else. */
export function parseCssColor(raw: string, alpha = 1): Rgba | null {
  const v = raw.trim();
  if (v.startsWith('#')) {
    try {
      return hexToRgba(v, alpha);
    } catch {
      return null;
    }
  }
  const m = v.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i);
  return m ? [Math.round(Number(m[1])), Math.round(Number(m[2])), Math.round(Number(m[3])), Math.round(alpha * 255)] : null;
}

let probe: CanvasRenderingContext2D | null | undefined;

/** Resolve any CSS colour (named, hsl(), oklch()…) through a 1×1 canvas; null when unsupported. */
function resolveViaCanvas(raw: string, alpha: number): Rgba | null {
  if (probe === undefined) {
    try {
      probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    } catch {
      probe = null;
    }
  }
  if (!probe) return null;
  probe.fillStyle = '#000';
  probe.fillStyle = raw;
  const normalised = String(probe.fillStyle);
  if (normalised === '#000000' && !/^(#000|#000000|black|rgb\(0,\s*0,\s*0\))$/i.test(raw)) return null;
  return parseCssColor(normalised, alpha);
}

/**
 * Read a CSS colour variable from the document and return RGBA. Falls back to the token
 * default on the server or when the variable is not a parseable colour. Style Studio may set
 * any CSS colour syntax, so non-hex/rgb values are normalised through a canvas probe.
 */
export function readCssColor(token: MapToken, alpha = 1, el?: Element): Rgba {
  const fallback = hexToRgba(MAP_TOKENS[token], alpha);
  if (typeof window === 'undefined') return fallback;
  const target = el ?? document.documentElement;
  const raw = getComputedStyle(target).getPropertyValue(token).trim();
  if (!raw) return fallback;
  return parseCssColor(raw, alpha) ?? resolveViaCanvas(raw, alpha) ?? fallback;
}

const HUD_FONT_FALLBACK = "'JetBrains Mono', ui-monospace, monospace";

/**
 * The HUD monospace stack for canvas/deck text (`ctx.font`, TextLayer `fontFamily`). The bundled
 * font is registered under a generated family name (next/font/local), so read the resolved
 * `--font-hud` instead of naming "JetBrains Mono", which no @font-face declares.
 */
export function hudFontFamily(el?: Element): string {
  if (typeof window === 'undefined') return HUD_FONT_FALLBACK;
  return getComputedStyle(el ?? document.documentElement).getPropertyValue('--font-hud').trim() || HUD_FONT_FALLBACK;
}

/** Composite a translucent colour over an opaque background (for contrast checks on glass). */
export function compositeOver(fg: Rgba, bgHex: string): string {
  const bg = hexToRgba(bgHex);
  const a = fg[3] / 255;
  const mix = (i: number) => Math.round(fg[i]! * a + bg[i]! * (1 - a));
  return `#${[0, 1, 2].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG 2 relative-luminance contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = hexToRgba(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as Rgba;
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
