// @vitest-environment jsdom
/**
 * Round 4 visual-qa m1/m2: the framing obstacles are the real overlay boxes — every
 * `[data-map-inset]` element plus the HUD chrome and MapLibre controls found by selector (header,
 * telemetry, rail, chips one by one, attribution, sheet, nav …), and on phones the sheet at its
 * final height while it is still sliding in. Boxes from the measured 390×844 layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPhoneLayout, measureObstacles, overlayElements } from './insets';

function box(el: Element, r: { left: number; top: number; right: number; bottom: number }) {
  el.getBoundingClientRect = () => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r }) as DOMRect;
  return el;
}

function add(html: string, r: { left: number; top: number; right: number; bottom: number } | null, parent: Element = document.body): Element {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const el = t.content.firstElementChild!;
  parent.append(el);
  if (r) box(el, r);
  return el;
}

const phone = (on: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} }));

describe('measureObstacles', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
  });
  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.style.removeProperty('--sheet-occupied');
    vi.unstubAllGlobals();
  });

  it('collects the HUD chrome, each imagery chip and the attribution, and the phone sheet at its published height', () => {
    phone(true);
    expect(isPhoneLayout()).toBe(true);
    add('<header class="fixed">GODSEYE</header>', { left: 16, top: 16, right: 185, bottom: 54 });
    add('<div aria-label="Telemetry" role="group">LIVE</div>', { left: 271, top: 16, right: 374, bottom: 31 });
    add('<div data-map-inset="view-controls">3D 2D</div>', { left: 12, top: 64, right: 320, bottom: 118 });
    const corner = add('<div class="maplibregl-ctrl-bottom-right"></div>', null);
    const chips = add('<div class="maplibregl-ctrl godseye-imagery-chips"><ul></ul></div>', { left: 5, top: 205, right: 385, bottom: 263 }, corner);
    add('<li>BASEMAP INCOMPLETE · 2 TILES MISSING · RETRYING</li>', { left: 5, top: 205, right: 385, bottom: 231 }, chips.querySelector('ul')!);
    add('<li>BLACK MARBLE 2016 · REFERENCE</li>', { left: 142, top: 237, right: 380, bottom: 263 }, chips.querySelector('ul')!);
    add('<div class="maplibregl-ctrl maplibregl-ctrl-attrib">Night lights …</div>', { left: 12, top: 273, right: 390, bottom: 320 }, corner);
    add('<nav aria-label="Main">LAYERS</nav>', { left: 0, top: 787, right: 390, bottom: 844 });
    // Not laid out (hidden status node, the desktop-only rail on a phone): skipped.
    add('<nav aria-label="Map layers"></nav>', { left: 0, top: 0, right: 0, bottom: 0 });
    document.documentElement.style.setProperty('--sheet-occupied', '520px');

    const rects = measureObstacles();
    const has = (r: { left: number; top: number; right: number; bottom: number }) => rects.some((x) => x.left === r.left && x.top === r.top && x.right === r.right && x.bottom === r.bottom);
    expect(has({ left: 16, top: 16, right: 185, bottom: 54 })).toBe(true); // header
    expect(has({ left: 271, top: 16, right: 374, bottom: 31 })).toBe(true); // telemetry
    expect(has({ left: 12, top: 64, right: 320, bottom: 118 })).toBe(true); // [data-map-inset]
    expect(has({ left: 5, top: 205, right: 385, bottom: 231 })).toBe(true); // BASEMAP chip
    expect(has({ left: 142, top: 237, right: 380, bottom: 263 })).toBe(true); // BLACK MARBLE chip
    expect(has({ left: 12, top: 273, right: 390, bottom: 320 })).toBe(true); // attribution
    expect(has({ left: 0, top: 787, right: 390, bottom: 844 })).toBe(true); // bottom nav
    expect(has({ left: 0, top: 844 - 520, right: 390, bottom: 844 })).toBe(true); // sheet at its final height
    // The chip stack's own box (as wide as its widest chip) is not an obstacle: its chips are.
    expect(has({ left: 5, top: 205, right: 385, bottom: 263 })).toBe(false);
    expect(rects).toHaveLength(8);
  });

  it('desktop: no sheet; off-screen and hidden boxes are skipped', () => {
    phone(false);
    vi.stubGlobal('innerWidth', 1600);
    vi.stubGlobal('innerHeight', 1000);
    add('<nav aria-label="Map layers"></nav>', { left: 0, top: 0, right: 48, bottom: 972 });
    add('<div data-map-inset="x" style="visibility:hidden"></div>', { left: 100, top: 100, right: 200, bottom: 200 });
    add('<div data-map-inset="y"></div>', { left: 1700, top: 100, right: 1800, bottom: 200 });
    expect(measureObstacles()).toEqual([{ left: 0, top: 0, right: 48, bottom: 972 }]);
    expect(overlayElements()).toHaveLength(3);
  });
});
