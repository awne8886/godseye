import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDoubleRightClick, createLongPress, DOUBLE_RIGHT_MS, DOUBLE_RIGHT_SLOP_PX, LONG_PRESS_MS } from './gestures';

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
