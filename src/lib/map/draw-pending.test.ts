import { afterEach, describe, expect, it } from 'vitest';
import { drawPending, useAdmissionStore } from './admission-scheduler';

afterEach(() => {
  useAdmissionStore.setState({ pending: 0, undrawn: 0, undrawnBy: {} });
});

describe('header honesty: ENTITIES only when drawn (R3-M2)', () => {
  it('queued admission or layers off the map keep the count back', () => {
    expect(drawPending({ pending: 0, undrawn: 0 })).toBe(false);
    expect(drawPending({ pending: 1, undrawn: 0 })).toBe(true);
    expect(drawPending({ pending: 0, undrawn: 1 })).toBe(true);
  });

  it('undrawn sums every producer and releases when the deck groups are on the map', () => {
    const s = useAdmissionStore.getState();
    s.setUndrawn('deck', 1);
    s.setUndrawn('native', 2);
    expect(useAdmissionStore.getState().undrawn).toBe(3);
    expect(drawPending(useAdmissionStore.getState())).toBe(true);
    s.setUndrawn('deck', 0);
    s.setUndrawn('native', 0);
    expect(useAdmissionStore.getState().undrawn).toBe(0);
    expect(drawPending(useAdmissionStore.getState())).toBe(false);
  });
});
