import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostHover, type HostHoverOptions } from './host-hover';
import { HOVER_PICK_MIN_INTERVAL_MS, HOVER_PICK_PRESS_QUIET_MS } from './hover-pick';

/** requestAnimationFrame stand-in: callbacks run when the test flushes a frame. */
function fakeFrames() {
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    request: (cb: () => void) => {
      const id = next++;
      queue.set(id, cb);
      return id;
    },
    cancel: (id: unknown) => void queue.delete(id as number),
    flush() {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb();
    },
    pending: () => queue.size,
  };
}

function setup(over: Partial<HostHoverOptions> = {}, pickCostMs = 0) {
  const frames = fakeFrames();
  const cursor = vi.fn();
  const pointer = vi.fn();
  const picks: [number, number][] = [];
  const state = { moving: false, suspended: false };
  const hover = createHostHover({
    frames,
    timers: { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>), now: () => Date.now() },
    cursor,
    zoom: () => 3,
    pick: (x, y) => {
      picks.push([x, y]);
      // The CPU hit-testers' cost: the clock moves on while the pick runs.
      if (pickCostMs) vi.setSystemTime(Date.now() + pickCostMs);
      return x > 100;
    },
    pointer,
    moving: () => state.moving,
    suspended: () => state.suspended,
    ...over,
  });
  /** One pointer move per 16 ms frame. */
  const sweep = (n: number, at = (i: number) => ({ x: 10 + i, y: 20 }), buttons = 0) => {
    for (let i = 0; i < n; i++) {
      const p = at(i);
      hover.move({ ...p, lng: 200 + i * 0.01, lat: 10, buttons });
      frames.flush();
      vi.advanceTimersByTime(16);
    }
  };
  return { hover, frames, cursor, pointer, picks, state, sweep };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('host hover (round 8 perf: the CPU hover pick is budgeted, the readout is not)', () => {
  it('publishes the cursor on every frame but picks at most once per 100 ms, then once where the pointer rests', () => {
    const { cursor, picks, sweep } = setup();
    sweep(60); // ~1 s of continuous movement at 60 fps
    expect(cursor).toHaveBeenCalledTimes(60);
    // Longitudes are wrapped for the readout.
    expect(cursor.mock.calls[0]![0]).toEqual({ lng: -160, lat: 10, zoom: 3 });
    const during = picks.length;
    expect(during).toBeLessThanOrEqual(Math.ceil((60 * 16) / HOVER_PICK_MIN_INTERVAL_MS) + 1);
    expect(during).toBeGreaterThanOrEqual(5);
    // Trailing settle pick at the final position.
    vi.advanceTimersByTime(500);
    expect(picks.length).toBe(during + 1);
    expect(picks.at(-1)).toEqual([69, 20]);
    vi.advanceTimersByTime(5000);
    expect(picks.length).toBe(during + 1);
  });

  it('a 33 ms hit-test (the measured median) keeps hover picking to ≤ 25 % of the main thread', () => {
    const { picks, sweep } = setup({}, 33);
    const t0 = Date.now();
    sweep(120);
    const elapsed = Date.now() - t0;
    expect((picks.length * 33) / elapsed).toBeLessThanOrEqual(0.25 + 1e-9);
    // Before: one 33 ms pick per frame (120 of them).
    expect(picks.length).toBeLessThan(20);
  });

  it('only the last move of a frame counts (one readout and at most one pick per frame)', () => {
    const { hover, frames, cursor, picks } = setup();
    for (let i = 0; i < 5; i++) hover.move({ x: 200 + i, y: 50, lng: 0, lat: 0 });
    expect(frames.pending()).toBe(1);
    frames.flush();
    expect(cursor).toHaveBeenCalledTimes(1);
    expect(picks).toEqual([[204, 50]]);
  });

  it('no pick while a button is held or the camera moves; the readout continues', () => {
    const { cursor, picks, state, sweep } = setup();
    sweep(30, undefined, 2); // right-press drag
    state.moving = true;
    sweep(30, (i) => ({ x: 500 + i, y: 20 }));
    vi.advanceTimersByTime(1000);
    expect(picks).toEqual([]);
    expect(cursor).toHaveBeenCalledTimes(60);
  });

  it('a camera move under a resting pointer drops the trailing pick', () => {
    const { hover, picks, sweep } = setup();
    sweep(3);
    const n = picks.length;
    hover.cameraMoveStart();
    vi.advanceTimersByTime(1000);
    expect(picks.length).toBe(n);
  });

  it('an armed map tool: no picks and no pointer cursor', () => {
    const { picks, pointer, state, sweep } = setup();
    state.suspended = true;
    sweep(20, (i) => ({ x: 300 + i, y: 20 }));
    vi.advanceTimersByTime(1000);
    expect(picks).toEqual([]);
    expect(pointer).toHaveBeenCalled();
    expect(pointer.mock.calls.every(([hit]) => hit === false)).toBe(true);
  });

  it('a press holds hover picks for the double-click window, then the resting pick runs', () => {
    const { hover, picks, sweep } = setup();
    sweep(1);
    hover.press();
    sweep(5, (i) => ({ x: 400 + i, y: 20 }));
    const n = picks.length;
    vi.advanceTimersByTime(HOVER_PICK_PRESS_QUIET_MS / 2);
    expect(picks.length).toBe(n);
    vi.advanceTimersByTime(HOVER_PICK_PRESS_QUIET_MS);
    expect(picks.at(-1)).toEqual([404, 20]);
  });

  it('leaving the map clears the readout and the pointer and cancels the pending frame and pick', () => {
    const { hover, frames, cursor, pointer, picks, sweep } = setup();
    sweep(3, (i) => ({ x: 150 + i, y: 20 }));
    hover.move({ x: 900, y: 20, lng: 0, lat: 0 });
    hover.leave();
    expect(frames.pending()).toBe(0);
    expect(cursor).toHaveBeenLastCalledWith(null);
    expect(pointer).toHaveBeenLastCalledWith(false);
    const n = picks.length;
    vi.advanceTimersByTime(1000);
    expect(picks.length).toBe(n);
  });

  it('after dispose nothing runs', () => {
    const { hover, frames, cursor, picks } = setup();
    hover.move({ x: 1, y: 1, lng: 0, lat: 0 });
    hover.dispose();
    frames.flush();
    hover.move({ x: 2, y: 1, lng: 0, lat: 0 });
    frames.flush();
    vi.advanceTimersByTime(1000);
    expect(cursor).not.toHaveBeenCalled();
    expect(picks).toEqual([]);
  });
});
