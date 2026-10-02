import { describe, expect, it } from 'vitest';
import type { FlightRecord } from '../adsb';
import type { TrackPoint } from '../trace';
import { EARTH_RADIUS_M } from '@/lib/map/far-side';
import { TRAIL_LENGTH_S, buildTrips, headOf } from './trails';

const rec = (id: string, lng: number, lat: number, p: Partial<FlightRecord> = {}): FlightRecord => ({
  id, callsign: null, registration: null, typeCode: null, bucket: 'commercial', isHelicopter: false, onGround: false, lat, lng,
  altFt: 30000, altGeomFt: null, gsKt: 360, trackDeg: 90, vrFpm: 0, squawk: null, emergency: null, category: null, nacP: null,
  dbFlags: null, seenAt: Date.parse('2026-09-30T18:10:00Z') / 1000, source: 'adsblol_tiles', posSource: 'adsb', ...p,
});
const pt = (t: string, lng: number, lat: number, altFt: number | null = 30000): TrackPoint => ({
  t, lat, lng, altFt, onGround: altFt === null, gsKt: 360, trackDeg: 90,
});
const T0 = Date.parse('2026-09-30T18:00:00Z');
const track = [pt('2026-09-30T18:00:00Z', 0, 50), pt('2026-09-30T18:05:00Z', 0.5, 50), pt('2026-09-30T18:09:30Z', 1, 50)];

describe('watched trails (TripsLayer timestamps)', () => {
  it('maps observed sample times to seconds after the earliest vertex; head = dead-reckoned seenAt', () => {
    const live = rec('abc123', 1.1, 50);
    const now = Date.parse('2026-09-30T18:10:20Z');
    const set = buildTrips(['abc123'], new Map([['abc123', track]]), () => live, now, null)!;
    expect(set.baseMs).toBe(T0);
    expect(set.trips).toHaveLength(1);
    const [trip] = set.trips;
    expect(trip!.timestamps).toEqual([0, 300, 570, 620]); // 18:00, 18:05, 18:09:30, seen 18:10:00 + 20 s
    expect(set.currentTime).toBe(620);
    expect(trip!.path).toHaveLength(4);
    expect(trip!.path[3]![0]).toBeGreaterThan(1.1); // moved east along track 090
    expect(TRAIL_LENGTH_S).toBe(1800);
  });

  it('caps the head at 60 s after the observation (never stamped "now")', () => {
    const live = rec('abc123', 1.1, 50);
    const h = headOf(live, live.seenAt * 1000 + 3_600_000)!;
    expect(h.t).toBe(live.seenAt * 1000 + 60_000);
    const late = buildTrips(['abc123'], new Map([['abc123', track]]), () => live, live.seenAt * 1000 + 3_600_000, null)!;
    expect(late.currentTime).toBe(660);
  });

  it('ends at the last sample when the aircraft is not in the snapshot, or the trace is newer', () => {
    const gone = buildTrips(['abc123'], new Map([['abc123', track]]), () => undefined, T0 + 3_600_000, null)!;
    expect(gone.trips[0]!.timestamps).toEqual([0, 300, 570]);
    expect(gone.currentTime).toBe(570);
    const old = rec('abc123', 1.1, 50, { seenAt: T0 / 1000 + 100 });
    const stale = buildTrips(['abc123'], new Map([['abc123', track]]), () => old, T0 + 120_000, null)!;
    expect(stale.trips[0]!.timestamps).toEqual([0, 300, 570]);
  });

  it('skips out-of-order samples instead of re-dating them, and draws nothing from one vertex', () => {
    const shuffled = [track[0]!, track[2]!, track[1]!];
    const set = buildTrips(['abc123'], new Map([['abc123', shuffled]]), () => undefined, T0, null)!;
    expect(set.trips[0]!.timestamps).toEqual([0, 570]);
    expect(buildTrips(['abc123'], new Map([['abc123', [track[0]!]]]), () => undefined, T0, null)).toBeNull();
    expect(buildTrips(['abc123'], new Map(), () => undefined, T0, null)).toBeNull();
  });

  it('splits at the antimeridian with an interpolated vertex and time', () => {
    const cross = [pt('2026-09-30T18:00:00Z', 179, 10), pt('2026-09-30T18:10:00Z', -179, 12)];
    const set = buildTrips(['abc123'], new Map([['abc123', cross]]), () => undefined, T0, null)!;
    expect(set.trips.map((t) => t.path)).toEqual([[[179, 10], [180, 11]], [[-180, 11], [-179, 12]]]);
    expect(set.trips.map((t) => t.timestamps)).toEqual([[0, 300], [300, 600]]);
  });

  it('cuts the far side on the globe (same isFacing test as the icons) and keeps the timestamps aligned', () => {
    // Camera over 0°E at ~3.68 R: horizon ≈ 78° (+ the aircraft's own lift); 120°E is behind the limb.
    const camera = { lng: 0, lat: 0, altitude: 3.68 * EARTH_RADIUS_M };
    const far = [pt('2026-09-30T18:00:00Z', 0, 0), pt('2026-09-30T18:01:00Z', 10, 0), pt('2026-09-30T18:02:00Z', 120, 0), pt('2026-09-30T18:03:00Z', 20, 0), pt('2026-09-30T18:04:00Z', 30, 0)];
    const set = buildTrips(['abc123'], new Map([['abc123', far]]), () => undefined, T0, camera)!;
    expect(set.trips.map((t) => t.timestamps)).toEqual([[0, 60], [180, 240]]);
    expect(set.currentTime).toBe(240);
    const all = buildTrips(['abc123'], new Map([['abc123', far]]), () => undefined, T0, null)!;
    expect(all.trips[0]!.path).toHaveLength(5); // mercator keeps everything
  });
});
