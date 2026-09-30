/**
 * Region Dossier gestures (§5): a double right-click (two `contextmenu` events within 500 ms and
 * 12 px) on desktop and a touch long-press on mobile both open the dossier at the pointer.
 * Pure detectors; the map host wires them to DOM events. Owner: map-engine. Unit-tested.
 */

export const DOUBLE_RIGHT_MS = 500;
export const DOUBLE_RIGHT_SLOP_PX = 12;
export const LONG_PRESS_MS = 600;
export const LONG_PRESS_SLOP_PX = 12;

/** Returns a detector: call it on every right-click; it returns true on the second of a pair. */
export function createDoubleRightClick(ms = DOUBLE_RIGHT_MS, slopPx = DOUBLE_RIGHT_SLOP_PX) {
  let last: { x: number; y: number; t: number } | null = null;
  return (x: number, y: number, t: number): boolean => {
    if (last && t - last.t <= ms && t >= last.t && Math.hypot(x - last.x, y - last.y) <= slopPx) {
      last = null;
      return true;
    }
    last = { x, y, t };
    return false;
  };
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * Single-finger long-press: fires `onPress(x, y)` after `ms` unless the finger lifts, moves more
 * than `slopPx`, or a second finger lands (pinch).
 */
export function createLongPress(onPress: (x: number, y: number) => void, ms = LONG_PRESS_MS, slopPx = LONG_PRESS_SLOP_PX, timers: Timers = defaultTimers) {
  let start: { x: number; y: number; id: number } | null = null;
  let timer: unknown = null;
  let fingers = 0;
  const cancel = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
    start = null;
  };
  return {
    down(x: number, y: number, pointerId: number) {
      fingers++;
      if (fingers > 1) return cancel();
      start = { x, y, id: pointerId };
      timer = timers.set(() => {
        timer = null;
        const s = start;
        start = null;
        if (s) onPress(s.x, s.y);
      }, ms);
    },
    move(x: number, y: number, pointerId: number) {
      if (start && pointerId === start.id && Math.hypot(x - start.x, y - start.y) > slopPx) cancel();
    },
    up() {
      fingers = Math.max(0, fingers - 1);
      cancel();
    },
    cancel() {
      fingers = 0;
      cancel();
    },
  };
}
