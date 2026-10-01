import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { type AdmissionRequester, createAdmissionScheduler } from './admission-scheduler';

/** Manual clock + a slot source the test controls (a quiet slot only comes when `grantSlot()`). */
function harness(maxWaitMs = 2000) {
  let clock = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const slots: (() => void)[] = [];
  const pendingLog: number[] = [];
  const admits: string[] = [];
  const s = createAdmissionScheduler({
    maxWaitMs,
    onAdmit: (id) => admits.push(`${id}@${clock}`),
    slot: (cb) => {
      slots.push(cb);
      return () => {
        const i = slots.indexOf(cb);
        if (i >= 0) slots.splice(i, 1);
      };
    },
    timers: {
      setTimeout: (cb, ms) => {
        timers.set(++seq, { at: clock + ms, cb });
        return seq;
      },
      clearTimeout: (id) => void timers.delete(id as number),
      now: () => clock,
    },
    onPending: (n) => pendingLog.push(n),
  });
  const advance = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      clock = next[1].at;
      next[1].cb();
    }
    clock = end;
  };
  const grantSlot = () => slots.shift()?.();
  return { s, advance, grantSlot, slots, timers, pendingLog, admits };
}

function queue(id: string, n: number, priority = 2, maxWaitMs?: number) {
  const admitted: number[] = [];
  let left = n;
  const r: AdmissionRequester = {
    id,
    priority,
    maxWaitMs,
    pending: () => left,
    admitOne: vi.fn(() => {
      admitted.push(n - left);
      left--;
    }),
  };
  return { r, admitted, add: (k: number) => (left += k) };
}

