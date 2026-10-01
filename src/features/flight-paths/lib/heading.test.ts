import { describe, expect, it } from 'vitest';
import { initialBearing, interpolate, type LngLatTuple } from '@/lib/geo';
import { angleDiff, DIRECTION, flyingRoute, headingAlong } from './geometry';

const LHR: LngLatTuple = [-0.461941, 51.4706];
const JFK: LngLatTuple = [-73.7781, 40.6413];

describe('headingAlong / flyingRoute (round 3 B1/M1)', () => {
  const mid = interpolate(LHR, JFK, 0.5);
  const local = initialBearing(mid, JFK);
  const at = (p: LngLatTuple, trackDeg: number | null, vrFpm: number | null = 0) => ({ lng: p[0], lat: p[1], altFt: 37_000, gsKt: 480, trackDeg, vrFpm });

  it('en route: within ±60° of the local path bearing AND ±45° of the direct bearing to b', () => {
    expect(headingAlong(at(mid, local), LHR, JFK)).toBe(true);
    // On the great circle the two bearings agree: 40° off passes, 50° off does not (round 5).
    expect(headingAlong(at(mid, (local + 40) % 360), LHR, JFK)).toBe(true);
    expect(headingAlong(at(mid, (local + 50) % 360), LHR, JFK)).toBe(false);
    expect(headingAlong(at(mid, (local + 70) % 360), LHR, JFK)).toBe(false);
    expect(headingAlong(at(mid, (local + 180) % 360), LHR, JFK)).toBe(false);
    expect(headingAlong(at(mid, (local + 180) % 360), JFK, LHR)).toBe(true);
  });

  it('round 5: far off the great circle, a track near the path bearing but pointing away from b is not toward b (SWA2331)', () => {
    // 600 km south of the LAS–LIT great circle over west Texas, tracking 130° (toward Laredo): 57° off
    // the path's local bearing (within 60°) but LIT is ~70° off its nose.
    const LAS: LngLatTuple = [-115.152, 36.08];
    const LIT: LngLatTuple = [-92.224, 34.729];
    const s = { lng: -101.67361, lat: 29.73747, altFt: 35000, gsKt: 483.5, trackDeg: 129.9, vrFpm: 64 };
    expect(angleDiff(s.trackDeg, initialBearing([s.lng, s.lat], LIT))).toBeGreaterThan(DIRECTION.maxCourseDeg);
    expect(headingAlong(s, LAS, LIT)).toBe(false);
    expect(flyingRoute(s, LAS, LIT)).toBe(false);
  });

  it('no observed track: unknown, never a direction', () => {
    expect(headingAlong(at(mid, null), LHR, JFK)).toBeNull();
    expect(flyingRoute(at(mid, null), LHR, JFK)).toBe(false);
  });

  it('near an end the vertical rate decides (climbing out of b is not arriving at b)', () => {
    // 111 km (60 nm) from JFK: a 3° path is ≈ 20,000 ft there.
    const nearJfk = interpolate(LHR, JFK, 0.98);
    const low = (p: LngLatTuple, trackDeg: number | null, vrFpm: number | null) => ({ ...at(p, trackDeg, vrFpm), altFt: 15_000 });
    expect(headingAlong(low(nearJfk, 10, -1500), LHR, JFK)).toBe(true);
    expect(headingAlong(low(nearJfk, 60, 2500), LHR, JFK)).toBe(false);
    // Tracking away from b with no vertical rate: not arriving (round 4 M1), not "unknown".
    expect(headingAlong(low(nearJfk, 60, null), LHR, JFK)).toBe(false);
    // Tracking at b with no vertical rate: unknown (could be a missed approach or a hold).
    expect(headingAlong(low(nearJfk, initialBearing(nearJfk, JFK), null), LHR, JFK)).toBeNull();
  });

  it('round 5 M1: near b, cruise level is not an arrival — even tracking straight at b', () => {
    const nearJfk = interpolate(LHR, JFK, 0.98);
    const toJfk = initialBearing(nearJfk, JFK);
    // FL370 level 60 nm out: above the 3° path + 5,000 ft.
    expect(headingAlong(at(nearJfk, toJfk, 0), LHR, JFK)).toBe(false);
    expect(headingAlong(at(nearJfk, toJfk, null), LHR, JFK)).toBe(false);
    // Descending straight in: a late, steep descent is still an arrival (≤ twice the slope + 10,000 ft) …
    expect(headingAlong(at(nearJfk, toJfk, -1500), LHR, JFK)).toBe(true);
    // … but descending at FL370 while passing abeam is not (3° path + 10,000 ft off the cone).
    expect(headingAlong(at(nearJfk, (toJfk + 90) % 360, -1500), LHR, JFK)).toBe(false);
    // Level and low but 70° off the bearing to b (passing abeam): not arriving (the cone is 60°).
    const abeam = { ...at(nearJfk, (toJfk + 70) % 360, 0), altFt: 9_000 };
    expect(headingAlong(abeam, LHR, JFK)).toBe(false);
    expect(headingAlong({ ...abeam, trackDeg: (toJfk + 50) % 360 }, LHR, JFK)).toBe(true);
    // The field elevation counts: 9,000 ft MSL is 4,000 ft above a 5,000 ft field.
    const high = { ...at(interpolate(LHR, JFK, 0.995), toJfk, 0), altFt: 13_000 };
    expect(headingAlong(high, LHR, JFK)).toBe(false);
    expect(headingAlong(high, LHR, JFK, { b: 5_000 })).toBe(true);
  });

  it('round 5 M1, mirrored near a: a level aircraft must head away from a at a plausible height', () => {
    const nearLhr = interpolate(LHR, JFK, 0.015); // ≈ 83 km out
    const away = initialBearing(LHR, nearLhr) + 0; // ≈ the radial
    const dep = (trackDeg: number, altFt: number, vrFpm: number | null) => ({ ...at(nearLhr, trackDeg, vrFpm), altFt });
    expect(headingAlong(dep(away, 12_000, 0), LHR, JFK)).toBe(true);
    expect(headingAlong(dep((away + 80) % 360, 12_000, 0), LHR, JFK)).toBe(false);
    // Cruise traffic over a (FL390, level, even on the radial) is not departing it.
    expect(headingAlong(dep(away, 39_000, 0), LHR, JFK)).toBe(false);
    // Climbing: any track (a SID turn) below the climb ceiling.
    expect(headingAlong(dep((away + 120) % 360, 12_000, 2_000), LHR, JFK)).toBe(true);
    expect(headingAlong(dep(away, 12_000, -1_500), LHR, JFK)).toBe(false);
  });

  it('off the corridor is never flying the route', () => {
    expect(flyingRoute(at([-95, 33], 60), LHR, JFK)).toBe(false);
  });
});
