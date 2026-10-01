// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { lazy, type ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '@/lib/store';
import { InstrumentFrame, usePanelChip } from './PanelChrome';
import { useBottomRightClearance } from './PanelHost';
import StyleStudioPanel from './panels/StyleStudioPanel';
import { preloadComponent, preloadWhenIdle } from './preload';
import Splash from './Splash';
import { SPLASH_CAP_MS, SPLASH_EXIT_MS } from './splash-logic';

function mockMobile(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll('.maplibregl-ctrl-bottom-right').forEach((e) => e.remove());
});

describe('visual-qa m4: the phone Style Studio sheet has one header row and no meaningless chip', () => {
  it('puts the studio tools in the frame header beside the one close button, with no STANDBY chip', async () => {
    mockMobile(true);
    render(
      <InstrumentFrame title="STYLE STUDIO" onClose={() => {}} sheet touch>
        <StyleStudioPanel onClose={() => {}} />
      </InstrumentFrame>,
    );
    const header = document.querySelector('header')!;
    // The tools are portalled into the header once the frame's slot has mounted.
    const copy = await screen.findByRole('button', { name: 'Copy theme JSON' });
    expect(header.contains(copy)).toBe(true);
    expect(header.contains(screen.getByRole('button', { name: 'Import theme JSON from clipboard' }))).toBe(true);
    // One header row: nothing else in the sheet body carries the tools or a close button.
    expect(screen.getAllByRole('button', { name: /^Close/ })).toHaveLength(1);
    expect(document.querySelectorAll('header')).toHaveLength(1);
    expect(screen.queryByText('STANDBY')).toBeNull();
    expect(header.querySelector('.instrument-chip')).toBeNull();
    // 44 px phone targets for the frame buttons too.
    expect(screen.getByRole('button', { name: 'Close STYLE STUDIO' }).className).toContain('h-11');
    // Still named by its (screen-reader) title.
    expect(screen.getByRole('region', { name: 'STYLE STUDIO' })).toBeTruthy();
  });

  it('shows a chip only when the panel reports a state', () => {
    function Stateful() {
      usePanelChip('3 RESULTS', 'live');
      return null;
    }
    const { rerender } = render(
      <InstrumentFrame title="PRESETS" onClose={() => {}}>
        <p>body</p>
      </InstrumentFrame>,
    );
    expect(document.querySelector('.instrument-chip')).toBeNull();
    rerender(
      <InstrumentFrame title="PRESETS" onClose={() => {}}>
        <Stateful />
      </InstrumentFrame>,
    );
    expect(screen.getByText('3 RESULTS').className).toContain('instrument-chip');
  });
});

function Clearance({ enabled }: { enabled: boolean }) {
  const px = useBottomRightClearance(enabled);
  return <output data-testid="px">{px}</output>;
}

describe('perf m-c: the docked-panel clearance never forces a layout on a timer', () => {
  function stack(top: number) {
    const el = document.createElement('div');
    el.className = 'maplibregl-ctrl-bottom-right';
    el.append(document.createElement('div'));
    const rect = vi.fn(() => ({ top }) as DOMRect);
    el.getBoundingClientRect = rect;
    document.body.append(el);
    return rect;
  }
  function fakeResizeObserver() {
    const observers: { cb: () => void; observed: Element[] }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observed: Element[] = [];
        constructor(public cb: () => void) {
          observers.push(this);
        }
        observe(el: Element) {
          this.observed.push(el);
        }
        disconnect() {
          this.observed = [];
        }
      },
    );
    return observers;
  }

  it('measures nothing while no docked panel is open', () => {
    vi.useFakeTimers();
    const rect = stack(800);
    render(<Clearance enabled={false} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(rect).not.toHaveBeenCalled();
  });

  it('measures once on open, then only when the stack resizes, never per second', () => {
    vi.useFakeTimers();
    const observers = fakeResizeObserver();
    const rect = stack(1000 - 120);
    vi.stubGlobal('innerHeight', 1000);
    render(<Clearance enabled />);
    expect(screen.getByTestId('px').textContent).toBe('128');
    expect(rect).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(10_000));
    expect(rect).toHaveBeenCalledTimes(1);
    // A chip joins the stack: the ResizeObserver reports it and the clearance follows.
    rect.mockReturnValue({ top: 1000 - 200 } as DOMRect);
    act(() => observers.find((o) => o.observed.length)!.cb());
    expect(screen.getByTestId('px').textContent).toBe('208');
    expect(rect).toHaveBeenCalledTimes(2);
  });

  it('does not look for the map stack while the tab is hidden', () => {
    vi.useFakeTimers();
    const query = vi.spyOn(document, 'querySelector');
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    render(<Clearance enabled />);
    const initial = query.mock.calls.length;
    act(() => vi.advanceTimersByTime(5_000));
    expect(query.mock.calls.length).toBe(initial);
    hidden.mockReturnValue(false);
    act(() => vi.advanceTimersByTime(1_000));
    expect(query.mock.calls.length).toBeGreaterThan(initial);
  });
});

