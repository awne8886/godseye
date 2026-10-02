// @vitest-environment jsdom
/**
 * design-system-hud, Phase 3 round 6: layer flyouts clamped above the status bar and stacked above
 * the view strip (M), the sensor chip as a tap-to-clear control placed clear of the wordmark (m),
 * one chrome row on phone sheets (m) and the FAA airways map token. The layouts themselves are
 * measured in e2e/design-system-hud/round6.spec.ts.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AnimatePresence, LazyMotion, domMax } from 'motion/react';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { ReactNode } from 'react';
import { compile } from 'tailwindcss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '@/lib/store';
import LayerRail, { FLYOUT_TOP_PX, flyoutPlacement } from './LayerRail';
import { useHudStore } from './hud-store';
import Overlays from './Overlays';
import { MobileSheetBody } from './PanelHost';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  act(() => {
    useUiStore.getState().setSensor('none');
    useUiStore.getState().setOpenPanel(null);
  });
});

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return (
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax}>{children}</LazyMotion>
    </QueryClientProvider>
  );
}

const zIndex = (name: string) => Number(read('src/styles/tokens.css').match(new RegExp(`${name}:\\s*(\\d+)`))?.[1]);

describe('r6 M: desktop layer flyouts fit the viewport', () => {
  // 1600x1000: status bar top at 972, so flyouts end at 964.
  const top = FLYOUT_TOP_PX;
  const bottom = 964;

  it('stays level with its button when the content fits below it', () => {
    expect(flyoutPlacement(200, 300, top, bottom)).toEqual({ offset: 0, maxHeight: 764 });
  });

  it('moves up just enough for a tall group to end above the status bar', () => {
    const p = flyoutPlacement(500, 700, top, bottom);
    expect(500 + p.offset + 700).toBe(bottom);
    expect(p.offset).toBe(-236);
  });

  it('fills first-button..status bar and scrolls when the group is taller than the viewport', () => {
    const p = flyoutPlacement(600, 1400, top, bottom);
    expect(600 + p.offset).toBe(top);
    expect(p.maxHeight).toBe(bottom - top);
  });

  it('never rises over the wordmark, even on a very short window', () => {
    const p = flyoutPlacement(140, 900, top, 300);
    expect(140 + p.offset).toBe(top);
    expect(p.maxHeight).toBe(300 - top);
    expect(flyoutPlacement(140, 900, top, 50).maxHeight).toBe(0);
  });

  it('renders the flyout above the view strip and status bar with a scrolling list', () => {
    render(
      <Providers>
        <LayerRail />
      </Providers>,
    );
    const nav = screen.getByRole('navigation', { name: 'Map layers' });
    // The rail must not be a stacking context, or its z-index caps every flyout inside it.
    expect(nav.className).not.toMatch(/\bfixed\b|\bz-\[|glass/);
    expect(nav.querySelector('[data-rail-bg]')?.className).toMatch(/glass-rail.*z-\[var\(--z-rail\)\]/);
    const btn = nav.querySelector<HTMLButtonElement>('button[aria-controls^="flyout-"]')!;
    fireEvent.click(btn);
    const flyout = document.getElementById(btn.getAttribute('aria-controls')!)!;
    expect(flyout).not.toBeNull();
    expect(flyout.className).toContain('z-[var(--z-docked)]');
    expect(zIndex('--z-docked')).toBeGreaterThan(zIndex('--z-hud'));
    expect(zIndex('--z-docked')).toBeGreaterThan(zIndex('--z-status'));
    expect(flyout.style.maxHeight).not.toBe('');
    expect(flyout.querySelector('[data-flyout-list]')?.className).toMatch(/overflow-y-auto/);
    // Still next to its button: DOM (and tab) order is button -> flyout.
    expect(btn.parentElement?.contains(flyout)).toBe(true);
    act(() => useHudStore.getState().setPinnedFlyout(null));
  });
});

describe('r6 m: the sensor chip clears on touch', () => {
  it('is a button that clears the sensor mode', () => {
    act(() => useUiStore.getState().setSensor('nvg'));
    render(<Overlays />);
    const chip = screen.getByTestId('sensor-chip');
    expect(chip.textContent).toContain('SENSOR · NVG');
    const clear = chip.querySelector('button')!;
    expect(clear.textContent).toContain('TAP TO CLEAR');
    fireEvent.click(clear);
    expect(useUiStore.getState().sensor).toBe('none');
    expect(screen.queryByTestId('sensor-chip')).toBeNull();
  });

  it('sits under the view bar on phones and swaps its wording for touch', async () => {
    act(() => useUiStore.getState().setSensor('flir'));
    render(<Overlays />);
    const chip = screen.getByTestId('sensor-chip');
    expect(chip.className).toMatch(/phone:top-\[calc\(env\(safe-area-inset-top\)\+124px\)\]/);
    const [desk, touch] = [...chip.querySelectorAll('button > span')];
    expect(desk!.className).toMatch(/pointer-coarse:hidden.*phone:hidden/);
    expect(touch!.className).toMatch(/\bhidden\b.*pointer-coarse:inline.*phone:inline/);
    expect(chip.querySelector('button')!.className).toMatch(/phone:min-h-11/);
    const twDir = dirname(resolve(ROOT, 'node_modules/tailwindcss/package.json'));
    const compiler = await compile(`@import 'tailwindcss';\n${read('src/styles/base.css')}`, {
      base: join(ROOT, 'src/styles'),
      loadStylesheet: async (id: string, base: string) => {
        const path = id === 'tailwindcss' ? join(twDir, 'index.css') : resolve(base, id);
        return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
      },
    });
    const css = compiler.build(['pointer-coarse:inline', 'pointer-coarse:min-h-11']);
    expect(css).toMatch(/@media \(pointer: coarse\)/);
  });
});

describe('r6 m: phone sheets spend one row on chrome', () => {
  it('puts the section tabs, state chip and close button in the frame header', () => {
    render(
      <Providers>
        <AnimatePresence>
          <MobileSheetBody key="sheet" id="settings" />
        </AnimatePresence>
      </Providers>,
    );
    const sheet = screen.getByTestId('mobile-sheet');
    const header = sheet.querySelector('[data-frame-header]')!;
    const tablist = screen.getByRole('tablist', { name: 'Sheet sections' });
    expect(header.contains(tablist)).toBe(true);
    expect(header.contains(screen.getByRole('button', { name: /^Close / }))).toBe(true);
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('SETTINGS');
    // No second row holding only the chip and close button.
    expect(sheet.querySelectorAll('header')).toHaveLength(1);
    expect(sheet.querySelector('.glass-3')).not.toBeNull();
  });

  it('keeps a panel\'s own header tools on that same row (round 4 m4)', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
    render(
      <Providers>
        <AnimatePresence>
          <MobileSheetBody key="sheet" id="style-studio" />
        </AnimatePresence>
      </Providers>,
    );
    const header = screen.getByTestId('mobile-sheet').querySelector('[data-frame-header]')!;
    expect(header.contains(screen.getByRole('tablist', { name: 'Sheet sections' }))).toBe(true);
    expect(header.contains(await screen.findByRole('button', { name: 'Copy theme JSON' }))).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('r6 m: glass surfaces really blur in Chromium', () => {
  it('keeps the unprefixed backdrop-filter after the production CSS optimiser', async () => {
    const twDir = dirname(resolve(ROOT, 'node_modules/tailwindcss/package.json'));
    const compiler = await compile(`@import 'tailwindcss';\n${read('src/styles/base.css')}`, {
      base: join(ROOT, 'src/styles'),
      loadStylesheet: async (id: string, base: string) => {
        const path = id === 'tailwindcss' ? join(twDir, 'index.css') : resolve(base, id);
        return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
      },
    });
    // The same Lightning CSS pass `next build` runs through @tailwindcss/postcss.
    const req = createRequire(realpathSync(resolve(ROOT, 'node_modules/@tailwindcss/postcss/package.json')));
    const { optimize } = req('@tailwindcss/node') as { optimize: (css: string, o: { minify: boolean }) => { code: string } };
    const css = optimize(compiler.build([]), { minify: true }).code;
    for (const cls of ['.glass-1', '.glass-2', '.glass-3']) {
      const rule = css.match(new RegExp(`[^}]*\\${cls}[,{][^}]*}`))?.[0] ?? '';
      expect(rule, cls).toMatch(/(?:^|[;{])backdrop-filter:blur\(var\(--blur\)\)/);
    }
  });
});

describe('FAA airways map token', () => {
  it('defines --map-route-airways in tokens.css, distinct from the planned/filed routes', () => {
    const css = read('src/styles/tokens.css');
    const v = (n: string) => css.match(new RegExp(`${n}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]?.toLowerCase();
    expect(v('--map-route-airways')).toMatch(/^#[0-9a-f]{6}$/);
    expect(v('--map-route-airways')).not.toBe(v('--map-route-planned'));
    expect(v('--map-route-airways')).not.toBe(v('--map-route-filed'));
  });
});

describe('Style Studio exposes every route class', () => {
  it('FLIGHT PATHS lists each --map-route-* token in MAP_TOKENS (airways included once mirrored)', async () => {
    const { MAP_TOKENS } = await import('@/lib/tokens');
    const { MAP_SECTIONS } = await import('./panels/StyleStudioPanel');
    const flight = MAP_SECTIONS.find((s) => s.title === 'FLIGHT PATHS');
    const routes = Object.keys(MAP_TOKENS).filter((k) => k.startsWith('--map-route-'));
    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(flight?.keys).toEqual(expect.arrayContaining(routes));
    expect(flight?.keys).toContain('--map-airport-watch');
  });
});
