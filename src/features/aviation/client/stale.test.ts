import { describe, expect, it } from 'vitest';
import type { FlightRecord } from '../adsb';
import { newFrame } from './layers';
import { countStaleByBucket, deriveLayerState, staleKey, stalenessState } from './stale';

const NOW = Date.parse('2026-10-01T02:08:00Z');
const rec = (id: string, ageS: number, bucket: FlightRecord['bucket'] = 'commercial'): FlightRecord => ({
  id, callsign: null, registration: null, typeCode: null, bucket, isHelicopter: false, onGround: false, lat: 51, lng: 0,
  altFt: 30000, altGeomFt: null, gsKt: 400, trackDeg: 90, vrFpm: 0, squawk: null, emergency: null, category: null, nacP: null,
  dbFlags: null, seenAt: NOW / 1000 - ageS, source: 'adsblol_tiles', posSource: 'adsb',
});

describe('stale count per bucket (MAJOR-C)', () => {
  it('counts aircraft strictly past the 60 s dead-reckoning cap, per bucket', () => {
    const f = newFrame([rec('a1', 5), rec('a2', 60), rec('a3', 61), rec('a4', 300), rec('m1', 90, 'military'), rec('p1', 10, 'private')]);
    const c = countStaleByBucket(f.seen, f.bucket, NOW);
    expect(c).toEqual({ commercial: 2, private: 0, jet: 0, military: 1 });
    expect(staleKey(c)).toBe(staleKey({ commercial: 2, private: 0, jet: 0, military: 1 }));
  });

  it('grows as time passes without a new snapshot', () => {
    const f = newFrame([rec('a1', 30), rec('a2', 50)]);
    expect(countStaleByBucket(f.seen, f.bucket, NOW).commercial).toBe(0);
    expect(countStaleByBucket(f.seen, f.bucket, NOW + 15_000).commercial).toBe(1);
    expect(countStaleByBucket(f.seen, f.bucket, NOW + 31_000).commercial).toBe(2);
  });
});

describe('layer state from the stale share', () => {
  it('keeps LIVE while at most half the positions are past the cap', () => {
    expect(deriveLayerState('live', 100, 0)).toBe('live');
    expect(deriveLayerState('live', 100, 50)).toBe('live');
  });

  it('never reads LIVE when a majority is past the cap', () => {
    expect(deriveLayerState('live', 100, 51)).toBe('recent');
    expect(deriveLayerState('live', 100, 87)).toBe('recent');
    expect(deriveLayerState('live', 100, 90)).toBe('stale');
  });

  it('does not flap around 50 % (hysteresis: leave RECENT below 40 %, STALE below 80 %)', () => {
    // R2 round 3: frozen share 0.57, 0.48, 0.53, 0.45 across polls toggled the LED every poll.
    let own: ReturnType<typeof stalenessState> | null = null;
    const states: string[] = [];
    for (const share of [57, 48, 53, 45, 41, 39, 52]) {
      states.push(deriveLayerState('live', 100, share, own));
      own = stalenessState(100, share, own);
    }
    expect(states).toEqual(['recent', 'recent', 'recent', 'recent', 'recent', 'live', 'recent']);
    expect(stalenessState(100, 85, 'stale')).toBe('stale');
    expect(stalenessState(100, 79, 'stale')).toBe('recent');
    expect(stalenessState(100, 85, 'recent')).toBe('recent');
    expect(stalenessState(0, 0, 'stale')).toBe('live');
  });

  it('never upgrades the feed state', () => {
    expect(deriveLayerState('offline', 100, 0)).toBe('offline');
    expect(deriveLayerState('stale', 100, 60)).toBe('stale');
    expect(deriveLayerState('recent', 100, 10)).toBe('recent');
    expect(deriveLayerState('live', 0, 0)).toBe('live');
  });
});
