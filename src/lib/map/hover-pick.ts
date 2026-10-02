/**
 * Hover picking budget (perf round-5 m-h). In interleaved mode deck's own pointer handling ran a
 * GPU hover pick (a picking render + synchronous readPixels) on EVERY frame the pointer moved: 40
 * picks in 23.7 s of hovering, 21.4 s of main thread on SwiftShader (536 ms each). The host now
 * owns deck's hover input (`detachDeckInput`) and asks for a hover pick through this gate:
 *
 *  - never while a button is held (drag, rotate, right-press) or the camera moves: a drag costs
 *    zero picks;
 *  - while the pointer keeps moving, at most one pick per `minIntervalMs` (≤ 10 Hz), and never more
 *    often than the measured pick cost allows (`maxDuty`: a 536 ms software-GPU pick runs at most
 *    every 2.1 s, a 2 ms hardware pick every 100 ms);
 *  - hover yields to clicks: for `pressQuietMs` after a press (the double-click window) a move only
 *    queues the resting pick, so a pick never lands between the two clicks of a double (right-)click;
 *  - once the pointer rests for `settleMs`, one pick at the final position (none if that is where
 *    the last pick ran), so the highlight and the cursor always end up right;
 *  - none at all while `suspended()` (a map tool such as DRAW is armed: a click adds a vertex, so
 *    a highlight would promise a selection the click never makes, and each software-GPU pick costs
 *    up to 536 ms of main thread). A move then clears any highlight left over, and a resting pick
 *    queued before the tool was armed is dropped (verification round 6).
 *
 * Click picking is untouched (the host's click router picks on demand). The CPU hit-testers and
 * native feature queries the host runs per frame for the cursor need no GPU and are not gated.
 * Owner: map-engine. Pure and unit-tested (fake timers).
 */

export const HOVER_PICK_MIN_INTERVAL_MS = 100;
export const HOVER_PICK_SETTLE_MS = 80;
/** Largest share of the main thread hover picking may take while the pointer moves. */
export const HOVER_PICK_MAX_DUTY = 0.25;
/** No hover pick this long after a press (the double-click / double-right-click window). */
export const HOVER_PICK_PRESS_QUIET_MS = 500;

export interface HoverPickTimers {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  now(): number;
}

export interface HoverPickOptions {
  /** Run one GPU hover pick at (x, y); returns how long it took (ms). */
  pick(x: number, y: number): number;
  /** The pointer left the map: clear deck's hover state (one pick at "nowhere"). */
  leave(): void;
  timers: HoverPickTimers;
  minIntervalMs?: number;
  settleMs?: number;
  maxDuty?: number;
  pressQuietMs?: number;
  /** True while hover picking is off altogether (a map tool is armed). Checked on every move and
   *  again when a resting pick comes due. */
  suspended?(): boolean;
}

export interface HoverPickGate {
  /** The pointer moved to (x, y); `blocked` = a button is held or the camera is moving. */
  move(x: number, y: number, blocked: boolean): void;
  /** A button was pressed or released (click, right-click, drag start/end). */
  press(): void;
  /** The pointer left the map. */
  leave(): void;
  /** Picks run so far (diagnostics). */
  picks(): number;
  dispose(): void;
}

const NOWHERE = { x: Number.NaN, y: Number.NaN };

export function createHoverPickGate(o: HoverPickOptions): HoverPickGate {
  const minInterval = o.minIntervalMs ?? HOVER_PICK_MIN_INTERVAL_MS;
  const settle = o.settleMs ?? HOVER_PICK_SETTLE_MS;
  const duty = o.maxDuty ?? HOVER_PICK_MAX_DUTY;
  const pressQuiet = o.pressQuietMs ?? HOVER_PICK_PRESS_QUIET_MS;
  let last = NOWHERE;
  /** Where the last pick ran (NOWHERE once the scene under the pointer may have changed). */
  let pickedAt = NOWHERE;
  /** Earliest time of the next pick (cost budget, interval, press quiet window). */
  let nextAllowed = Number.NEGATIVE_INFINITY;
  let trailing: unknown = null;
  let count = 0;
  let disposed = false;

  const same = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x === b.x && a.y === b.y;
  const cancelTrailing = () => {
    if (trailing !== null) o.timers.clearTimeout(trailing);
    trailing = null;
  };
  const run = (x: number, y: number) => {
    const t0 = o.timers.now();
    let cost = 0;
    try {
      cost = Math.max(0, o.pick(x, y));
    } catch {
      cost = 0; // a lost context or a deck mid-update: no hover this time
    }
    count++;
    pickedAt = { x, y };
    const end = Math.max(o.timers.now(), t0 + cost);
    nextAllowed = Math.max(nextAllowed, end + Math.max(minInterval, cost / duty - cost));
  };
  const armTrailing = () => {
    cancelTrailing();
    if (Number.isNaN(last.x) || same(last, pickedAt)) return;
    const wait = Math.max(settle, nextAllowed - o.timers.now());
    trailing = o.timers.setTimeout(() => {
      trailing = null;
      if (disposed || Number.isNaN(last.x) || same(last, pickedAt) || o.suspended?.()) return;
      run(last.x, last.y);
    }, wait);
  };

  const clear = () => {
    cancelTrailing();
    last = NOWHERE;
    pickedAt = NOWHERE;
    try {
      o.leave();
    } catch {
      /* nothing to clear */
    }
  };

  return {
    move(x, y, blocked) {
      if (disposed) return;
      if (o.suspended?.()) {
        // A map tool owns the pointer: no pick, and no highlight left from before it was armed.
        clear();
        return;
      }
      last = { x, y };
      if (blocked) {
        // Held button or moving camera: no pick now, and the scene under the pointer changes.
        cancelTrailing();
        pickedAt = NOWHERE;
        return;
      }
      if (same(last, pickedAt)) return; // nothing new under a pointer that did not move
      if (o.timers.now() >= nextAllowed) {
        cancelTrailing();
        run(x, y);
        return;
      }
      armTrailing();
    },
    press() {
      if (disposed) return;
      nextAllowed = Math.max(nextAllowed, o.timers.now() + pressQuiet);
      if (trailing !== null) armTrailing();
    },
    leave() {
      if (disposed) return;
      clear();
    },
    picks: () => count,
    dispose() {
      disposed = true;
      cancelTrailing();
    },
  };
}
