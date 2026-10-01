/**
 * One queue for every unit of GPU-blocking start-up work on the map (perf B2, visual-qa R2-M6):
 * mounting the feature modules, creating the deck device, the first instance of each deck layer
 * class and the first draw of each MapLibre layer type added by a feature. Each unit runs alone in
 * a quiet slot (idle main thread, then a drained GPU queue) so one program link never waits behind
 * queued map frames, and never several links in one task.
 *
 * Progress guarantee: a slot that has not come within `maxWaitMs` (a main thread or software GPU
 * that is never idle) admits the next unit anyway, so admission always advances by at least one
 * unit per `maxWaitMs`. Admissions are plain state updates rendered by React in time slices
 * (`startTransition` in the requesters) — never `flushSync`, which once produced a 6 s task.
 *
 * `pending` (published to `useAdmissionStore`) counts the units still waiting: while it is > 0 the
 * HUD must not present fetched entity counts as drawn. Owner: map-engine. Pure and unit-tested.
 */
import { create } from 'zustand';
import type { DrainTimers } from './gpu-drain';

export interface AdmissionRequester {
  /** Stable id (diagnostics and tie-breaking). */
  id: string;
  /** Lower runs first; equal priorities alternate. */
  priority: number;
  /** Units of work waiting (0 = nothing to admit). */
  pending(): number;
  /** Admit exactly one unit. */
  admitOne(): void;
}

export interface AdmissionScheduler {
  /** Add a requester; returns unregister. */
  register(r: AdmissionRequester): () => void;
  /** A requester's pending work changed: schedule a slot if needed and republish the count. */
  kick(): void;
  /** Units waiting across all requesters. */
  pending(): number;
  /** Stop scheduling (map unmount). */
  dispose(): void;
}

export interface SchedulerOptions {
  /** Run `cb` in the next quiet slot; returns cancel. */
  slot(cb: () => void): () => void;
  /** Longest wait for a slot before the next unit is admitted anyway. */
  maxWaitMs: number;
  timers: Pick<DrainTimers, 'setTimeout' | 'clearTimeout'>;
  /** Called with the pending total whenever it may have changed. */
  onPending?(n: number): void;
}

/** Default progress guarantee: at least one admission every 2 s, whatever the load. */
export const ADMISSION_MAX_WAIT_MS = 2000;

export function createAdmissionScheduler(o: SchedulerOptions): AdmissionScheduler {
  const requesters: AdmissionRequester[] = [];
  const lastServed = new Map<string, number>();
  let serial = 0;
  let cancelSlot: (() => void) | null = null;
  let deadline: unknown = null;
  let scheduled = false;
  let disposed = false;
  let published = -1;

  const pending = () => requesters.reduce((n, r) => n + Math.max(0, r.pending()), 0);
  const publish = () => {
    const n = pending();
    if (n !== published) {
      published = n;
      o.onPending?.(n);
    }
  };
  const pick = (): AdmissionRequester | null => {
    let best: AdmissionRequester | null = null;
    for (const r of requesters) {
      if (r.pending() <= 0) continue;
      if (!best || r.priority < best.priority || (r.priority === best.priority && (lastServed.get(r.id) ?? 0) < (lastServed.get(best.id) ?? 0))) best = r;
    }
    return best;
  };
  const clear = () => {
    cancelSlot?.();
    cancelSlot = null;
    if (deadline !== null) o.timers.clearTimeout(deadline);
    deadline = null;
    scheduled = false;
  };
  const run = () => {
    if (!scheduled || disposed) return;
    clear();
    const r = pick();
    if (r) {
      lastServed.set(r.id, ++serial);
      r.admitOne();
    }
    publish();
    kick();
  };
  function kick() {
    if (disposed) return;
    publish();
    if (scheduled || !pick()) return;
    scheduled = true;
    deadline = o.timers.setTimeout(run, o.maxWaitMs);
    cancelSlot = o.slot(run);
  }
  return {
    register(r) {
      requesters.push(r);
      kick();
      return () => {
        const i = requesters.indexOf(r);
        if (i >= 0) requesters.splice(i, 1);
        lastServed.delete(r.id);
        if (!pick()) clear();
        publish();
      };
    },
    kick,
    pending,
    dispose() {
      disposed = true;
      clear();
      requesters.length = 0;
      o.onPending?.(0);
    },
  };
}

interface AdmissionStoreState {
  scheduler: AdmissionScheduler | null;
  /** Start-up units still waiting for a slot (features, deck device, layer classes/types). */
  pending: number;
  setScheduler(s: AdmissionScheduler | null): void;
  setPending(n: number): void;
}

/** UI state only: which scheduler serves the mounted map, and how much is still queued. */
export const useAdmissionStore = create<AdmissionStoreState>((set) => ({
  scheduler: null,
  pending: 0,
  setScheduler: (scheduler) => set({ scheduler }),
  setPending: (pending) => set({ pending }),
}));

/** True while some map start-up work is still queued (entities fetched may not be drawn yet). */
export const useDrawPending = (): boolean => useAdmissionStore((s) => s.pending > 0);
