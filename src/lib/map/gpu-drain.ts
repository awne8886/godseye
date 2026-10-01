/**
 * Wait for the GPU to finish the commands already queued, without blocking the main thread
 * (perf B2). WebGL calls that need an answer from the GPU process — `getProgramParameter` after a
 * link, `getParameter` during deck's device set-up, `getUniformBlockIndex` — block the main thread
 * until every earlier command (the map frames still being rasterised) has executed. On a software
 * renderer (SwiftShader: CI, Lighthouse, GPU-less machines) one globe frame takes hundreds of ms,
 * so a program link issued behind two frames blocked for 0.5–1.1 s in our traces, while the same
 * link on a drained queue took a few ms.
 *
 * `afterGpuDrain` inserts a WebGL2 fence and polls its status (non-blocking: Chrome answers from
 * a cached value updated between tasks) until the GPU has caught up, then runs `cb`. It never
 * waits longer than `timeoutMs` so the work it gates always happens. Slots are handed out one unit
 * at a time by the admission scheduler (`admission-scheduler.ts`). Owner: map-engine. Unit-tested.
 */
import { afterIdle } from './defer';

/** The WebGL2 subset used here (a real context, or a test double). */
export interface FenceGL {
  readonly SYNC_GPU_COMMANDS_COMPLETE: number;
  readonly SYNC_STATUS: number;
  readonly SIGNALED: number;
  fenceSync(condition: number, flags: number): unknown;
  getSyncParameter(sync: never, pname: number): unknown;
  deleteSync(sync: never): void;
  flush(): void;
  isContextLost(): boolean;
}

export interface DrainTimers {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const realTimers: DrainTimers = {
  now: () => performance.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Poll interval: one frame; the status only changes between tasks anyway. */
export const DRAIN_POLL_MS = 16;

/**
 * Run `cb` once the GPU has executed everything queued on `gl` so far (or after `timeoutMs`).
 * Without a usable context (none, lost, no fences) `cb` runs on the next macrotask. Returns cancel.
 */
export function afterGpuDrain(gl: FenceGL | null | undefined, cb: () => void, timeoutMs: number, t: DrainTimers = realTimers): () => void {
  let cancelled = false;
  let timer: unknown;
  let sync: unknown = null;
  const release = () => {
    if (sync && gl && !gl.isContextLost()) gl.deleteSync(sync as never);
    sync = null;
  };
  const finish = () => {
    release();
    if (!cancelled) cb();
  };
  try {
    if (gl && !gl.isContextLost() && typeof gl.fenceSync === 'function') {
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
    }
  } catch {
    sync = null;
  }
  if (!sync || !gl) {
    timer = t.setTimeout(finish, 0);
    return () => {
      cancelled = true;
      t.clearTimeout(timer);
    };
  }
  const start = t.now();
  const poll = () => {
    if (cancelled) return;
    let done = gl.isContextLost() || t.now() - start >= timeoutMs;
    if (!done) {
      try {
        done = gl.getSyncParameter(sync as never, gl.SYNC_STATUS) === gl.SIGNALED;
      } catch {
        done = true;
      }
    }
    if (done) finish();
    else timer = t.setTimeout(poll, DRAIN_POLL_MS);
  };
  timer = t.setTimeout(poll, 0);
  return () => {
    cancelled = true;
    t.clearTimeout(timer);
    release();
  };
}

/**
 * The quiet slot for one unit of GPU-blocking start-up work: the main thread is idle
 * (`requestIdleCallback`) and then the GPU has drained. Each phase is bounded by `timeoutMs`.
 */
export function afterQuietSlot(getGl: () => FenceGL | null | undefined, cb: () => void, timeoutMs: number): () => void {
  let cancelDrain: (() => void) | null = null;
  const cancelIdle = afterIdle(() => {
    cancelDrain = afterGpuDrain(getGl(), cb, timeoutMs);
  }, timeoutMs);
  return () => {
    cancelIdle();
    cancelDrain?.();
  };
}

/** The map canvas's existing WebGL2 context (getContext returns the one already created). */
export function canvasGl(canvas: HTMLCanvasElement | null | undefined): FenceGL | null {
  return (canvas?.getContext('webgl2') as unknown as FenceGL | null) ?? null;
}