describe('perf m-d: the splash animates with CSS, then unmounts and reports done', () => {
  it('fades out after the cap and calls setSplashDone once the exit transition ends', () => {
    vi.useFakeTimers();
    useUiStore.setState({ splashDone: false });
    render(<Splash />);
    const splash = screen.getByRole('status');
    expect(splash.hasAttribute('data-exiting')).toBe(false);
    expect(document.querySelectorAll('.splash-ring')).toHaveLength(3);
    act(() => vi.advanceTimersByTime(SPLASH_CAP_MS + 250));
    expect(splash.hasAttribute('data-exiting')).toBe(true);
    expect(useUiStore.getState().splashDone).toBe(false);
    act(() => {
      fireEvent.transitionEnd(splash, { propertyName: 'opacity' });
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(useUiStore.getState().splashDone).toBe(true);
  });

  it('never waits on a transitionend that does not come (zero-duration transitions)', () => {
    vi.useFakeTimers();
    useUiStore.setState({ splashDone: false });
    render(<Splash />);
    act(() => vi.advanceTimersByTime(SPLASH_CAP_MS + 250));
    act(() => vi.advanceTimersByTime(SPLASH_EXIT_MS + 200));
    expect(screen.queryByRole('status')).toBeNull();
    expect(useUiStore.getState().splashDone).toBe(true);
  });
});

/** Static (non-`import()`, non-`import type`) module graph from `entry`, resolved inside src/. */
function staticGraph(entry: string): { files: Set<string>; external: Map<string, string[]> } {
  const src = path.resolve(__dirname, '../..');
  const files = new Set<string>();
  const external = new Map<string, string[]>();
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/') ? path.join(src, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
    if (!base) return null;
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
      const f = base + ext;
      if (/\.(ts|tsx)$/.test(f) && existsSync(f)) return f;
    }
    return null;
  };
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const code = readFileSync(file, 'utf8');
    const re = /^\s*(?:import|export)\s+(type\s+)?(?:[^;()'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
    for (const m of code.matchAll(re)) {
      if (m[1]) continue; // `import type` / `export type` are erased
      const spec = m[2]!;
      const local = resolve(file, spec);
      if (local) visit(local);
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) external.set(spec, [...(external.get(spec) ?? []), path.relative(src, file)]);
    }
  };
  visit(path.join(src, entry));
  return { files, external };
}

describe('perf m-d: motion is not in the first-load graph of the map shell', () => {
  const { files, external } = staticGraph('app/(map)/AppShell.tsx');
  it('reaches the HUD root, the tool strip, the splash and the registry statically', () => {
    const rel = [...files].map((f) => f.split(`${path.sep}src${path.sep}`)[1]);
    for (const f of ['components/hud/HudRoot.tsx', 'components/hud/Splash.tsx', 'components/hud/ToolStrip.tsx', 'features/registry.ts', 'components/hud/LayerRows.tsx'])
      expect(rel, f).toContain(f.replace(/\//g, path.sep));
  });
  it('no statically imported module imports motion (it loads with HudMotion after hydration)', () => {
    const motion = [...external].filter(([spec]) => spec === 'motion' || spec.startsWith('motion/') || spec === 'framer-motion');
    expect(motion).toEqual([]);
    expect([...files].some((f) => f.endsWith(`${path.sep}HudMotion.tsx`))).toBe(false);
  });
});

describe('R1 m9: lazily loaded panel code is warmed before the first open', () => {
  it('starts a React.lazy import once', async () => {
    const loader = vi.fn(async () => ({ default: (() => null) as ComponentType }));
    const Lazy = lazy(loader);
    expect(preloadComponent(Lazy)).toBe(true);
    expect(preloadComponent(Lazy)).toBe(true);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('starts the import behind an App Router next/dynamic wrapper without rendering it', async () => {
    // The App Router build of next/dynamic (what `next/dynamic` resolves to under app/).
    const { default: Loadable } = (await import('next/dist/shared/lib/lazy-dynamic/loadable.js')) as unknown as {
      default: (o: { loader: () => Promise<{ default: ComponentType }>; ssr?: boolean }) => ComponentType;
    };
    const body = vi.fn(() => null);
    const loader = vi.fn(async () => ({ default: body as ComponentType }));
    const Panel = Loadable({ loader, ssr: false });
    expect(preloadComponent(Panel)).toBe(true);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    expect(body).not.toHaveBeenCalled();
    preloadComponent(Panel);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('never calls a static component', () => {
    const Static = vi.fn(() => null);
    expect(preloadComponent(Static as ComponentType)).toBe(false);
    expect(preloadComponent(null)).toBe(false);
    expect(Static).not.toHaveBeenCalled();
  });

  it('warms one component per idle period and can be cancelled', () => {
    vi.useFakeTimers();
    const a = vi.fn(async () => ({ default: (() => null) as ComponentType }));
    const b = vi.fn(async () => ({ default: (() => null) as ComponentType }));
    const cancel = preloadWhenIdle([lazy(a), null, lazy(b)]);
    expect(a).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    cancel();
    vi.advanceTimersByTime(5_000);
    expect(b).not.toHaveBeenCalled();
  });
});
