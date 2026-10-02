/**
 * One queue for every unit of GPU-blocking start-up work on the map (perf B2, visual-qa R2-M6):
 * creating the deck device, the first instance of each deck layer class and the first draw of each
 * MapLibre layer type added by a feature. Each unit runs alone in a quiet slot (idle main thread,
 * then a drained GPU queue) so one program link never waits behind queued map frames, and never
 * several links in one task. The feature modules themselves (their fetches) are not queued: they
 * mount once the style is parsed, so data downloads overlap the GL start-up (perf m-l); only their
 * GPU work waits here, behind the basemap's first painted frame (`ready`).
 *
 * Progress guarantee: a slot that has not come within `maxWaitMs` (a main thread or software GPU
 * that is never idle) admits the next unit anyway, so admission always advances by at least one
 * unit per `maxWaitMs`. Admissions are plain state updates rendered by React in time slices
 * (`startTransition` in the requesters) — never `flushSync`, which once produced a 6 s task.
 *
 * Focus work (what the user asked for: a `?route=` / `?flight=` planned arc, a drawn shape; see
 * `focus.ts`) runs first and has a requester-level `maxWaitMs` (FOCUS_MAX_WAIT_MS): on a software
 * GPU (SwiftShader: CI, Lighthouse, GPU-less machines) the quiet slot never comes — 0 of 68 fences
 * signalled while the globe repainted — so the full wait was pure latency in front of the route.
 * A shorter wait arriving while a longer one is armed pulls the deadline in; a deadline armed for
 * a unit that is no longer first re-arms for the next unit's own wait.
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
  /**
   * Longest wait for a quiet slot while this requester's unit is next (ms). Defaults to the
   * scheduler's `maxWaitMs` and is never longer than it.
   */
  maxWaitMs?: number;
  /** Units of work waiting (0 = nothing to admit). */
  pending(): number;
  /**
   * Whether the waiting units may be admitted yet (default: always). A requester that is not ready
   * still counts in `pending` (the HUD keeps saying RECEIVED + DRAWING) but gets no slot; call
   * `kick()` when it becomes ready. GPU work waits for the basemap's first painted frame this way
   * while the data behind it is already being fetched (perf m-l).
   */
  ready?(): boolean;
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
  timers: Pick<DrainTimers, 'setTimeout' | 'clearTimeout' | 'now'>;
  /** Called with the pending total whenever it may have changed. */
  onPending?(n: number): void;
  /** Called with the requester id of every admitted unit (diagnostics). */
  onAdmit?(id: string): void;
}

/** Default progress guarantee: at least one admission every 2 s, whatever the load. */
export const ADMISSION_MAX_WAIT_MS = 2000;
/**
 * Wait for focus units (the user's route/flight/drawing): long enough for a real GPU to finish the
 * frame in flight (a few ms there), short enough that a GPU that never drains does not hold the
 * user's own request back for seconds.
 */
export const FOCUS_MAX_WAIT_MS = 250;

export function createAdmissionScheduler(o: SchedulerOptions): AdmissionScheduler {
  const requesters: AdmissionRequester[] = [];
  const lastServed = new Map<string, number>();
  let serial = 0;
  let cancelSlot: (() => void) | null = null;
  let deadline: unknown = null;
  let scheduled = false;
  let disposed = false;
  let published = -1;
  /** When the current slot was requested, and the wait its deadline is armed for. */
  let slotStart = 0;
  let armedWait = 0;

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
      if (r.pending() <= 0 || (r.ready && !r.ready())) continue;
      if (!best || r.priority < best.priority || (r.priority === best.priority && (lastServed.get(r.id) ?? 0) < (lastServed.get(best.id) ?? 0))) best = r;
    }
    return best;
  };
  const waitOf = (r: AdmissionRequester): number => Math.max(0, Math.min(o.maxWaitMs, r.maxWaitMs ?? o.maxWaitMs));
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
      o.onAdmit?.(r.id);
      try {
        r.admitOne();
      } catch (e) {
        // One failing unit must not stall the queue (and leave the header on ENTITIES LOADING).
        console.error('[godseye] admission unit failed', e);
      }
    }
    publish();
    kick();
  };
  /** (Re-)arm the deadline `wait` ms after the current slot was requested. */
  const arm = (wait: number) => {
    if (deadline !== null) o.timers.clearTimeout(deadline);
    armedWait = wait;
    deadline = o.timers.setTimeout(onDeadline, Math.max(0, slotStart + wait - o.timers.now()));
  };
  function onDeadline() {
    deadline = null;
    if (!scheduled || disposed) return;
    // The unit the deadline was armed for may have gone or lost its place: the unit first now keeps
    // its own wait (work that asked for a quiet slot is not admitted early on another's deadline).
    const r = pick();
    if (r && o.timers.now() < slotStart + waitOf(r)) arm(waitOf(r));
    else run();
  }
  function kick() {
    if (disposed) return;
    publish();
    const r = pick();
    if (!r) return;
    if (scheduled) {
      // Focus work queued behind a slot armed for a longer wait: pull the deadline in.
      if (waitOf(r) < armedWait) arm(waitOf(r));
      return;
    }
    scheduled = true;
    slotStart = o.timers.now();
    arm(waitOf(r));
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
  /** Start-up units still waiting for a slot (deck device, layer classes/types), ready or not. */
  pending: number;
  /**
   * Admitted entity layers the map has not drawn yet (visual-qa R3-M2): deck layers whose MapLibre
   * layer group is not in the style. Only the deck overlay produces this today; native layers are
   * drawn by MapLibre as soon as they are added (their first draw is gated by `pending` instead).
   */
  undrawn: number;
  /** Per producer (currently only `deck`); `undrawn` is their sum. */
  undrawnBy: Record<string, number>;
  setScheduler(s: AdmissionScheduler | null): void;
  setPending(n: number): void;
  setUndrawn(producer: string, n: number): void;
}

/** UI state only: which scheduler serves the mounted map, and how much is still queued. */
export const useAdmissionStore = create<AdmissionStoreState>((set) => ({
  scheduler: null,
  pending: 0,
  undrawn: 0,
  undrawnBy: {},
  setScheduler: (scheduler) => set({ scheduler }),
  setPending: (pending) => set({ pending }),
  setUndrawn: (producer, n) =>
    set((s) => {
      if ((s.undrawnBy[producer] ?? 0) === n) return s;
      const undrawnBy = { ...s.undrawnBy, [producer]: n };
      return { undrawnBy, undrawn: Object.values(undrawnBy).reduce((a, b) => a + b, 0) };
    }),
}));

/** Header honesty: fetched entities are not "drawn" while start-up work is queued or layers are not on the map. */
export function drawPending(s: Pick<AdmissionStoreState, 'pending' | 'undrawn'>): boolean {
  return s.pending > 0 || s.undrawn > 0;
}

/** True while some fetched entities may not be drawn yet (queued start-up work or layers not on the map). */
export const useDrawPending = (): boolean => useAdmissionStore(drawPending);
