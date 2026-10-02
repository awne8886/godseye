import { describe, expect, it } from 'vitest';
import { mapToolArmed } from './deck-events';
import { createHoverPickGate, HOVER_PICK_MAX_DUTY, HOVER_PICK_MIN_INTERVAL_MS, HOVER_PICK_PRESS_QUIET_MS, HOVER_PICK_SETTLE_MS } from './hover-pick';

/** Manual clock; a pick "takes" `cost` ms of it. */
function harness(cost: number, suspended?: () => boolean) {
  let clock = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const picks: { at: number; x: number; y: number }[] = [];
  let leaves = 0;
  const gate = createHoverPickGate({
    pick: (x, y) => {
      picks.push({ at: clock, x, y });
      clock += cost; // the pick blocks the thread for `cost` ms
      return cost;
    },
    leave: () => void leaves++,
    suspended,
    timers: {
      setTimeout: (cb, ms) => {
        timers.set(++seq, { at: clock + ms, cb });
        return seq;
      },
      clearTimeout: (id) => void timers.delete(id as number),
      now: () => clock,
    },
  });
  /** Advance to `t`, firing due timers in order. */
  const until = (t: number) => {
    for (;;) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= t).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      clock = Math.max(clock, next[1].at);
      next[1].cb();
    }
    clock = Math.max(clock, t);
  };
  /** The pointer moves every `stepMs` from t0 for `ms` (60 Hz pointer events by default). */
  let lastX = Number.NaN;
  const hover = (ms: number, blocked = false, stepMs = 1000 / 60) => {
    const t0 = clock;
    for (let t = t0, i = 0; t < t0 + ms; t += stepMs, i++) {
      until(t);
      lastX = 100 + i;
      gate.move(lastX, 200, blocked);
    }
    until(t0 + ms);
  };
  return { gate, picks, until, hover, leaves: () => leaves, now: () => clock, lastX: () => lastX };
}

