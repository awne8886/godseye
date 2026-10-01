/**
 * Wall-clock-aligned ticks. Layers that redraw once per second (satellites here; aviation's dead
 * reckoning can use the same helper) publish on the same Unix-second boundaries, so the map redraws
 * once per second instead of once per layer at arbitrary phases. Pure scheduling, no React.
 * Owner: layers-space (candidate for src/lib/map/ — see the round-4 report).
 */

/** The first `periodMs` boundary (aligned on Unix ms 0) strictly after `now`. */
export function nextBoundary(now: number, periodMs = 1000): number {
  return (Math.floor(now / periodMs) + 1) * periodMs;
}

export interface AlignedTickOptions {
  /** Distance between ticks; boundaries are multiples of it since the Unix epoch. */
  periodMs: number;
  /** Call `request(at)` this long BEFORE boundary `at` (work that must be ready at the boundary). */
  leadMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Calls `request(at)` for every boundary `at`, `leadMs` ahead of it, until the returned stop
 * function is called. Each boundary is requested exactly once, even when a timer fires late.
 */
export function startAlignedTicks(request: (at: number) => void, opts: AlignedTickOptions): () => void {
  const { periodMs, leadMs = 0 } = opts;
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let handle: unknown;
  let stopped = false;
  let last = -Infinity;
  const schedule = () => {
    if (stopped) return;
    const t = now();
    // The next boundary after both now and the last one handled: never twice, never in the past.
    const at = nextBoundary(Math.max(t, last), periodMs);
    handle = setTimer(() => {
      if (stopped) return;
      last = at;
      request(at);
      schedule();
    }, Math.max(0, at - leadMs - t));
  };
  schedule();
  return () => {
    stopped = true;
    clearTimer(handle);
  };
}

/**
 * Holds a value until its wall-clock time and then hands it to `publish` — the newest value wins
 * (an older pending one is dropped). Values whose time has passed are published at once.
 */
export function createBoundaryPublisher<T>(
  publish: (value: T) => void,
  opts: Pick<AlignedTickOptions, 'now' | 'setTimer' | 'clearTimer'> = {},
): { offer: (value: T, at: number) => void; cancel: () => void } {
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let handle: unknown = null;
  let pendingAt = -Infinity;
  const cancel = () => {
    if (handle !== null) clearTimer(handle);
    handle = null;
  };
  return {
    offer(value, at) {
      if (at < pendingAt && handle !== null) return; // an older frame arrived after a newer one
      cancel();
      const wait = at - now();
      if (wait <= 0) {
        pendingAt = -Infinity;
        publish(value);
        return;
      }
      pendingAt = at;
      handle = setTimer(() => {
        handle = null;
        pendingAt = -Infinity;
        publish(value);
      }, wait);
    },
    cancel,
  };
}
