// Phase 1 review A regression (R-A2): §4 caps every /api response at 4 MB uncompressed.
// Deterministic worst-realistic fixtures (fully populated rows, no randomness).
import { describe, expect, it } from 'vitest';
import { FIRE_FIELDS, FLIGHT_FIELDS, FlightsResponse } from '@/lib/schemas';
import { toColumnar } from '@/lib/columnar';

const MB = 1024 * 1024;
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

function aircraftRow(i: number) {
  return {
    id: (0x400000 + i).toString(16),
    callsign: `BAW${1000 + (i % 9000)}`,
    registration: `G-${String.fromCharCode(65 + (i % 26))}XLE`,
    typeCode: 'A20N',
    bucket: 0,
    isHelicopter: 0,
    onGround: 0,
    lat: r5(51.123456 + (i % 1000) / 1000),
    lng: r5(-0.456789 - (i % 1000) / 1000),
    altFt: 37000,
    altGeomFt: 38125,
    gsKt: 452.3,
    trackDeg: 287.4,
    vrFpm: -1280,
    squawk: '5731',
    category: 'A3',
    nacP: 9,
    dbFlags: null,
    seenAt: 1_790_789_276,
    src: 0,
  };
}

const meta = { feed: 'flights', kind: 'live', state: 'live', fetchedAt: '2026-09-30T17:27:56.000Z', observedAt: '2026-09-30T17:27:56.000Z', lastGoodAt: '2026-09-30T17:27:56.000Z', stale: false, ttlSeconds: 15, attribution: [{ text: 'adsb.lol (ODbL)' }] };

describe('response sizes stay under 4 MB at documented scale', () => {
  it('flights: 24k aircraft (adsb.lol global peak) in the compact row format', () => {
    const items = Array.from({ length: 24_000 }, (_, i) => aircraftRow(i));
    const body = { meta, providers: {}, ...toColumnar(items, FLIGHT_FIELDS), sources: ['adsblol'], counts: { commercial: 24_000, private: 0, jet: 0, military: 0, total: 24_000, noPosition: 0 } };
    expect(FlightsResponse.safeParse(body).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(body)) / MB).toBeLessThan(4);
  });

  it('fires: the 30k-row cap fits', () => {
    const items = Array.from({ length: 30_000 }, (_, i) => ({
      id: `VIIRS_NOAA20_${1_000_000 + i}`, lat: r5(-12.34567 + i / 1e4), lng: r5(130.12345 - i / 1e4), frpMw: 12.3, brightnessK: 331.2,
      confidence: 'nominal', dayNight: 'D', satellite: 'NOAA20', seenAt: 1_790_789_276,
    }));
    const body = { meta, providers: {}, ...toColumnar(items, FIRE_FIELDS), totalDetections: 120_000, sampling: 'top FRP' };
    expect(Buffer.byteLength(JSON.stringify(body)) / MB).toBeLessThan(4);
  });
});