describe('hover pick budget (perf round-5 m-h)', () => {
  it('a hardware GPU (2 ms picks): ≤ 10 Hz while the pointer moves, plus one where it rests', () => {
    const h = harness(2);
    h.hover(1000);
    expect(h.picks.length).toBeGreaterThanOrEqual(8);
    expect(h.picks.length).toBeLessThanOrEqual(1000 / HOVER_PICK_MIN_INTERVAL_MS + 1);
    const moving = h.picks.length;
    h.until(h.now() + HOVER_PICK_SETTLE_MS + HOVER_PICK_MIN_INTERVAL_MS);
    expect(h.picks.length).toBe(moving + 1);
    expect(h.picks.at(-1)!.x).toBe(h.lastX()); // the final position is the one picked last
    for (let i = 1; i < h.picks.length; i++) expect(h.picks[i]!.at - h.picks[i - 1]!.at).toBeGreaterThanOrEqual(HOVER_PICK_MIN_INTERVAL_MS);
  });

  it('a software GPU (536 ms picks, the measured SwiftShader cost): hover takes ≤ 25 % of the thread', () => {
    const h = harness(536);
    h.hover(23_700); // the repro's 23.7 s of hovering (40 picks / 21.4 s before)
    const busy = h.picks.length * 536;
    expect(busy / 23_700).toBeLessThanOrEqual(HOVER_PICK_MAX_DUTY + 0.03);
    expect(h.picks.length).toBeLessThanOrEqual(12);
    expect(h.picks.length).toBeGreaterThanOrEqual(5); // still answers while moving
  });

  it('never picks while a button is held (drag) or the camera moves, not even after the drag', () => {
    const h = harness(2);
    h.hover(2000, true);
    h.until(h.now() + 5000);
    expect(h.picks).toEqual([]);
  });

  it('a press right after a move cancels the pending pick at the old position', () => {
    const h = harness(2);
    h.gate.move(10, 10, false); // leading pick
    h.gate.move(20, 20, false); // too soon: queued for when the pointer rests
    h.gate.move(20, 20, true); // button down: the drag starts
    h.until(h.now() + 1000);
    expect(h.picks.map((p) => p.x)).toEqual([10]);
  });

  it('a pointer resting where it was last picked does not pick again (until a drag or camera move changed the scene)', () => {
    const h = harness(2);
    h.gate.move(10, 10, false);
    h.until(h.now() + 1000);
    h.gate.move(10, 10, false);
    h.until(h.now() + 1000);
    expect(h.picks.length).toBe(1);
    h.gate.move(10, 10, true); // the camera moved under the pointer
    h.gate.move(10, 10, false);
    expect(h.picks.length).toBe(2);
  });

  it('hover yields to clicks: no pick between the two clicks of a double right-click (R1-M1 / R1r5-m3)', () => {
    const h = harness(1500); // a heavy scene on a software GPU
    h.gate.move(100, 100, false); // the pointer arrives: one pick
    h.until(h.now() + 10_000);
    expect(h.picks.length).toBe(1);
    const t0 = h.now();
    h.gate.press(); // 1st right-click (down, contextmenu, up)
    h.gate.press();
    h.until(t0 + 30);
    h.gate.move(104, 102, false); // the 2nd click lands 4 px away
    h.until(t0 + 60);
    h.gate.press(); // 2nd right-click
    h.gate.press();
    expect(h.picks.length).toBe(1); // nothing ran between the clicks
    h.until(t0 + 60 + HOVER_PICK_PRESS_QUIET_MS + HOVER_PICK_SETTLE_MS);
    expect(h.picks.length).toBe(2); // the resting pick comes after the quiet window
    expect(h.picks.at(-1)).toMatchObject({ x: 104, y: 102 });
    expect(h.picks.at(-1)!.at).toBeGreaterThanOrEqual(t0 + 60 + HOVER_PICK_PRESS_QUIET_MS);
  });

  it('leaving the map clears the hover once and cancels the pending pick; dispose stops everything', () => {
    const h = harness(2);
    h.gate.move(10, 10, false);
    h.gate.move(11, 11, false);
    h.gate.leave();
    h.until(h.now() + 1000);
    expect(h.picks.length).toBe(1);
    expect(h.leaves()).toBe(1);
    h.gate.dispose();
    h.gate.move(50, 50, false);
    h.gate.leave();
    expect(h.picks.length).toBe(1);
    expect(h.leaves()).toBe(1);
  });

  it('a pick that throws (lost context) counts as no hover and does not stop the gate', () => {
    let clock = 0;
    const gate = createHoverPickGate({
      pick: () => {
        throw new Error('context lost');
      },
      leave: () => {
        throw new Error('finalised');
      },
      timers: { setTimeout: () => 0, clearTimeout: () => undefined, now: () => clock },
    });
    expect(() => gate.move(1, 1, false)).not.toThrow();
    clock += 1000;
    gate.move(2, 2, false);
    expect(gate.picks()).toBe(2);
    expect(() => gate.leave()).not.toThrow();
  });
});

describe('hover picks while a map tool is armed (verification round 6)', () => {
  it('runs no pick while data-map-tool is set, and clears the highlight on each move', () => {
    const host = { dataset: {} as DOMStringMap };
    const h = harness(536, () => mapToolArmed(host));
    h.hover(500);
    const unarmed = h.picks.length;
    expect(unarmed).toBeGreaterThan(0);
    host.dataset.mapTool = 'draw';
    const leaves0 = h.leaves();
    h.hover(5000);
    h.until(h.now() + 5000);
    expect(h.picks.length).toBe(unarmed); // the same sweep that picked unarmed picks nothing armed
    expect(h.leaves()).toBeGreaterThan(leaves0); // a highlight left from before is cleared
    delete host.dataset.mapTool;
    h.hover(3000);
    h.until(h.now() + 3000);
    expect(h.picks.length).toBeGreaterThan(unarmed); // disarmed: hover picks again
  });

  it('drops a resting pick that was queued before the tool was armed', () => {
    let armed = false;
    const h = harness(536, () => armed);
    h.hover(100); // first pick runs, the rest of the sweep queues a resting pick
    const before = h.picks.length;
    armed = true; // armed from the keyboard: no further pointer move
    h.until(h.now() + 10_000);
    expect(h.picks.length).toBe(before);
  });

  it('mapToolArmed reads the container flag', () => {
    expect(mapToolArmed(null)).toBe(false);
    expect(mapToolArmed({ dataset: {} as DOMStringMap })).toBe(false);
    expect(mapToolArmed({ dataset: { mapTool: 'draw' } as DOMStringMap })).toBe(true);
  });
});
