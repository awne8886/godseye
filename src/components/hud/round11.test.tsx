// @vitest-environment jsdom
/**
 * design-system-hud, Phase 3 round 11 (24 h timeline): the strip's placement clear of MapLibre's
 * bottom-right stack (MAJOR A), one clamped cursor for every reader (C), a drag publishing only on a
 * new 15 min step (D), the phone strip reserve (E) and the timeline keys in the Help panel (F).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMELINE_KEYS } from '@/lib/keyboard';
import { useUiStore } from '@/lib/store';
import { ShortcutTable } from './panels/HelpPanel';
import Telemetry from './Telemetry';
import TimelineScrubber from './TimelineScrubber';
import { TIMELINE_CLOCK_MS, TIMELINE_SPAN_MS, TIMELINE_STEP_MS, cursorAtFraction, replayLabel, stepsBackAtFraction, useTimelineCoverage } from './timeline';
import { STRIP_MIN_SIDE_WIDTH, STRIP_STACK_GAP, stripPlacement } from './timeline-layout';

const H = 3_600_000;

function withQuery(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const original = useUiStore.getState().setTimeCursor;
beforeEach(() => {
  useUiStore.setState({ timeCursor: null, activeLayers: new Set(['earthquakes']), setTimeCursor: original });
  useTimelineCoverage.setState({ coverage: {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useUiStore.setState({ timeCursor: null, setTimeCursor: original });
});

describe('MAJOR A: the strip is placed clear of the credits stack', () => {
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

  it('no stack yet: the default slot (right of the view strip, above the status bar)', () => {
    expect(stripPlacement(1600, 1000, null)).toEqual({ mode: 'slot', left: 512, bottom: 56, width: 620 });
    expect(stripPlacement(900, 700, null)).toEqual({ mode: 'slot', left: 120, bottom: 148, width: 560 });
  });

  it('a short stack leaves room: the strip ends before it', () => {
    const p = stripPlacement(1600, 1000, box(1100, 880, 1594, 972));
    expect(p.mode).toBe('beside');
    expect(p.bottom).toBe(56);
    expect(p.left + p.width).toBeLessThanOrEqual(1100 - STRIP_STACK_GAP);
  });

  it('1280×800 and 1024×768: no room beside, so the strip rises above the stack top', () => {
    for (const [vw, vh, stackLeft, stackTop] of [
      [1280, 800, 754, 640],
      [1024, 768, 598, 630],
    ] as const) {
      const p = stripPlacement(vw, vh, box(stackLeft, stackTop, vw - 6, vh - 28));
      expect(p.mode).toBe('above');
      expect(vh - p.bottom).toBeLessThanOrEqual(stackTop - STRIP_STACK_GAP); // strip bottom edge above the stack
      expect(p.left + p.width).toBeLessThanOrEqual(vw); // never off screen
      expect(p.width).toBeGreaterThanOrEqual(STRIP_MIN_SIDE_WIDTH - 1 - 32);
    }
  });

  it('the scrubber applies the measured placement inline on desktops', () => {
    const stack = document.createElement('div');
    stack.className = 'maplibregl-map';
    stack.innerHTML = '<div class="maplibregl-ctrl-bottom-right"></div>';
    document.body.appendChild(stack);
    const inner = stack.firstElementChild as HTMLElement;
    inner.getBoundingClientRect = () => ({ left: 754, top: 640, right: 1274, bottom: 772, width: 520, height: 132, x: 754, y: 640, toJSON: () => ({}) });
    Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
    render(withQuery(<TimelineScrubber />));
    const strip = screen.getByTestId('timeline-scrubber');
    expect(strip.getAttribute('data-placement')).toBe('above');
    expect(strip.style.bottom).toBe(`${800 - 640 + STRIP_STACK_GAP}px`);
    stack.remove();
  });

  it('header: LIVE never shrinks, the label never wraps, counts sit on their own row in fixed columns', () => {
    useUiStore.setState({ activeLayers: new Set(['earthquakes', 'fires', 'alert_pins', 'gdelt_events']) });
    render(withQuery(<TimelineScrubber />));
    expect(screen.getByTestId('timeline-live').className).toMatch(/\bshrink-0\b/);
    expect(screen.getByText('TIMELINE · 24 H').className).toMatch(/\bwhitespace-nowrap\b/);
    const counts = screen.getByRole('list', { name: 'Items drawn at the cursor' });
    expect(counts.className).toContain('hud-timeline-counts');
    expect(counts.parentElement).toBe(screen.getByTestId('timeline-scrubber'));
    for (const li of counts.querySelectorAll('li')) expect(li.className).toMatch(/\bwhitespace-nowrap\b/);
    const css = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8');
    expect(css).toMatch(/\.hud-timeline-counts \{\s*grid-template-columns: repeat\(auto-fill, minmax\(160px, 1fr\)\);/);
  });
});

describe('MINOR C: one clamped cursor', () => {
  it('Home, then ten minutes later: the store (telemetry, rail, filters) reads the strip start', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(Date.parse('2026-10-02T22:10:00Z'));
    render(withQuery(<><TimelineScrubber /><Telemetry /></>));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Timeline cursor' }), { key: 'Home' });
    expect(useUiStore.getState().timeCursor).toBe(Date.now() - TIMELINE_SPAN_MS);
    act(() => vi.advanceTimersByTime(10 * 60_000));
    const strip = Date.now() - Date.now() % TIMELINE_CLOCK_MS - TIMELINE_SPAN_MS;
    expect(useUiStore.getState().timeCursor).toBe(strip);
    expect(screen.getByTestId('timeline-time').textContent).toBe(replayLabel(strip));
    expect(screen.getByTestId('telemetry-status').textContent).toContain(replayLabel(strip));
  });
});

describe('MINOR D: a drag publishes only on a new 15 min step', () => {
  it('the step does not depend on the wall clock', () => {
    expect(stepsBackAtFraction(1)).toBe(0);
    expect(stepsBackAtFraction(0)).toBe(TIMELINE_SPAN_MS / TIMELINE_STEP_MS);
    expect(stepsBackAtFraction(0.5)).toBe(48);
    expect(stepsBackAtFraction(0.5)).toBe(stepsBackAtFraction(0.502));
    expect(cursorAtFraction(0.5, 1e12)).toBe(1e12 - 12 * H);
  });

  it('two pointer moves inside one step call setCursor once', () => {
    const spy = vi.fn(original);
    useUiStore.setState({ setTimeCursor: spy });
    render(withQuery(<TimelineScrubber />));
    const slider = screen.getByRole('slider', { name: 'Timeline cursor' });
    slider.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 24, width: 960, height: 24, x: 0, y: 0, toJSON: () => ({}) });
    // 960 px / 96 steps = 10 px per step: 480 and 482 are both 48 steps back (12 h).
    fireEvent.pointerDown(slider, { button: 0, clientX: 480, pointerId: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(slider, { clientX: 482, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 483, pointerId: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(slider, { clientX: 470, pointerId: 1 });
    expect(spy).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(slider, { pointerId: 1 });
  });
});

describe('MINOR E and F', () => {
  it('phones reserve the 54 px bar plus its 4 px gap for the credits', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8');
    expect(css).toMatch(/--timeline-strip: 58px;/);
  });

  it('the Help panel lists the timeline keys from the shared keyboard map', () => {
    render(<ShortcutTable />);
    const group = screen.getByTestId('timeline-shortcut-table');
    expect(group.textContent).toContain('Timeline (slider focused)');
    for (const k of TIMELINE_KEYS) expect(group.textContent).toContain(k.description);
    expect(TIMELINE_KEYS.map((k) => k.display)).toEqual(['← / →', 'Shift+← / → · PgUp / PgDn', 'Home', 'End / ESC']);
  });
});
