/**
 * Start non-critical work after first paint: once a condition holds (map `load`), wait for the
 * browser to be idle (`requestIdleCallback`, with a timeout so it always happens), then flip.
 * Also `yieldToMain()` for chunking long loops into < 50 ms tasks. Owner: map-engine. Unit-tested.
 */
import { useEffect, useState } from 'react';

type IdleWindow = {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/** Run `cb` when the main thread is idle (≤ `timeoutMs` later). Returns a cancel function. */
export function afterIdle(cb: () => void, timeoutMs: number, w: IdleWindow = globalThis as IdleWindow): () => void {
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(cb, { timeout: timeoutMs });
    return () => w.cancelIdleCallback?.(id);
  }
  // Safari has no requestIdleCallback: a macrotask after the current frame is the closest.
  const t = setTimeout(cb, Math.min(timeoutMs, 200));
  return () => clearTimeout(t);
}

/** True once `when` has been true and the browser went idle afterwards; stays true. */
export function useAfterIdle(when: boolean, timeoutMs: number): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!when || done) return;
    return afterIdle(() => setDone(true), timeoutMs);
  }, [when, done, timeoutMs]);
  return done;
}

/** True once `value` has been true (e.g. "some deck layer exists": keep the overlay afterwards). */
export function useSticky(value: boolean): boolean {
  const [seen, setSeen] = useState(value);
  // Adjusting state while rendering (React's documented pattern for derived "has ever" state).
  if (value && !seen) setSeen(true);
  return seen || value;
}

/** Yield to the event loop so input and rendering can run between chunks of work. */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof s?.yield === 'function') return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
