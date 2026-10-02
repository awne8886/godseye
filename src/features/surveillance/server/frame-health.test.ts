import { afterEach, describe, expect, it } from 'vitest';
import { FrameHealth } from '@/lib/schemas/surveillance';
import { FRAME_MIN_CAMERAS, FRAME_WINDOW_MS, frameHealth, operatorWide, recordFrame, resetFrameHealth, summarise, type FrameOutcome } from './frame-health';

const T = Date.parse('2026-10-01T08:00:00Z');
const o = (cameraId: string, ok: boolean, atOffsetS = 0, extra: Partial<FrameOutcome> = {}): FrameOutcome => ({ at: T + atOffsetS * 1000, cameraId, ok, error: ok ? null : 'not_an_image', observedAt: null, ...extra });

afterEach(resetFrameHealth);

describe('frame-health ledger', () => {
  it('nothing requested → unchecked (never "available" by default)', () => {
    const h = summarise([], T);
    expect(h).toMatchObject({ state: 'unchecked', attempts: 0, cameras: 0, lastOkAt: null });
    expect(FrameHealth.safeParse(h).success).toBe(true);
  });

  const NSW = ['5_ways_miranda', 'airport_dr_mascot', 'alison_road_randwick', 'anzac_bridge_eastbound', 'anzac_bridge_westbound', 'anzac_parade_kensington'];

  it('NSW (R2 MINOR-1): 5 cameras all answering HTML → unavailable', () => {
    const h = summarise(NSW.slice(0, 5).map((c, i) => o(`nsw-${c}`, false, i)), T + 10_000);
    expect(h).toMatchObject({ state: 'unavailable', cameras: 5, camerasFailing: 5, camerasOperatorFault: 5, failed: 5, errors: { not_an_image: 5 } });
  });

  it(`fewer than ${FRAME_MIN_CAMERAS} cameras tried → never a verdict on the operator (inconclusive, not failing)`, () => {
    expect(FRAME_MIN_CAMERAS).toBe(5);
    expect(summarise(NSW.slice(0, 4).map((c, i) => o(`nsw-${c}`, false, i)), T + 10_000)).toMatchObject({ state: 'inconclusive', cameras: 4, camerasFailing: 4 });
    expect(summarise([o('a', false)], T + 5_000).state).toBe('inconclusive');
  });

  it('round-4 review: dead cameras (404) or limiter waits never mark an operator unavailable', () => {
    // The reviewer's repro: 3× upstream_404 on Caltrans, 3× timeout on HK TD. Now 6 of each.
    const dead = Array.from({ length: 6 }, (_, i) => o(`caltrans-${i}`, false, i, { error: 'upstream_404' }));
    expect(summarise(dead, T + 10_000)).toMatchObject({ state: 'inconclusive', camerasFailing: 6, camerasOperatorFault: 0 });
    const blocked = Array.from({ length: 6 }, (_, i) => o(`x-${i}`, false, i, { error: i % 2 ? 'blocked' : 'no_snapshot' }));
    expect(summarise(blocked, T + 10_000).state).toBe('inconclusive');
    // A 404 among working cameras: available, with the count shown.
    expect(summarise([...dead.slice(0, 1), o('ok1', true, 1), o('ok2', true, 2)], T + 10_000)).toMatchObject({ state: 'available', camerasFailing: 1 });
  });

  it('operator-wide failures over ≥ 5 cameras: > 90 % unavailable, > 50 % failing', () => {
    const wide = ['not_an_image', 'upstream_503', 'network', 'timeout', 'upstream_500'];
    const five = wide.map((error, i) => o(`c${i}`, false, i, { error }));
    expect(summarise(five, T + 10_000).state).toBe('unavailable');
    const six = [...five.slice(0, 4), o('c4', true, 4), o('c5', true, 5)];
    expect(summarise(six, T + 10_000)).toMatchObject({ state: 'failing', camerasOperatorFault: 4, cameras: 6 });
    const mixed = [...five.slice(0, 2), o('d1', false, 3, { error: 'upstream_404' }), o('d2', false, 4, { error: 'upstream_404' }), o('d3', false, 5, { error: 'upstream_404' }), o('ok', true, 6)];
    expect(summarise(mixed, T + 10_000)).toMatchObject({ state: 'available', camerasFailing: 5, camerasOperatorFault: 2 });
  });

  it('operatorWide: page / 5xx / network / operator timeout yes; 404, 410, 403, no snapshot, blocked, too large, queued no', () => {
    for (const e of ['not_an_image', 'upstream_500', 'upstream_503', 'network', 'timeout', 'parse', 'redirect']) expect(operatorWide(e), e).toBe(true);
    for (const e of ['upstream_404', 'upstream_410', 'upstream_403', 'no_snapshot', 'blocked', 'too_large', 'queued', null]) expect(operatorWide(e), String(e)).toBe(false);
  });

  it('one dead camera refreshed every minute cannot take a working operator down', () => {
    const list = [...Array.from({ length: 10 }, (_, i) => o('dead', false, i * 60)), o('x', true, 5), o('y', true, 6), o('z', true, 7)];
    const h = summarise(list, T + 600_000 - 1);
    expect(h).toMatchObject({ state: 'available', cameras: 4, camerasFailing: 1, failed: 10, ok: 3 });
  });

  it('only each camera’s latest attempt counts (recovery is immediate)', () => {
    const list = [o('a', false), o('b', false, 1), o('c', false, 2), o('d', false, 3), o('e', false, 4)];
    expect(summarise(list, T + 60_000).state).toBe('unavailable');
    expect(summarise([...list, o('a', true, 30), o('b', true, 31)], T + 60_000)).toMatchObject({ state: 'failing', camerasFailing: 3 });
    expect(summarise([...list, o('a', true, 30), o('b', true, 31), o('c', true, 32)], T + 60_000)).toMatchObject({ state: 'available', camerasFailing: 2 });
  });

  it('outcomes older than the 10-minute window are forgotten', () => {
    const list = [o('a', false), o('b', false), o('c', false), o('d', false), o('e', false)];
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

  it('round 5 (R2 minor 4): freshestFrameAge_s is the freshest operator frame among each camera’s latest relayed frame', () => {
    const at = Date.parse('2026-10-01T13:20:00Z');
    const old = (cam: string, ageS: number, dt = 0) => o(cam, true, 0, { at: at + dt * 1000, observedAt: at + dt * 1000 - ageS * 1000 });
    // Toronto: every frame relayed is ~21 h old (the reviewer saw lastFrameAge_s 77879).
    const toronto = summarise([old('t1', 77879), old('t2', 77700, 5), old('t3', 78000, 10)], at + 60_000);
    expect(toronto).toMatchObject({ state: 'available', lastFrameAge_s: 78000, freshestFrameAge_s: 77700 });
    expect(FrameHealth.safeParse(toronto).success).toBe(true);
    // One fresh camera among stale ones: the operator does publish current frames.
    expect(summarise([old('a', 77879), old('b', 45, 5)], at + 60_000).freshestFrameAge_s).toBe(45);
    // Only each camera's latest attempt counts: a camera that was fresh and is now stale is stale.
    expect(summarise([old('a', 30), old('a', 9000, 30)], at + 60_000).freshestFrameAge_s).toBe(9000);
    // A camera whose latest attempt failed contributes no age; untimed or future frames are not ages.
    expect(summarise([old('a', 30), o('a', false, 30, { at: at + 30_000, error: 'upstream_404' }), old('b', 600, 5)], at + 60_000).freshestFrameAge_s).toBe(600);
    expect(summarise([o('u', true, 0, { at, observedAt: null }), o('f', true, 0, { at, observedAt: at + 3_600_000 })], at + 60_000)).toMatchObject({ freshestFrameAge_s: null, lastFrameAge_s: null, untimed: 1 });
    expect(summarise([], at).freshestFrameAge_s).toBeNull();
  });

  it('recordFrame/frameHealth keep providers apart', () => {
    recordFrame('nsw', { cameraId: 'nsw-1', ok: false, error: 'not_an_image', observedAt: null });
    recordFrame('hktd', { cameraId: 'hktd-1', ok: true, error: null, observedAt: Date.now() - 68_000 });
    const all = frameHealth(['nsw', 'hktd', 'caltrans']);
    expect(all.nsw!.state).toBe('inconclusive');
    expect(all.hktd!.state).toBe('available');
    expect(all.caltrans!.state).toBe('unchecked');
  });
});
