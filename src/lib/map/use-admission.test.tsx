// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdmissionScheduler, drawPending, useAdmissionStore } from './admission-scheduler';
import { useAdmission } from './use-admission';

/** A scheduler whose quiet slots the test grants by hand (no timers fire on their own). */
function installScheduler() {
  const slots: (() => void)[] = [];
  const s = createAdmissionScheduler({
    maxWaitMs: 60_000,
    slot: (cb) => {
      slots.push(cb);
      return () => void slots.splice(slots.indexOf(cb) >>> 0, 1);
    },
    timers: { setTimeout: () => 0, clearTimeout: () => undefined, now: () => 0 },
    onPending: (n) => useAdmissionStore.getState().setPending(n),
  });
  useAdmissionStore.getState().setScheduler(s);
  return { s, grant: () => act(() => slots.shift()?.()) };
}

afterEach(() => {
  useAdmissionStore.getState().scheduler?.dispose();
  useAdmissionStore.setState({ scheduler: null, pending: 0, undrawn: 0, undrawnBy: {} });
});

describe('useAdmission ready gate (perf m-l: the deck device waits for the painted basemap, honestly)', () => {
  it('wanted but not ready: counted as pending (RECEIVED + DRAWING), never admitted until ready', async () => {
    const { grant } = installScheduler();
    const { result, rerender } = renderHook(({ when, ready }) => useAdmission(when, 'deck-device', -1, undefined, ready), {
      initialProps: { when: true, ready: false },
    });
    expect(result.current).toBe(false);
    expect(useAdmissionStore.getState().pending).toBe(1);
    expect(drawPending(useAdmissionStore.getState())).toBe(true);
    grant(); // no slot was even requested
    expect(result.current).toBe(false);
    rerender({ when: true, ready: true });
    await act(async () => undefined);
    grant();
    await act(async () => undefined);
    expect(result.current).toBe(true);
    expect(useAdmissionStore.getState().pending).toBe(0);
  });

  it('not wanted: nothing pending (ready or not)', () => {
    installScheduler();
    const { result } = renderHook(() => useAdmission(false, 'deck-device', -1, undefined, true));
    expect(result.current).toBe(false);
    expect(useAdmissionStore.getState().pending).toBe(0);
  });
});
