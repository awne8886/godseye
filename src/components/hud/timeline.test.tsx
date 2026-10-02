// @vitest-environment jsdom
/**
 * design-system-hud, Phase 3 round 10 MAJOR: the 24 h timeline scrubber (§7, §9 item 2). Covers the
 * observed-time filter, cursor stepping/clamping, the coverage store, the scrubber's slider (ARIA,
 * keys, LIVE) and that the telemetry and layer rows never read LIVE while replaying. The arrival
 * rings' "new since the previous poll" rule (r10 minor) is at the end.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLayer, type LayerDef } from '@/lib/layer-registry';
import { useLayerStatusStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { ARRIVAL_RING_GROW_PX, MAX_ARRIVAL_RINGS, newArrivals, useArrivalRings } from './arrival-rings';
import { FreshnessLed } from './LayerRows';
import Telemetry from './Telemetry';
import TimelineScrubber, { cursorForKey } from './TimelineScrubber';
import {
  TIMELINE_SPAN_MS,
  TIMELINE_STEP_MS,
  clampCursor,
  cursorAtFraction,
  cursorValueText,
  filterAtCursor,
  heldSpan,
  inReplayWindow,
  oldestMs,
  replayLabel,
  stepCursor,
  timeMs,
  useTimelineCoverage,
} from './timeline';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const H = 3_600_000;

function withQuery(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useUiStore.setState({ timeCursor: null, activeLayers: new Set(['earthquakes']) });
  useTimelineCoverage.setState({ coverage: {} });
});
afterEach(() => {
  cleanup();
  useUiStore.setState({ timeCursor: null });
  document.documentElement.removeAttribute('data-timeline-strip');
});

describe('observed-time filter', () => {
  const items = [
    { id: 'a', t: NOW - 30 * 60_000 },
    { id: 'b', t: NOW - 5 * H },
    { id: 'c', t: NOW - 20 * H },
    { id: 'untimed', t: null as number | null },
  ];
  const at = (i: (typeof items)[number]) => i.t;

  it('live (null cursor) keeps every item and the same array', () => {
    expect(filterAtCursor(items, null, at)).toBe(items);
  });

  it('keeps only items observed at or before the cursor, never an untimed one', () => {
    expect(filterAtCursor(items, NOW - 4 * H, at).map((i) => i.id)).toEqual(['b', 'c']);
    expect(filterAtCursor(items, NOW - 5 * H, at).map((i) => i.id)).toEqual(['b', 'c']);
    expect(filterAtCursor(items, NOW - 19 * H, at).map((i) => i.id)).toEqual(['c']);
    expect(inReplayWindow(null, NOW)).toBe(false);
    expect(inReplayWindow(Number.NaN, NOW)).toBe(false);
  });

  it('drops what is older than 24 h before the cursor', () => {
    expect(inReplayWindow(NOW - TIMELINE_SPAN_MS, NOW)).toBe(false);
    expect(inReplayWindow(NOW - TIMELINE_SPAN_MS + 1, NOW)).toBe(true);
  });

  it('parses ISO times and rejects junk', () => {
    expect(timeMs('2026-10-02T12:00:00Z')).toBe(NOW);
    expect(timeMs(null)).toBeNull();
    expect(timeMs('not a time')).toBeNull();
  });
});

describe('cursor state', () => {
  it('a cursor at or past now is live; one older than 24 h is held at the strip start', () => {
    expect(clampCursor(NOW, NOW)).toBeNull();
    expect(clampCursor(NOW + 1, NOW)).toBeNull();
    expect(clampCursor(NOW - 30 * H, NOW)).toBe(NOW - TIMELINE_SPAN_MS);
    expect(clampCursor(Number.NaN, NOW)).toBeNull();
  });

  it('steps back from live, forward into live', () => {
    expect(stepCursor(null, NOW, -TIMELINE_STEP_MS)).toBe(NOW - TIMELINE_STEP_MS);
    expect(stepCursor(NOW - TIMELINE_STEP_MS, NOW, TIMELINE_STEP_MS)).toBeNull();
    expect(stepCursor(null, NOW, TIMELINE_STEP_MS)).toBeNull();
  });

  it('pointer fractions snap to 15 min; the right end is live', () => {
    expect(cursorAtFraction(1, NOW)).toBeNull();
    expect(cursorAtFraction(0.999, NOW)).toBeNull();
    expect(cursorAtFraction(0, NOW)).toBe(NOW - TIMELINE_SPAN_MS);
    expect(cursorAtFraction(0.5, NOW)).toBe(NOW - 12 * H);
    expect((NOW - cursorAtFraction(0.3, NOW)!) % TIMELINE_STEP_MS).toBe(0);
  });

  it('keys: arrows step 15 min (Shift 1 h), Home 24 h back, End and Escape return live', () => {
    expect(cursorForKey('ArrowLeft', false, null, NOW)).toBe(NOW - TIMELINE_STEP_MS);
    expect(cursorForKey('ArrowLeft', true, null, NOW)).toBe(NOW - H);
    expect(cursorForKey('PageDown', false, NOW - H, NOW)).toBe(NOW - 2 * H);
    expect(cursorForKey('ArrowRight', false, NOW - H, NOW)).toBe(NOW - H + TIMELINE_STEP_MS);
    expect(cursorForKey('Home', false, null, NOW)).toBe(NOW - TIMELINE_SPAN_MS);
    expect(cursorForKey('End', false, NOW - H, NOW)).toBeNull();
    expect(cursorForKey('Escape', false, NOW - H, NOW)).toBeNull();
    // Escape while live is not the slider's (it falls through to the HUD's own Escape).
    expect(cursorForKey('Escape', false, null, NOW)).toBeUndefined();
    expect(cursorForKey('a', false, null, NOW)).toBeUndefined();
  });

  it('labels: REPLAY with the UTC time, an ARIA value text, never LIVE while replaying', () => {
    expect(replayLabel(NOW - 90 * 60_000)).toBe('REPLAY 10:30 UTC');
    expect(cursorValueText(NOW - 90 * 60_000, NOW)).toBe('Replay 2026-10-02 10:30 UTC, 1 h 30 min ago');
    expect(cursorValueText(null, NOW)).toBe('Live, now');
  });

  it('the store field rejects non-finite cursors', () => {
    useUiStore.getState().setTimeCursor(Number.NaN);
    expect(useUiStore.getState().timeCursor).toBeNull();
    useUiStore.getState().setTimeCursor(NOW - H);
    expect(useUiStore.getState().timeCursor).toBe(NOW - H);
  });
});

describe('held span (honest retention)', () => {
  it('a declared window ends at the fetch; otherwise the oldest held item starts it', () => {
    expect(heldSpan('2026-10-02T12:00:00Z', TIMELINE_SPAN_MS, null)).toEqual({ from: NOW - TIMELINE_SPAN_MS, to: NOW });
    expect(heldSpan('2026-10-02T12:00:00Z', null, NOW - 3 * H)).toEqual({ from: NOW - 3 * H, to: NOW });
    expect(heldSpan(null, TIMELINE_SPAN_MS, null)).toBeNull();
    expect(heldSpan('2026-10-02T12:00:00Z', null, null)).toBeNull();
    expect(oldestMs([{ t: 5 }, { t: null }, { t: 2 }], (x) => x.t)).toBe(2);
  });

  it('the coverage store ignores identical reports and clears on null', () => {
    const { report } = useTimelineCoverage.getState();
    report('earthquakes', { from: 1, to: 2, shown: 3, total: 4 });
    const first = useTimelineCoverage.getState().coverage;
    report('earthquakes', { from: 1, to: 2, shown: 3, total: 4 });
    expect(useTimelineCoverage.getState().coverage).toBe(first);
    report('earthquakes', null);
    expect(useTimelineCoverage.getState().coverage.earthquakes).toBeUndefined();
  });
});

describe('scrubber', () => {
  it('is hidden without a replayable layer, shown with one', () => {
    useUiStore.setState({ activeLayers: new Set(['flights']) });
    const { rerender } = render(withQuery(<TimelineScrubber />));
    expect(screen.queryByTestId('timeline-scrubber')).toBeNull();
    act(() => useUiStore.setState({ activeLayers: new Set(['flights', 'earthquakes']) }));
    rerender(withQuery(<TimelineScrubber />));
    expect(screen.getByTestId('timeline-scrubber')).toBeTruthy();
  });

  it('is an ARIA slider driven by the keyboard, and LIVE returns to now', () => {
    render(withQuery(<TimelineScrubber />));
    const slider = screen.getByRole('slider', { name: 'Timeline cursor' });
    expect(slider.getAttribute('aria-valuemin')).toBe('-1440');
    expect(slider.getAttribute('aria-valuemax')).toBe('0');
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    expect(slider.getAttribute('aria-valuetext')).toBe('Live, now');
    expect(screen.getByTestId('timeline-time').textContent).toMatch(/^NOW \d\d:\d\d UTC$/);

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(useUiStore.getState().timeCursor).not.toBeNull();
    expect(slider.getAttribute('aria-valuenow')).toBe('-30');
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^Replay .* UTC, 30 min ago$/);
    expect(screen.getByTestId('timeline-time').textContent).toMatch(/^REPLAY \d\d:\d\d UTC$/);
    expect(screen.getByTestId('timeline-scrubber').getAttribute('data-replay')).toBe('true');

    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider.getAttribute('aria-valuenow')).toBe('-1440');
    fireEvent.keyDown(slider, { key: 'Escape' });
    expect(useUiStore.getState().timeCursor).toBeNull();

    fireEvent.keyDown(slider, { key: 'PageDown' });
    const live = screen.getByRole('button', { name: /LIVE/ });
    expect(live.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(live);
    expect(useUiStore.getState().timeCursor).toBeNull();
    expect(live.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows each lane count at the cursor and the held span; leaving every replayable layer ends the replay', () => {
    act(() => {
      useTimelineCoverage.getState().report('earthquakes', { from: Date.now() - TIMELINE_SPAN_MS, to: Date.now(), shown: 7, total: 36 });
      useUiStore.setState({ timeCursor: Date.now() - H });
    });
    render(withQuery(<TimelineScrubber />));
    const count = screen.getByTestId('timeline-count-earthquakes');
    expect(count.textContent).toContain('QUAKES 7/36');
    expect(count.getAttribute('data-shown')).toBe('7');
    expect(screen.getByTestId('timeline-lane-earthquakes').getAttribute('title')).toMatch(/feed holds \d\d:\d\d–\d\d:\d\d UTC/);
    act(() => useUiStore.setState({ activeLayers: new Set(['flights']) }));
    expect(useUiStore.getState().timeCursor).toBeNull();
  });
});

describe('never LIVE while replaying', () => {
  it('telemetry STATUS reads REPLAY hh:mm UTC', () => {
    useLayerStatusStore.setState({ status: { earthquakes: { state: 'live', count: 36 } } } as never);
    useUiStore.setState({ timeCursor: NOW - 90 * 60_000 });
    render(withQuery(<Telemetry />));
    const st = screen.getByTestId('telemetry-status').textContent ?? '';
    expect(st).toContain('REPLAY 10:30 UTC');
    expect(st).not.toMatch(/\bLIVE\b/);
  });

  it('a replayed layer row shows the cursor, not its live freshness; an offline one still says so', () => {
    const quakes = getLayer('earthquakes') as LayerDef;
    useUiStore.setState({ timeCursor: NOW - 90 * 60_000 });
    const { rerender } = render(<FreshnessLed layer={quakes} status={{ state: 'live', observedAt: new Date().toISOString() } as never} />);
    expect(screen.getByTestId('replay-earthquakes').textContent).toBe('REPLAY 10:30Z');
    rerender(<FreshnessLed layer={quakes} status={{ state: 'offline', lastGoodAt: null } as never} />);
    expect(screen.queryByTestId('replay-earthquakes')).toBeNull();
  });
});

describe('phone layout and starfield CSS contract', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8');
  it('the compact bar steps aside for sheets and lifts the map credits above itself', () => {
    expect(css).toMatch(/\[data-sheet-occupied\], \[data-card-occupied\]\) \.hud-timeline \{\s*display: none;/);
    expect(css).toMatch(/--map-stack-bottom: max\(calc\(57px \+ var\(--timeline-strip, 0px\)/);
  });
  it('the starfield is a static, token-coloured background (no animation)', () => {
    const rule = css.slice(css.indexOf('.godseye-starfield {'), css.indexOf('}', css.indexOf('.godseye-starfield {')));
    expect(rule).toContain('var(--star)');
    expect(rule).toContain('var(--sky-deep)');
    expect(rule).not.toMatch(/animation|transition/);
  });
});

describe('arrival rings (r10 minor)', () => {
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  const items = [
    { id: 'a', t: 1 },
    { id: 'b', t: 5 },
    { id: 'c', t: 3 },
    { id: 'd', t: 4 },
    { id: 'e', t: 2 },
  ];
  it('nothing is new on the first poll', () => {
    expect(newArrivals(null, items, (i) => i.id, (i) => i.t)).toEqual([]);
  });
  it('only items absent from the previous poll, newest observed first, at most 3', () => {
    expect(ids(newArrivals(new Set(['a']), items, (i) => i.id, (i) => i.t))).toEqual(['b', 'd', 'c']);
    expect(MAX_ARRIVAL_RINGS).toBe(3);
    expect(ids(newArrivals(new Set(['a', 'b', 'c', 'd']), items, (i) => i.id, (i) => i.t))).toEqual(['e']);
    expect(newArrivals(new Set(ids(items)), items, (i) => i.id, (i) => i.t)).toEqual([]);
  });
});

describe('arrival ring layer', () => {
  type Q = { id: string; lng: number; lat: number; t: number };
  const q = (id: string, t: number): Q => ({ id, lng: t, lat: 0, t });
  const hook = () =>
    renderHook((p: { items: Q[] }) =>
      useArrivalRings({ id: 'rings', items: p.items, idOf: (x) => x.id, positionOf: (x) => [x.lng, x.lat], observedMs: (x) => x.t, radiusPx: () => 4, color: [230, 81, 0, 230], camera: null }),
      { initialProps: { items: [q('a', 1)] } },
    );
  type RingLayer = { props: { data: { key: string }[]; parameters: unknown; billboard: boolean; transitions: Record<string, { enter: (to: number[]) => number[] }>; getRadius: (d: { radiusPx: number }) => number } };

  afterEach(() => useUiStore.setState({ settings: { ...useUiStore.getState().settings, motion: 'system' } }));

  it('rings only what is new since the previous poll, at most 3, globe-safe, growing outward from the marker', () => {
    useUiStore.setState({ settings: { ...useUiStore.getState().settings, motion: 'full' } });
    const { result, rerender } = hook();
    let layer = result.current as unknown as RingLayer;
    expect(layer.props.data).toEqual([]);
    rerender({ items: [q('a', 1), q('b', 2), q('c', 3), q('d', 4), q('e', 5)] });
    layer = result.current as unknown as RingLayer;
    expect(layer.props.data.map((r) => r.key)).toEqual(['e', 'd', 'c']);
    expect(layer.props.parameters).toEqual({ cullMode: 'none', depthCompare: 'always' });
    expect(layer.props.billboard).toBe(true);
    expect(layer.props.getRadius({ radiusPx: 4 })).toBe(4 + ARRIVAL_RING_GROW_PX);
    expect(layer.props.transitions.getRadius!.enter([4 + ARRIVAL_RING_GROW_PX])).toEqual([4]);
    // Already 3 rings: a further arrival waits for the batch to end (cap).
    rerender({ items: [q('a', 1), q('b', 2), q('c', 3), q('d', 4), q('e', 5), q('f', 6)] });
    expect((result.current as unknown as RingLayer).props.data).toHaveLength(MAX_ARRIVAL_RINGS);
  });

  it('is off under reduced motion and while the timeline replays', () => {
    useUiStore.setState({ settings: { ...useUiStore.getState().settings, motion: 'reduced' } });
    const { result, rerender } = hook();
    rerender({ items: [q('a', 1), q('b', 2)] });
    expect(result.current).toBeNull();
    act(() => useUiStore.setState({ settings: { ...useUiStore.getState().settings, motion: 'full' }, timeCursor: NOW }));
    rerender({ items: [q('a', 1), q('b', 2), q('c', 3)] });
    expect(result.current).toBeNull();
  });
});

