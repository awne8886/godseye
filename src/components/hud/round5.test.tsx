// @vitest-environment jsdom
/**
 * design-system-hud, Phase 3 round 5: one phone layout for JS and CSS (r1 M2), map insets on the
 * view-control status lines (r1 m1), phone touch targets (visual-qa m1/m2), the header scrim
 * (visual-qa m6), the toggle's contract spring and desktop-only panel warming (round 4 leftovers).
 * The palette (r1 M1) is in palette-route.test.ts, the card names (visual-qa m4) in
 * cards/display-name.test.tsx; the layouts themselves are measured in e2e/design-system-hud/round5.spec.ts.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ReactElement } from 'react';
import { compile } from 'tailwindcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerStatusStore } from '@/lib/layer-host';
import { PHONE_LAYOUT_QUERY } from '@/lib/map/view';
import { DEFAULT_SETTINGS, useUiStore } from '@/lib/store';
import { MOBILE_QUERY } from './hooks';
import StyleStudioPanel from './panels/StyleStudioPanel';
import { springAt, springToCss, TOGGLE_SPRING } from './spring-easing';
import ToolStrip, { shouldWarmPanels } from './ToolStrip';
import ViewControls from './ViewControls';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const baseCss = read('src/styles/base.css');
const tokensCss = read('src/styles/tokens.css');

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function mockPhone(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
}

/** Every .tsx/.ts under a directory (tests excluded). */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