describe('admission scheduler (perf B2 / visual-qa R2-M6)', () => {
  it('admits exactly one unit per quiet slot', () => {
    const h = harness();
    const q = queue('deck', 3);
    h.s.register(q.r);
    expect(h.slots).toHaveLength(1);
    h.grantSlot();
    expect(q.admitted).toEqual([0]);
    expect(h.slots).toHaveLength(1); // next slot requested, not run in the same task
    h.grantSlot();
    h.grantSlot();
    expect(q.admitted).toEqual([0, 1, 2]);
    expect(h.slots).toHaveLength(0);
    expect(h.s.pending()).toBe(0);
  });

  it('makes progress without any quiet slot: one unit per maxWait however busy the thread', () => {
    const h = harness(2000);
    const q = queue('native', 4);
    h.s.register(q.r);
    h.advance(1999);
    expect(q.admitted).toEqual([]);
    h.advance(1);
    expect(q.admitted).toEqual([0]);
    h.advance(2000 * 3);
    expect(q.admitted).toEqual([0, 1, 2, 3]);
    // The deadline cancelled the slot it replaced: a late slot does not admit a second unit.
    expect(h.slots).toHaveLength(0);
    expect(h.timers.size).toBe(0);
  });

  it('a slot that comes first cancels the deadline (no double admission)', () => {
    const h = harness(2000);
    const q = queue('deck', 1);
    h.s.register(q.r);
    h.grantSlot();
    h.advance(5000);
    expect(q.r.admitOne).toHaveBeenCalledTimes(1);
  });

  it('keeps admitting other work when one unit throws', () => {
    const h = harness();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.s.register({ id: 'bad', priority: 2, pending: () => 1, admitOne: () => { throw new Error('boom'); } });
    const good = queue('good', 2);
    h.s.register(good.r);
    for (let i = 0; i < 4; i++) h.grantSlot();
    expect(good.r.admitOne).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('serves lower priority first, and alternates between equal priorities', () => {
    const h = harness();
    const order: string[] = [];
    const mk = (id: string, n: number, priority: number): AdmissionRequester => {
      let left = n;
      return { id, priority, pending: () => left, admitOne: () => (order.push(id), left--) };
    };
    h.s.register(mk('deck-classes', 2, 2));
    h.s.register(mk('native-types', 2, 2));
    h.s.register(mk('features', 1, 0));
    for (let i = 0; i < 6; i++) h.grantSlot();
    expect(order).toEqual(['features', 'deck-classes', 'native-types', 'deck-classes', 'native-types']);
  });

  it('publishes the pending total and re-schedules when new work is kicked in', () => {
    const h = harness();
    const q = queue('deck', 1);
    h.s.register(q.r);
    expect(h.pendingLog.at(-1)).toBe(1);
    h.grantSlot();
    expect(h.pendingLog.at(-1)).toBe(0);
    expect(h.slots).toHaveLength(0);
    q.add(2);
    h.s.kick();
    expect(h.pendingLog.at(-1)).toBe(2);
    expect(h.slots).toHaveLength(1);
  });

  it('reports every admitted unit (diagnostics) in order', () => {
    const h = harness();
    h.s.register(queue('features', 1, 0).r);
    h.s.register(queue('native-types', 1, 2).r);
    h.grantSlot();
    h.advance(2000);
    expect(h.admits).toEqual(['features@0', 'native-types@2000']);
  });

  it('dispose stops scheduling and reports nothing pending', () => {
    const h = harness();
    const q = queue('deck', 2);
    h.s.register(q.r);
    h.s.dispose();
    h.advance(10_000);
    h.grantSlot();
    expect(q.admitted).toEqual([]);
    expect(h.pendingLog.at(-1)).toBe(0);
  });
});

describe('focus work waits only its own short maxWait (CI globe first draw: software GL never drains)', () => {
  it('a focus unit is admitted after its own wait although no quiet slot ever comes, ahead of the feature mount', () => {
    const h = harness(2000);
    const features = queue('features', 1, 0);
    const focus = queue('deck-classes', 1, -2, 250);
    h.s.register(features.r);
    h.s.register(focus.r);
    h.advance(249);
    expect(h.admits).toEqual([]);
    h.advance(1);
    expect(h.admits).toEqual(['deck-classes@250']);
    // The data-module mount keeps its full wait for a quiet slot.
    h.advance(1999);
    expect(features.admitted).toEqual([]);
    h.advance(1);
    expect(h.admits).toEqual(['deck-classes@250', 'features@2250']);
  });

  it('focus work queued behind a slot armed for ambient work pulls the deadline in', () => {
    const h = harness(2000);
    const native = queue('native-types', 2, 2);
    h.s.register(native.r);
    h.advance(100);
    const device = queue('deck-device', 1, -2, 250);
    h.s.register(device.r);
    h.advance(149);
    expect(h.admits).toEqual([]);
    h.advance(1);
    expect(h.admits).toEqual(['deck-device@250']);
    h.advance(2000);
    expect(h.admits).toEqual(['deck-device@250', 'native-types@2250']);
  });

  it('a deadline armed for focus work that went away re-arms for the next unit’s own wait', () => {
    const h = harness(2000);
    const native = queue('native-types', 1, 2);
    h.s.register(native.r);
    const unregister = h.s.register(queue('deck-classes', 1, -2, 250).r);
    h.advance(100);
    unregister(); // e.g. the route was cleared before its class was admitted
    h.advance(1899);
    expect(native.admitted).toEqual([]);
    h.advance(1);
    expect(h.admits).toEqual(['native-types@2000']);
  });

  it('a quiet slot still admits focus work at once, and no unit waits longer than the scheduler’s maxWait', () => {
    const h = harness(2000);
    const focus = queue('deck-device', 1, -2, 250);
    h.s.register(focus.r);
    h.grantSlot();
    expect(h.admits).toEqual(['deck-device@0']);
    const slow = queue('slow', 1, 2, 60_000);
    h.s.register(slow.r);
    h.advance(2000);
    expect(h.admits).toEqual(['deck-device@0', 'slow@2000']);
  });

  it('reads priority and maxWait when it picks (a focus class becoming next is served first)', () => {
    const h = harness(2000);
    const order: string[] = [];
    let next = 'IconLayer';
    let left = 2;
    h.s.register({
      id: 'deck-classes',
      get priority() {
        return next === 'PathLayer' ? -2 : 2;
      },
      get maxWaitMs() {
        return next === 'PathLayer' ? 250 : undefined;
      },
      pending: () => left,
      admitOne: () => {
        order.push(next);
        left--;
        next = 'IconLayer';
      },
    });
    h.s.register(queue('features', 1, 0).r);
    next = 'PathLayer'; // the route was published: its class is now first in line
    h.s.kick();
    h.advance(250);
    expect(order).toEqual(['PathLayer']);
    expect(h.admits).toEqual(['deck-classes@250']);
    h.advance(2000);
    expect(h.admits).toEqual(['deck-classes@250', 'features@2250']);
  });
});

describe('no synchronous React commits in the map engine (perf B2: one 6,049 ms task)', () => {
  const roots = ['src/lib/map', 'src/components/map'];
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(p);
    }
  };
  for (const r of roots) walk(join(process.cwd(), r));

  it('never imports or calls flushSync', () => {
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) => /\bflushSync\s*\(|import\s*\{[^}]*\bflushSync\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
