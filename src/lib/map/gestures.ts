/**
 * Region Dossier gestures (§5): a double right-click (two `contextmenu` events within 500 ms and
 * 12 px) on desktop and a touch long-press on mobile both open the dossier at the pointer.
 * Pure detectors; the map host wires them to native DOM events on the canvas (never MapLibre's
 * map `contextmenu`, which its HandlerManager drops whenever a camera call lands between the press
 * and the release, and which MapLibre 6 also fires for every touch long-press; round 8).
 * Owner: map-engine. Unit-tested.
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

/** Right mouse button (`MouseEvent.button`). */
const RIGHT = 2;

export interface DoubleRightGesture {
  /** Native `mousedown` on the map canvas. */
  down(x: number, y: number, button: number): void;
  /** Native `mousemove` (window: a drag may leave the canvas). */
  move(x: number, y: number): void;
  /** Native `mouseup` (window). */
  up(button: number): void;
  /** Native `contextmenu` on the map canvas (`timeStamp` = the event's own time). */
  contextmenu(x: number, y: number, timeStamp: number): void;
  /** Forget a pending first click and any press in progress. */
  reset(): void;
}

/**
 * The double right-click from native events. A right-DRAG (rotate/pitch) is never a click: where
 * the platform fires `contextmenu` at the press (Linux, macOS) it is held until the release and
 * dropped if the pointer moved more than the slop meanwhile; where it fires after the release
 * (Windows) it is dropped when that press was a drag. Event times are the events' own timestamps,
 * so a busy main thread that dispatches the pair late does not split it.
 */
export function createDoubleRightGesture(onDouble: (x: number, y: number) => void, ms = DOUBLE_RIGHT_MS, slopPx = DOUBLE_RIGHT_SLOP_PX): DoubleRightGesture {
  let detector = createDoubleRightClick(ms, slopPx);
  /** The right button is held: where it went down, and whether it has dragged since. */
  let press: { x: number; y: number; dragged: boolean } | null = null;
  /** A `contextmenu` that arrived while the right button was held (decided at the release). */
  let held: { x: number; y: number; t: number } | null = null;
  /** The press that just ended was a drag (its `contextmenu` may still follow, Windows). */
  let afterDrag = false;
  const feed = (x: number, y: number, t: number) => {
    if (detector(x, y, t)) onDouble(x, y);
  };
  // A fresh detector: no pending first click survives a drag.
  const forget = () => void (detector = createDoubleRightClick(ms, slopPx));
  return {
    down(x, y, button) {
      if (button !== RIGHT) return;
      press = { x, y, dragged: false };
      held = null;
      afterDrag = false;
    },
    move(x, y) {
      if (!press || press.dragged) return;
      if (Math.hypot(x - press.x, y - press.y) > slopPx) {
        press.dragged = true;
        forget();
      }
    },
    up(button) {
      if (button !== RIGHT || !press) return;
      const p = press;
      press = null;
      afterDrag = p.dragged;
      const h = held;
      held = null;
      if (h && !p.dragged) feed(h.x, h.y, h.t);
    },
    contextmenu(x, y, t) {
      if (press) {
        held = { x, y, t };
        return;
      }
      if (afterDrag) {
        afterDrag = false;
        return;
      }
      feed(x, y, t);
    },
    reset() {
      press = null;
      held = null;
      afterDrag = false;
      forget();
    },
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