/** Tailwind 4 compiled over base.css (the variant lives there), for the candidates given. */
async function tailwind(candidates: string[]): Promise<string> {
  const twDir = dirname(resolve(ROOT, 'node_modules/tailwindcss/package.json'));
  const compiler = await compile(`@import 'tailwindcss';\n${baseCss}`, {
    base: join(ROOT, 'src/styles'),
    loadStylesheet: async (id: string, base: string) => {
      const path = id === 'tailwindcss' ? join(twDir, 'index.css') : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  return compiler.build(candidates);
}

beforeEach(() => {
  useUiStore.setState({ basemap: 'dark', projection: 'globe', settings: { ...DEFAULT_SETTINGS, units: 'metric' }, splashDone: false });
  useLayerStatusStore.setState({ status: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('r1 M2: the HUD is fully phone or fully desktop (one media query for JS and CSS)', () => {
  it('declares the `phone:` variant with exactly PHONE_LAYOUT_QUERY / useIsMobile()', () => {
    expect(MOBILE_QUERY).toBe(PHONE_LAYOUT_QUERY);
    const variant = baseCss.match(/@custom-variant phone \{\s*@media ([^{]+)\{\s*@slot;/);
    expect(variant?.[1]?.trim()).toBe(PHONE_LAYOUT_QUERY);
    // Every hand-written phone block in base.css uses the same query.
    for (const m of baseCss.matchAll(/@media ([^{]*max-width: 767px[^{]*)\{/g)) expect(m[1]!.trim()).toBe(PHONE_LAYOUT_QUERY);
  });

  it('compiles `phone:` into that media query, after the width breakpoints so it wins', async () => {
    const css = await tailwind(['hidden', 'flex', 'phone:hidden', 'phone:flex', 'lg:inline', 'xl:flex', 'phone:min-h-[44px]']);
    const at = css.indexOf('.phone\\:hidden');
    expect(at).toBeGreaterThan(-1);
    const media = css.lastIndexOf('@media', at);
    expect(css.slice(media, css.indexOf('{', media))).toContain('(max-height: 499px) and (orientation: landscape)');
    expect(css.slice(media, css.indexOf('{', media))).toContain('(max-width: 767px)');
    expect(at).toBeGreaterThan(css.indexOf('.lg\\:inline'));
    expect(at).toBeGreaterThan(css.indexOf('.xl\\:flex'));
  });

  it('no HUD or card source switches layout on the `md:` width breakpoint any more', () => {
    const files = [...sources('src/components/hud'), ...sources('src/components/cards')];
    expect(files.length).toBeGreaterThan(30);
    for (const f of files) expect(read(f), f).not.toMatch(/(?:^|[\s"'`])(?:max-)?md:/m);
  });

  it('the phone chrome (nav) and the desktop chrome (rail, tools, status bar) swap on the same variant', () => {
    const cls = (file: string, marker: string) => {
      const src = read(`src/components/hud/${file}`);
      const i = src.indexOf(marker);
      expect(i, `${file}: ${marker}`).toBeGreaterThan(-1);
      return src.slice(i, src.indexOf('\n', i));
    };
    expect(cls('MobileNav.tsx', 'glass-1 fixed inset-x-0 bottom-0')).toMatch(/\bhidden\b.*\bphone:flex\b/);
    expect(cls('LayerRail.tsx', 'data-map-inset="rail"')).toMatch(/\bflex\b.*\bphone:hidden\b/);
    expect(cls('ToolStrip.tsx', 'glass-1 fixed right-2')).toMatch(/\bflex\b.*\bphone:hidden\b/);
    expect(cls('StatusBar.tsx', 'data-map-inset="status-bar"')).toMatch(/\bflex\b.*\bphone:hidden\b/);
  });
});

describe('r1 m1: the view-control status lines are map insets', () => {
  it('marks the terrain line', () => {
    act(() => {
      useUiStore.getState().setLayer('terrain_elevation', true);
      useLayerStatusStore.getState().update('terrain_elevation', { state: 'loading' });
    });
    render(<ViewControls />);
    const line = document.querySelector('[data-map-inset="terrain-line"]');
    expect(line?.getAttribute('role')).toBe('status');
    act(() => useUiStore.getState().setLayer('terrain_elevation', false));
  });

  it('marks LOCATION UNAVAILABLE', async () => {
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: (_ok: unknown, fail: () => void) => fail() } });
    render(<ViewControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Centre on my region' }));
    const status = await screen.findByText('LOCATION UNAVAILABLE');
    expect(status.getAttribute('data-map-inset')).toBe('locate-status');
  });
});

describe('visual-qa m2: Style Studio knobs are 44 px targets on phones', () => {
  it('gives every AUTO button, range input and colour row a phone 44 px hit box', async () => {
    mockPhone(true);
    render(<StyleStudioPanel onClose={() => {}} />);
    const autos = screen.getAllByRole('button', { name: 'AUTO' });
    expect(autos.length).toBe(10);
    for (const b of autos) expect(b.className).toMatch(/phone:min-h-\[44px\].*phone:min-w-\[44px\]/);
    const ranges = screen.getAllByRole('slider');
    expect(ranges.length).toBe(10);
    for (const r of ranges) expect(r.className).toContain('phone:h-11');
    for (const swatch of document.querySelectorAll('input[type="color"]')) expect(swatch.closest('label')!.className).toContain('phone:min-h-[44px]');
  });
});

describe('visual-qa m1 + m6: phone attribution targets and the header scrim (base.css)', () => {
  it('gives the credit links 44 px lines on phones only', () => {
    // The MapLibre-controls phone block (the variant declaration uses the same query first).
    const phone = baseCss.slice(baseCss.lastIndexOf(`@media ${PHONE_LAYOUT_QUERY} {`));
    expect(phone).toContain('.maplibregl-ctrl-bottom-right');
    const rule = phone.slice(phone.indexOf('.maplibregl-map .maplibregl-ctrl-attrib a {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toContain('display: inline-block');
    // 14 px line + 2 × 15 px padding = 44 px hit box; the equal negative margin keeps the line 14 px,
    // so the credits never grow over route framing or the honesty chips stacked above them.
    expect(body).toContain('padding-block: 15px');
    expect(body).toContain('margin-block: -15px');
    expect(body).toContain('line-height: 14px');
    expect(body).toContain('position: relative');
  });

  it('puts a theme-aware void scrim behind the header text, never a pointer target', () => {
    const i = baseCss.indexOf('.hud-header-scrim::before {');
    const body = baseCss.slice(i, baseCss.indexOf('}', i));
    expect(body).toContain('var(--bg-void)');
    expect(body).toContain('pointer-events: none');
    expect(body).toContain('z-index: -1');
    expect(read('src/components/hud/Header.tsx')).toContain('hud-header-scrim');
  });
});

describe('round 4 leftover: the toggle knob keeps the contract spring (500/30) in CSS', () => {
  it('pins tokens.css to the spring it stands for', () => {
    const { durationMs, easing } = springToCss(TOGGLE_SPRING);
    expect(tokensCss).toContain(`--ease-toggle-spring: ${easing};`);
    expect(tokensCss).toContain(`--dur-toggle-spring: calc(${durationMs}ms * var(--motion-scale));`);
    // A spring, not an ease: it overshoots (≈ 5.8 % for 500/30) and comes to rest at 1.
    const peak = Math.max(...Array.from({ length: 500 }, (_, i) => springAt(TOGGLE_SPRING, i / 1000)));
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.07);
    expect(easing.endsWith(', 1)')).toBe(true);
  });

  it('the knob transitions on that spring where linear() exists, and reduced motion zeroes it', () => {
    expect(baseCss).toMatch(/@supports \(transition-timing-function: linear\(0, 1\)\) \{\s*\.hud-toggle-knob \{\s*transition:\s*transform var\(--dur-toggle-spring\) var\(--ease-toggle-spring\)/);
    expect(baseCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*transition-duration: 0\.001ms !important;/);
    expect(baseCss).toMatch(/:root\[data-motion='reduced'\] \*[^{]*\{[^}]*transition-duration: 0\.001ms !important;/);
  });
});

describe('round 4 leftover: panel chunks are warmed only in the desktop layout', () => {
  it('decides from the splash and the live media query', () => {
    mockPhone(false);
    expect(shouldWarmPanels(false, false)).toBe(false);
    expect(shouldWarmPanels(true, false)).toBe(true);
    expect(shouldWarmPanels(true, true)).toBe(false);
    // The hook still says desktop (hydration) but the query already matches a phone.
    mockPhone(true);
    expect(shouldWarmPanels(true, false)).toBe(false);
  });

  it('a phone never schedules the idle warm-up, a desktop does', async () => {
    const idle = vi.fn(() => 1);
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('cancelIdleCallback', () => {});
    mockPhone(true);
    const phone = render(<ToolStrip />);
    act(() => useUiStore.setState({ splashDone: true }));
    expect(idle).not.toHaveBeenCalled();
    phone.unmount();
    act(() => useUiStore.setState({ splashDone: false }));
    mockPhone(false);
    render(<ToolStrip />);
    act(() => useUiStore.setState({ splashDone: true }));
    expect(idle).toHaveBeenCalled();
  });
});
