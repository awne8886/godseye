import { afterEach, describe, expect, it } from 'vitest';
import { FrameHealth } from '@/lib/schemas/surveillance';
import { FRAME_WINDOW_MS, frameHealth, recordFrame, resetFrameHealth, summarise, type FrameOutcome } from './frame-health';

const T = Date.parse('2026-10-01T08:00:00Z');
const o = (cameraId: string, ok: boolean, atOffsetS = 0, extra: Partial<FrameOutcome> = {}): FrameOutcome => ({ at: T + atOffsetS * 1000, cameraId, ok, error: ok ? null : 'not_an_image', observedAt: null, ...extra });

afterEach(resetFrameHealth);

describe('frame-health ledger', () => {
  it('nothing requested → unchecked (never "available" by default)', () => {
    const h = summarise([], T);
    expect(h).toMatchObject({ state: 'unchecked', attempts: 0, cameras: 0, lastOkAt: null });
    expect(FrameHealth.safeParse(h).success).toBe(true);
  });

  it('NSW (R2 MINOR-1): 4 cameras all answering HTML → unavailable', () => {
    const h = summarise(['5_ways_miranda', 'airport_dr_mascot', 'alison_road_randwick', 'pacific_highway_macksville'].map((c, i) => o(`nsw-${c}`, false, i)), T + 10_000);
    expect(h).toMatchObject({ state: 'unavailable', cameras: 4, camerasFailing: 4, failed: 4, errors: { not_an_image: 4 } });
  });

  it('fewer than 3 cameras tried, all failing → failing (not enough to call the operator down)', () => {
    expect(summarise([o('a', false), o('b', false, 1)], T + 5_000).state).toBe('failing');
  });

  it('one dead camera refreshed every minute cannot take a working operator down', () => {
    const list = [...Array.from({ length: 10 }, (_, i) => o('dead', false, i * 60)), o('x', true, 5), o('y', true, 6), o('z', true, 7)];
    const h = summarise(list, T + 600_000 - 1);
    expect(h).toMatchObject({ state: 'available', cameras: 4, camerasFailing: 1, failed: 10, ok: 3 });
  });

  it('only each camera’s latest attempt counts (recovery is immediate)', () => {
    const list = [o('a', false), o('b', false, 1), o('c', false, 2), o('a', true, 30), o('b', true, 31)];
    expect(summarise(list, T + 60_000)).toMatchObject({ state: 'available', camerasFailing: 1 });
  });

  it('outcomes older than the 10-minute window are forgotten', () => {
    const list = [o('a', false), o('b', false), o('c', false)];
    expect(summarise(list, T + FRAME_WINDOW_MS - 1).state).toBe('unavailable');
    expect(summarise(list, T + FRAME_WINDOW_MS + 1).state).toBe('unchecked');
  });

  it('lastFrameAge_s is the frame’s operator age at fetch time; untimed frames are counted, not aged', () => {
    const lm = Date.parse('2026-10-01T06:48:44Z'); // Digitraffic C0150301 Last-Modified, probed at 07:49:51Z
    const h = summarise([o('c1', true, 0, { at: Date.parse('2026-10-01T07:49:51Z'), observedAt: lm }), o('c2', true, 0, { at: Date.parse('2026-10-01T07:40:00Z'), observedAt: null })], Date.parse('2026-10-01T07:50:00Z'));
    expect(h.lastFrameAge_s).toBe(3667);
    expect(h.untimed).toBe(1);
    expect(h.lastOkAt).toBe('2026-10-01T07:49:51.000Z');
  });

  it('recordFrame/frameHealth keep providers apart', () => {
    recordFrame('nsw', { cameraId: 'nsw-1', ok: false, error: 'not_an_image', observedAt: null });
    recordFrame('hktd', { cameraId: 'hktd-1', ok: true, error: null, observedAt: Date.now() - 68_000 });
    const all = frameHealth(['nsw', 'hktd', 'caltrans']);
    expect(all.nsw!.state).toBe('failing');
    expect(all.hktd!.state).toBe('available');
    expect(all.caltrans!.state).toBe('unchecked');
  });
});
