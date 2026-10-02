// @vitest-environment jsdom
/**
 * design-system-hud, Phase 3 round 8 MAJOR: on a landscape phone (844×390) an open sheet pushed the
 * map's bottom-right stack (imagery chips + attribution) up into the header row: the attribution
 * ran under the view bar and a chip over the STATUS telemetry. The stack now keeps to the column
 * right of the view bar and below the telemetry while a sheet or card is open. The geometry is
 * measured in e2e/design-system-hud/round8.spec.ts; this covers the signals and the CSS contract.
 * The card-badge minor is in cards/card-freshness.test.tsx.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnimatePresence, LazyMotion, domMax } from 'motion/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_LAYOUT_QUERY } from '@/lib/map/view';
import { layoutEdge, reserveAttr, usePublishedEdge } from './hooks';
import { MobileSheetBody } from './PanelHost';
import Telemetry from './Telemetry';
import ViewControls from './ViewControls';

const baseCss = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8');
const root = document.documentElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const p of ['--sheet-occupied', '--view-controls-right', '--telemetry-bottom']) root.style.removeProperty(p);
  root.removeAttribute('data-sheet-occupied');
});

function box(el: { left: number; top: number; width: number; height: number }) {
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(el.left);
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(el.top);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(el.width);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(el.height);
}

function withQuery(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('r8 M: the signals base.css positions the stack with', () => {
  it('an open phone sheet marks <html> with data-sheet-occupied next to --sheet-occupied, and clears both on exit', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ bottom: '56px' } as CSSStyleDeclaration);
    const Host = ({ open }: { open: boolean }) =>
      withQuery(
        <LazyMotion features={domMax}>
          <AnimatePresence>{open && <MobileSheetBody key="sheet" id="help" />}</AnimatePresence>
        </LazyMotion>,
      );
    const { rerender } = render(<Host open />);
    expect(reserveAttr('--sheet-occupied')).toBe('data-sheet-occupied');
    expect(reserveAttr('--card-occupied')).toBe('data-card-occupied');
    expect(root.hasAttribute('data-sheet-occupied')).toBe(true);
    expect(root.style.getPropertyValue('--sheet-occupied')).toMatch(/^\d+px$/);
    rerender(<Host open={false} />);
    // Cleared the moment the exit starts (the sheet is still mounted while it slides out).
    expect(screen.getByTestId('mobile-sheet').hasAttribute('data-exiting')).toBe(true);
    expect(root.hasAttribute('data-sheet-occupied')).toBe(false);
    expect(root.style.getPropertyValue('--sheet-occupied')).toBe('');
  });

  it('layoutEdge reads the layout box (an entry transform does not leak in) and is null before layout', () => {
    const el = document.createElement('div');
    expect(layoutEdge(el, 'right')).toBeNull();
    Object.defineProperties(el, { offsetLeft: { value: 12 }, offsetWidth: { value: 355.5 }, offsetTop: { value: 16 }, offsetHeight: { value: 15 } });
    el.style.transform = 'translateY(-20px)';
    expect(layoutEdge(el, 'right')).toBe(368);
    expect(layoutEdge(el, 'bottom')).toBe(31);
  });

  it('ViewControls publishes --view-controls-right; Telemetry publishes --telemetry-bottom; both clear on unmount', () => {
    box({ left: 12, top: 64, width: 356, height: 54 });
    const view = render(withQuery(<ViewControls />));
    expect(root.style.getPropertyValue('--view-controls-right')).toBe('368px');
    view.unmount();
    expect(root.style.getPropertyValue('--view-controls-right')).toBe('');
    vi.restoreAllMocks();
    box({ left: 702, top: 16, width: 126, height: 15 });
    const tel = render(withQuery(<Telemetry />));
    expect(root.style.getPropertyValue('--telemetry-bottom')).toBe('31px');
    tel.unmount();
    expect(root.style.getPropertyValue('--telemetry-bottom')).toBe('');
  });

  it('usePublishedEdge re-measures on window resize', () => {
    let width = 300;
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(10);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => width);
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      usePublishedEdge(ref, '--view-controls-right', 'right');
      return <div ref={ref} />;
    }
    render(<Probe />);
    expect(root.style.getPropertyValue('--view-controls-right')).toBe('310px');
    width = 200;
    window.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--view-controls-right')).toBe('210px');
  });
});

describe('r8 M: base.css landscape-phone stack while a sheet or card is open', () => {
  const at = baseCss.indexOf('@media (max-height: 499px) and (orientation: landscape) {');
  const block = baseCss.slice(at, baseCss.indexOf('\n}\n', at));
  const rule = (selectorEnd: string) => {
    const i = block.indexOf(`${selectorEnd} {`);
    expect(i, selectorEnd).toBeGreaterThan(-1);
    return block.slice(i, block.indexOf('}', i));
  };
  const SCOPE = ':root:is([data-sheet-occupied], [data-card-occupied]) .maplibregl-map .maplibregl-ctrl-bottom-right';

  it('is the landscape half of the phone layout query', () => {
    expect(at).toBeGreaterThan(-1);
    expect(PHONE_LAYOUT_QUERY).toContain('(max-height: 499px) and (orientation: landscape)');
  });

  it('keeps the stack right of the view bar and below the telemetry row, above the sheet', () => {
    const stack = rule(SCOPE);
    expect(stack).toContain('left: calc(var(--view-controls-right, 50%) + 8px)');
    expect(stack).toContain('max-height: calc(100% - var(--map-stack-bottom) - var(--telemetry-bottom, 32px) - 6px)');
    expect(stack).toContain('justify-content: flex-end');
    // The bottom it is measured from is the same one the phone block lifts the stack by.
    expect(baseCss).toMatch(/--map-stack-bottom: max\(calc\(57px \+ env\(safe-area-inset-bottom\)\), calc\(var\(--sheet-occupied, 0px\) \+ 4px\), calc\(var\(--card-occupied, 0px\) \+ 4px\)\);/);
    expect(baseCss).toContain('bottom: var(--map-stack-bottom);');
  });

  it('never shrinks the credits; the chip controls give way, clipped from the top', () => {
    expect(rule(`${SCOPE} > .maplibregl-ctrl-attrib`)).toContain('flex-shrink: 0');
    const chips = rule(`${SCOPE} > .maplibregl-ctrl:not(.maplibregl-ctrl-attrib)`);
    for (const decl of ['flex-shrink: 1', 'min-height: 0', 'overflow: hidden', 'justify-content: flex-end']) expect(chips).toContain(decl);
    const list = rule(`${SCOPE} > .maplibregl-ctrl:not(.maplibregl-ctrl-attrib) ul`);
    // Rows top-down, so the last row (the phone summary chip's toggle) is the one nearest the credits.
    expect(list).toContain('flex-direction: row');
    expect(list).toContain('flex-wrap: wrap;');
  });
});
