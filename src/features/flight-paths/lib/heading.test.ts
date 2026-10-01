import { describe, expect, it } from 'vitest';
import { initialBearing, interpolate, type LngLatTuple } from '@/lib/geo';
import { flyingRoute, headingAlong } from './geometry';

const LHR: LngLatTuple = [-0.461941, 51.4706];
const JFK: LngLatTuple = [-73.7781, 40.6413];

describe('headingAlong / flyingRoute (round 3 B1/M1)', () => {
  const mid = interpolate(LHR, JFK, 0.5);
  const local = initialBearing(mid, JFK);
  const at = (p: LngLatTuple, trackDeg: number | null, vrFpm: number | null = 0) => ({ lng: p[0], lat: p[1], altFt: 37_000, gsKt: 480, trackDeg, vrFpm });

  it('en route: within ±60° of the local bearing toward b', () => {
    expect(headingAlong(at(mid, local), LHR, JFK)).toBe(true);
    expect(headingAlong(at(mid, (local + 55) % 360), LHR, JFK)).toBe(true);
    expect(headingAlong(at(mid, (local + 70) % 360), LHR, JFK)).toBe(false);
    expect(headingAlong(at(mid, (local + 180) % 360), LHR, JFK)).toBe(false);
    expect(headingAlong(at(mid, (local + 180) % 360), JFK, LHR)).toBe(true);
  });

  it('no observed track: unknown, never a direction', () => {
    expect(headingAlong(at(mid, null), LHR, JFK)).toBeNull();
    expect(flyingRoute(at(mid, null), LHR, JFK)).toBe(false);
  });

  it('near an end the vertical rate decides (climbing out of b is not arriving at b)', () => {
    const nearJfk = interpolate(LHR, JFK, 0.98);
    expect(headingAlong(at(nearJfk, 10, -1500), LHR, JFK)).toBe(true);
    expect(headingAlong(at(nearJfk, 60, 2500), LHR, JFK)).toBe(false);
    // Tracking away from b with no vertical rate: not arriving (round 4 M1), not "unknown".
    expect(headingAlong(at(nearJfk, 60, null), LHR, JFK)).toBe(false);
    // Tracking at b with no vertical rate: unknown (could be a missed approach or a hold).
    expect(headingAlong(at(nearJfk, initialBearing(nearJfk, JFK), null), LHR, JFK)).toBeNull();
  });

  it('off the corridor is never flying the route', () => {
    expect(flyingRoute(at([-95, 33], 60), LHR, JFK)).toBe(false);
  });
});
