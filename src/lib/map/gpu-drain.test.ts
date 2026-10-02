import { describe, expect, it, vi } from 'vitest';
import { afterGpuDrain, DRAIN_POLL_MS, type DrainTimers, type FenceGL } from './gpu-drain';

/** Deterministic timers: a manual clock and a queue of pending callbacks. */
function fakeTimers() {
  let clock = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; cb: () => void }>();
  const t: DrainTimers = {
    now: () => clock,
    setTimeout: (cb, ms) => {
      const id = ++seq;
      pending.set(id, { at: clock + ms, cb });
      return id;
    },
    clearTimeout: (id) => void pending.delete(id as number),
  };
  const advance = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const next = [...pending.entries()].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      pending.delete(next[0]);
      clock = next[1].at;
      next[1].cb();
    }
    clock = end;
  };
  return { t, advance, pending };
}

/** A fence that signals after `signalAfterPolls` status queries. */
function fakeGl(signalAfterPolls: number, opts: { lost?: boolean; noFence?: boolean } = {}) {
  let polls = 0;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    SYNC_STATUS: 0x9114,
    SIGNALED: 0x9119,
    fenceSync: opts.noFence ? () => null : vi.fn(() => ({ fence: true })),
    getSyncParameter: vi.fn(() => (++polls > signalAfterPolls ? 0x9119 : 0x9118)),
    deleteSync: vi.fn(),
    flush: vi.fn(),
    isContextLost: () => !!opts.lost,
  };
  return gl as typeof gl & FenceGL;
}

describe('afterGpuDrain (perf B2: no sync GL call behind queued frames)', () => {
  it('runs the callback only once the fence has signalled, then deletes the fence', () => {
    const { t, advance } = fakeTimers();
    const gl = fakeGl(3);
    const cb = vi.fn();
    afterGpuDrain(gl, cb, 5000, t);
    expect(gl.flush).toHaveBeenCalledTimes(1);
    advance(DRAIN_POLL_MS * 2);
    expect(cb).not.toHaveBeenCalled();
    advance(DRAIN_POLL_MS * 3);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(gl.deleteSync).toHaveBeenCalledTimes(1);
  });

  it('never waits past the timeout (the gated work always happens)', () => {
    const { t, advance } = fakeTimers();
    const gl = fakeGl(Number.POSITIVE_INFINITY);
    const cb = vi.fn();
    afterGpuDrain(gl, cb, 200, t);
    advance(199);
    expect(cb).not.toHaveBeenCalled();
    advance(DRAIN_POLL_MS);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('falls back to the next macrotask without a context, with a lost context or without fences', () => {
    for (const gl of [null, fakeGl(0, { lost: true }), fakeGl(0, { noFence: true })]) {
      const { t, advance } = fakeTimers();
      const cb = vi.fn();
      afterGpuDrain(gl, cb, 5000, t);
      expect(cb).not.toHaveBeenCalled();
      advance(0);
      expect(cb).toHaveBeenCalledTimes(1);
    }
  });

  it('cancel stops polling, skips the callback and releases the fence', () => {
    const { t, advance, pending } = fakeTimers();
    const gl = fakeGl(10);
    const cb = vi.fn();
    const cancel = afterGpuDrain(gl, cb, 5000, t);
    advance(DRAIN_POLL_MS);
    cancel();
    advance(10_000);
    expect(cb).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
    expect(gl.deleteSync).toHaveBeenCalledTimes(1);
  });
});
