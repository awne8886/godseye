import { describe, expect, it } from 'vitest';
import { createBoundaryPublisher, nextBoundary, startAlignedTicks } from './second-clock';

/** A manual clock + timer queue (no real time passes). */
function fakeClock(start: number) {
  let now = start;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    /** Advance to `t`, firing due timers in order (each `lateBy` ms late). */
    advance(t: number, lateBy = 0) {
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at + lateBy <= t).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at + lateBy);
        due[1].fn();
      }
      now = t;
    },
    pending: () => timers.size,
  };
}

describe('wall-clock aligned ticks (perf m-f)', () => {
  it('nextBoundary is the next whole period after now', () => {
    expect(nextBoundary(1_790_000_000_123)).toBe(1_790_000_001_000);
    expect(nextBoundary(1_790_000_001_000)).toBe(1_790_000_002_000);
    expect(nextBoundary(1_790_000_001_000, 2000)).toBe(1_790_000_002_000);
  });

  it('requests every second boundary once, leadMs ahead, even when timers fire late', () => {
    const c = fakeClock(1_790_000_000_400);
    const seen: { at: number; firedAt: number }[] = [];
    const stop = startAlignedTicks((at) => seen.push({ at, firedAt: c.now() }), { periodMs: 1000, leadMs: 250, ...c });
    c.advance(1_790_000_003_100);
    expect(seen.map((s) => s.at)).toEqual([1_790_000_001_000, 1_790_000_002_000, 1_790_000_003_000]);
    expect(seen.map((s) => s.at - s.firedAt)).toEqual([250, 250, 250]);
    c.advance(1_790_000_005_200, 400); // 400 ms late timers: still one request per boundary
    expect(seen.map((s) => s.at).slice(3)).toEqual([1_790_000_004_000, 1_790_000_005_000]);
    stop();
    expect(c.pending()).toBe(0);
  });

  it('two layers on the same clock hit the same boundaries (one redraw per second)', () => {
    const c = fakeClock(1_790_000_000_100);
    const a: number[] = [];
    const b: number[] = [];
    startAlignedTicks((at) => a.push(at), { periodMs: 1000, leadMs: 250, ...c });
    startAlignedTicks((at) => b.push(at), { periodMs: 1000, leadMs: 0, ...c });
    c.advance(1_790_000_004_000);
    expect(a).toEqual([1_790_000_001_000, 1_790_000_002_000, 1_790_000_003_000, 1_790_000_004_000]);
    expect(b).toEqual(a);
  });

  it('reduced motion: 2 s boundaries', () => {
    const c = fakeClock(1_790_000_000_500);
    const seen: number[] = [];
    startAlignedTicks((at) => seen.push(at), { periodMs: 2000, ...c });
    c.advance(1_790_000_006_000);
    expect(seen).toEqual([1_790_000_002_000, 1_790_000_004_000, 1_790_000_006_000]);
  });

  it('the publisher holds a frame until its second and drops an older one that arrives late', () => {
    const c = fakeClock(1_790_000_000_760);
    const out: string[] = [];
    const p = createBoundaryPublisher<string>((v) => out.push(`${v}@${c.now()}`), c);
    p.offer('f1', 1_790_000_001_000);
    expect(out).toEqual([]);
    c.advance(1_790_000_001_000);
    expect(out).toEqual(['f1@1790000001000']);
    p.offer('f3', 1_790_000_003_000);
    p.offer('f2', 1_790_000_002_000); // older than the pending f3: dropped
    c.advance(1_790_000_003_000);
    expect(out).toEqual(['f1@1790000001000', 'f3@1790000003000']);
    p.offer('now', 1_790_000_002_500); // already past → published at once
    expect(out.at(-1)).toBe('now@1790000003000');
  });
});
