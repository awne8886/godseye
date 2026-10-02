import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDoubleRightClick, createDoubleRightGesture, createLongPress, DOUBLE_RIGHT_MS, DOUBLE_RIGHT_SLOP_PX, LONG_PRESS_MS } from './gestures';

describe('double right-click', () => {
  it('fires on the second right-click within 500 ms and 12 px', () => {
    const d = createDoubleRightClick();
    expect(d(100, 100, 1000)).toBe(false);
    expect(d(108, 108, 1000 + DOUBLE_RIGHT_MS)).toBe(true); // 11.3 px, exactly 500 ms
  });

  it('does not fire when too slow or too far, and restarts from the latest click', () => {
    const d = createDoubleRightClick();
    expect(d(0, 0, 0)).toBe(false);
    expect(d(0, 0, DOUBLE_RIGHT_MS + 1)).toBe(false); // too slow → becomes the new first click
    expect(d(DOUBLE_RIGHT_SLOP_PX + 1, 0, DOUBLE_RIGHT_MS + 100)).toBe(false); // too far
    expect(d(DOUBLE_RIGHT_SLOP_PX + 1, 0, DOUBLE_RIGHT_MS + 200)).toBe(true);
  });

  it('needs a fresh pair after firing (a triple click opens once)', () => {
    const d = createDoubleRightClick();
    d(0, 0, 0);
    expect(d(0, 0, 100)).toBe(true);
    expect(d(0, 0, 200)).toBe(false);
  });
});

describe('double right-click from native canvas events (round 8)', () => {
  const RIGHT = 2;
  /** Linux/macOS: `contextmenu` fires at the press, between mousedown and mouseup. */
  const pressFirst = (g: ReturnType<typeof createDoubleRightGesture>, x: number, y: number, t: number) => {
    g.down(x, y, RIGHT);
    g.contextmenu(x, y, t);
    g.up(RIGHT);
  };
  /** Windows: `contextmenu` fires after the release. */
  const releaseFirst = (g: ReturnType<typeof createDoubleRightGesture>, x: number, y: number, t: number) => {
    g.down(x, y, RIGHT);
    g.up(RIGHT);
    g.contextmenu(x, y, t);
  };

  it.each([
    ['contextmenu at the press (Linux, macOS)', pressFirst],
    ['contextmenu after the release (Windows)', releaseFirst],
  ])('%s: a pair within 500 ms and 12 px opens once, at the second click', (_, click) => {
    const onDouble = vi.fn();
    const g = createDoubleRightGesture(onDouble);
    click(g, 100, 100, 1000);
    expect(onDouble).not.toHaveBeenCalled();
    click(g, 104, 102, 1040);
    expect(onDouble).toHaveBeenCalledTimes(1);
    expect(onDouble).toHaveBeenCalledWith(104, 102);
    click(g, 104, 102, 1080); // a third click starts a new pair
    expect(onDouble).toHaveBeenCalledTimes(1);
  });

  it('uses the events’ own timestamps: a pair dispatched late by a busy main thread still pairs', () => {
    const onDouble = vi.fn();
    const g = createDoubleRightGesture(onDouble);
    // The events were created 40 ms apart; the listener ran ~25 ms late each time (round 8 trace).
    pressFirst(g, 300, 200, 5000);
    pressFirst(g, 303, 201, 5040);
    expect(onDouble).toHaveBeenCalledTimes(1);
  });

  it('nothing outside this detector can drop the first click (no MapLibre reset between press and release)', () => {
    const onDouble = vi.fn();
    const g = createDoubleRightGesture(onDouble);
    g.down(50, 50, RIGHT);
    g.contextmenu(50, 50, 100);
    // (A camera call here made MapLibre's HandlerManager forget its held contextmenu.)
    g.up(RIGHT);
    pressFirst(g, 52, 51, 300);
    expect(onDouble).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['at the press', pressFirst],
    ['after the release', releaseFirst],
  ])('a right-drag (rotate) is not a click, %s', (_, click) => {
    const onDouble = vi.fn();
    const g = createDoubleRightGesture(onDouble);
    // Drag 1: press, move beyond the slop, release.
    g.down(100, 100, RIGHT);
    if (click === pressFirst) g.contextmenu(100, 100, 1000);
    g.move(100 + DOUBLE_RIGHT_SLOP_PX + 30, 100);
    g.up(RIGHT);
    if (click === releaseFirst) g.contextmenu(130, 100, 1100);
    // A click right after, where the drag started: only the first of a new pair (the next completes it).
    click(g, 101, 100, 1200);
    expect(onDouble).not.toHaveBeenCalled();
    click(g, 101, 100, 1400);
    expect(onDouble).toHaveBeenCalledTimes(1);
    // A click, then a right-drag starting at the same place: the drag does not complete the pair.
    click(g, 300, 300, 3000);
    g.down(301, 300, RIGHT);
    if (click === pressFirst) g.contextmenu(301, 300, 3100);
    g.move(301, 300 + DOUBLE_RIGHT_SLOP_PX + 1);
    g.up(RIGHT);
    if (click === releaseFirst) g.contextmenu(301, 313, 3150);
    expect(onDouble).toHaveBeenCalledTimes(1);
  });

  it('a jitter within the slop is still a click; other buttons and a reset are ignored / forget the pending click', () => {
    const onDouble = vi.fn();
    const g = createDoubleRightGesture(onDouble);
    g.down(0, 0, RIGHT);
    g.contextmenu(0, 0, 10);
    g.move(5, 5);
    g.up(RIGHT);
    g.down(0, 0, 0); // left button: no effect on the pair
    g.up(0);
    pressFirst(g, 2, 2, 200);
    expect(onDouble).toHaveBeenCalledTimes(1);
    pressFirst(g, 2, 2, 1000);
    g.reset(); // e.g. a map tool was armed
    pressFirst(g, 2, 2, 1100);
    expect(onDouble).toHaveBeenCalledTimes(1);
  });
});

describe('touch long-press', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after 600 ms held still', () => {
    const onPress = vi.fn();
    const lp = createLongPress(onPress);
    lp.down(50, 60, 1);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onPress).not.toHaveBeenCalled();
    lp.move(55, 64, 1); // 6.4 px: within slop
    vi.advanceTimersByTime(1);
    expect(onPress).toHaveBeenCalledWith(50, 60);
    lp.up();
    vi.advanceTimersByTime(1000);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('cancels on lift, on drag beyond 12 px, and on a second finger (pinch)', () => {
    const onPress = vi.fn();
    const lp = createLongPress(onPress);
    lp.down(0, 0, 1);
    lp.up();
    lp.down(0, 0, 2);
    lp.move(0, 13, 2);
    lp.up();
    lp.down(0, 0, 3);
    lp.down(100, 100, 4);
    vi.advanceTimersByTime(2000);
    expect(onPress).not.toHaveBeenCalled();
    lp.cancel();
    lp.down(0, 0, 5);
    lp.move(100, 0, 99); // another pointer moving does not cancel this one
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
