// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STYLE_EVENT } from '@/components/hud/style-engine';
import { afterIdle, useAfterIdle, useSticky, yieldToMain } from './defer';
import { onceStyleLoaded, styleParsed, type ReadyMap } from './ready';
import { getStyleVersion, MAP_STYLE_EVENT, useStyleVersion } from './style-version';

function fakeMap(loaded: boolean) {
  const handlers = new Map<string, Set<() => void>>();
  const state = { loaded };
  const map: ReadyMap & { fire: (t: string) => void; state: typeof state; count: () => number } = {
    state,
    isStyleLoaded: () => state.loaded,
    on: (t, fn) => {
      if (!handlers.has(t)) handlers.set(t, new Set());
      handlers.get(t)!.add(fn);
    },
    off: (t, fn) => void handlers.get(t)?.delete(fn),
    fire: (t) => handlers.get(t)?.forEach((fn) => fn()),
    count: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
  };
  return map;
}

describe('map readiness without idle', () => {
  it('is ready immediately after load when the style reports loaded', () => {
    const ready = vi.fn();
    onceStyleLoaded(fakeMap(true), ready);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('otherwise waits for style/source data to report loaded, once, then unsubscribes', () => {
    const map = fakeMap(false);
    const ready = vi.fn();
    onceStyleLoaded(map, ready);
    map.fire('sourcedata');
    expect(ready).not.toHaveBeenCalled();
    map.state.loaded = true;
    map.fire('styledata');
    map.fire('sourcedata');
    expect(ready).toHaveBeenCalledTimes(1);
    expect(map.count()).toBe(0);
  });

  it('can be cancelled', () => {
    const map = fakeMap(false);
    const ready = vi.fn();
    const cancel = onceStyleLoaded(map, ready);
    cancel();
    map.state.loaded = true;
    map.fire('styledata');
    expect(ready).not.toHaveBeenCalled();
  });

  it('knows when the style JSON is parsed even if style.load already fired', () => {
    expect(styleParsed({ style: { _loaded: true } })).toBe(true);
    expect(styleParsed({ style: { _loaded: false } })).toBe(false);
    expect(styleParsed(null)).toBe(false);
  });
});

describe('style version', () => {
  it('uses the HUD style event name', () => {
    expect(MAP_STYLE_EVENT).toBe(STYLE_EVENT);
  });

  it('bumps on godseye:style and re-renders subscribers', () => {
    const { result, unmount } = renderHook(() => useStyleVersion());
    const before = result.current;
    act(() => {
      window.dispatchEvent(new CustomEvent(STYLE_EVENT));
    });
    expect(result.current).toBe(before + 1);
    expect(getStyleVersion()).toBe(before + 1);
    unmount();
    window.dispatchEvent(new CustomEvent(STYLE_EVENT)); // no listener left: no bump
    expect(getStyleVersion()).toBe(before + 1);
  });
});

describe('deferral helpers', () => {
  afterEach(() => vi.useRealTimers());

  it('afterIdle uses requestIdleCallback with a timeout, or a short timer without it', () => {
    const ric = vi.fn((cb: () => void) => {
      cb();
      return 7;
    });
    const cic = vi.fn();
    const cb = vi.fn();
    afterIdle(cb, 1500, { requestIdleCallback: ric, cancelIdleCallback: cic })();
    expect(ric).toHaveBeenCalledWith(cb, { timeout: 1500 });
    expect(cic).toHaveBeenCalledWith(7);
    vi.useFakeTimers();
    const later = vi.fn();
    afterIdle(later, 1500, {});
    vi.advanceTimersByTime(199);
    expect(later).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(later).toHaveBeenCalled();
  });

  it('useAfterIdle flips only after the condition and an idle period, and stays on', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ when }) => useAfterIdle(when, 1000), { initialProps: { when: false } });
    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current).toBe(false);
    rerender({ when: true });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
    rerender({ when: false });
    expect(result.current).toBe(true);
  });

  it('useSticky remembers a value that was ever true', () => {
    const { result, rerender } = renderHook(({ v }) => useSticky(v), { initialProps: { v: false } });
    expect(result.current).toBe(false);
    rerender({ v: true });
    rerender({ v: false });
    expect(result.current).toBe(true);
  });

  it('yieldToMain resolves', async () => {
    await expect(yieldToMain()).resolves.toBeUndefined();
  });
});
