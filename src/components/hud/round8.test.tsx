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
import { layoutEdge, reserveAttr, usePublishedAttribHeight, usePublishedEdge } from './hooks';
import { MobileSheetBody } from './PanelHost';
import Telemetry from './Telemetry';
import ViewControls from './ViewControls';

const baseCss = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8');
const root = document.documentElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const p of ['--sheet-occupied', '--view-controls-right', '--telemetry-bottom', '--map-attrib-height']) root.style.removeProperty(p);
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

describe('r8 minor: narrow landscape phone (568x320) - the sheet leaves the credits a row above it', () => {
  it('usePublishedAttribHeight publishes the credits height, follows a control added later, and clears on unmount', async () => {
    let height = 71;
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(192);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
    const container = document.createElement('div');
    const controls = document.createElement('div');
    controls.className = 'maplibregl-control-container';
    container.append(controls);
    document.body.append(container);
    function Probe() {
      usePublishedAttribHeight(container);
      return null;
    }
    const view = render(<Probe />);
    expect(root.style.getPropertyValue('--map-attrib-height')).toBe('');
    const attrib = document.createElement('div');
    attrib.className = 'maplibregl-ctrl maplibregl-ctrl-attrib';
    controls.append(attrib);
    await vi.waitFor(() => expect(root.style.getPropertyValue('--map-attrib-height')).toBe('71px'));
    height = 29;
    window.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--map-attrib-height')).toBe('29px');
    view.unmount();
    expect(root.style.getPropertyValue('--map-attrib-height')).toBe('');
    container.remove();
  });

  const at = baseCss.indexOf('@media (max-height: 499px) and (orientation: landscape) {');
  const block = baseCss.slice(at, baseCss.indexOf('\n}\n', at));
  const rule = (sel: string) => {
    const i = block.indexOf(`${sel} {`);
    expect(i, sel).toBeGreaterThan(-1);
    return block.slice(i, block.indexOf('}', i));
  };
  /** The cap the CSS computes, evaluated for a viewport (calc of px terms only). */
  const cap = (css: string, vh: number, vars: Record<string, number>) => {
    const expr = /--sheet-cap: calc\((.*)\);/.exec(css)![1]!;
    return expr.split(' - ').reduce((acc, term, i) => {
      const v = term === '100dvh' ? vh : term === 'env(safe-area-inset-bottom)' ? 0 : /^var\((--[\w-]+)/.test(term) ? vars[/^var\((--[\w-]+)/.exec(term)![1]!]! : parseFloat(term);
      return i === 0 ? v : acc - v;
    }, 0);
  };

  it('caps the sheet and the card on short landscape screens so the credits fit between them and the telemetry', () => {
    const sheet = rule('.godseye-mobile-sheet');
    const card = rule('.godseye-card-sheet');
    expect(sheet).toContain('max-height: min(55vh, max(30vh, var(--sheet-cap)))');
    expect(sheet).toContain('min-height: min(40vh, max(30vh, var(--sheet-cap)))');
    expect(card).toContain('max-height: min(50vh, max(30vh, var(--sheet-cap)))');
    // 568x320, measured: telemetry bottom 31, credits 71 tall in the 192 px column.
    const vars = { '--telemetry-bottom': 31, '--map-attrib-height': 71 };
    const sheetCap = cap(sheet, 320, vars);
    expect(sheetCap).toBe(104);
    // The stack's room above the capped sheet (base.css: 100% - stack bottom - telemetry - 6) holds the
    // credits and one imagery chip row (44 px + 4 px margin, r9 m), and the cap stays above the 30vh floor.
    const stackBottom = sheetCap + 56 + 4;
    expect(320 - stackBottom - 31 - 6).toBeGreaterThanOrEqual(71 + 48);
    expect(sheetCap).toBeGreaterThanOrEqual(0.3 * 320);
    const cardCap = cap(card, 320, vars);
    expect(320 - (cardCap + 60 + 4) - 31 - 6).toBeGreaterThanOrEqual(71 + 48);
    // 844x390 (credits 29 tall) never reaches the cap: 55vh stays the limit.
    expect(cap(sheet, 390, { '--telemetry-bottom': 31, '--map-attrib-height': 29 })).toBeGreaterThan(0.55 * 390);
  });

  it('the phone sheet and the card carry the classes the cap targets', () => {
    const panelHost = readFileSync(join(process.cwd(), 'src/components/hud/PanelHost.tsx'), 'utf8');
    const cardHost = readFileSync(join(process.cwd(), 'src/components/cards/CardHost.tsx'), 'utf8');
    expect(panelHost).toMatch(/data-testid="mobile-sheet"[\s\S]{0,80}className="godseye-mobile-sheet /);
    expect(cardHost).toContain('className="godseye-card-sheet ');
  });
});
