import { describe, expect, it } from 'vitest';
import { distanceKm } from '@/lib/geo';
import { FLIGHT_FIELDS, FlightsResponse } from '@/lib/schemas/aviation';
import { MAX_RESPONSE_BYTES } from '@/lib/respond';
import type { FlightRecord } from './adsb';
import { BUCKETS, F, MAX_DEAD_RECKON_S, deadReckon, decodeFlight, encodeFlight } from './codec';

const rec = (i: number): FlightRecord => ({
  id: (0x100000 + i).toString(16),
  callsign: `TST${String(i % 10000).padStart(4, '0')}`,
  registration: `N${(i % 99999) + 1}AB`,
  typeCode: 'B77W',
  bucket: BUCKETS[i % 4]!,
  isHelicopter: i % 50 === 0,
  onGround: i % 17 === 0,
  lat: Math.round((((i * 7.3) % 170) - 85) * 1e5) / 1e5 + 0.12345,
  lng: Math.round((((i * 13.7) % 350) - 175) * 1e5) / 1e5 + 0.12345,
  altFt: 37_025,
  altGeomFt: 38_150,
  gsKt: 487.3,
  trackDeg: 271.4,
  vrFpm: -1_216,
  squawk: '7700',
  emergency: '7700',
  category: 'A5',
  nacP: 10,
  dbFlags: 8,
  seenAt: 1_790_791_610,
  source: 'adsblol_tiles',
  posSource: 'adsb',
});

describe('columnar FLIGHT_FIELDS rows', () => {
  it('round-trips a record through the compact row', () => {
    const r = rec(3);
    const row = encodeFlight(r, 0);
    expect(row).toHaveLength(FLIGHT_FIELDS.length);
    expect(row[F.bucket]).toBe(BUCKETS.indexOf(r.bucket));
    expect(row[F.onGround]).toBe(0);
    expect(decodeFlight(row, ['adsblol_tiles'])).toEqual({ ...r, posSource: null });
  });

  it('keeps 24 000 worst-case aircraft under the 4 MB response cap', () => {
    const rows = Array.from({ length: 24_000 }, (_, i) => encodeFlight(rec(i), i % 7));
    const body = {
      fields: [...FLIGHT_FIELDS],
      rows,
      sources: ['adsblol_tiles', 'adsblol_mil', 'adsblol_ladd', 'adsblol_pia', 'adsblol_reapi', 'opensky', 'adsbfi_mil'],
      counts: { commercial: 6000, private: 6000, jet: 6000, military: 6000, total: 24_000, noPosition: 120 },
      meta: { feed: 'flights', kind: 'live', state: 'live', fetchedAt: '2026-09-30T18:07:00.000Z', observedAt: '2026-09-30T18:06:59.000Z', lastGoodAt: '2026-09-30T18:07:00.000Z', stale: false, ttlSeconds: 15, attribution: [{ text: 'Aircraft data © adsb.lol contributors, ODbL 1.0' }] },
      providers: { adsblol_tiles: { ok: true, count: 24_000, ms: 1200, age_s: 3 } },
    };
    expect(FlightsResponse.safeParse(body).success).toBe(true);
    const bytes = Buffer.byteLength(JSON.stringify(body));
    expect(bytes).toBeLessThan(MAX_RESPONSE_BYTES);
  });
});

describe('dead-reckoning (§0: own track/speed only, ≤ 60 s, then freeze)', () => {
  const a = { lat: 51, lng: 0, gsKt: 480, trackDeg: 90, onGround: false, seenAt: 1000 };

  it('extrapolates along the reported track at the reported speed', () => {
    const r = deadReckon(a, 1030 * 1000);
    expect(r.extrapolatedS).toBe(30);
    expect(r.frozen).toBe(false);
    expect(distanceKm([0, 51], [r.lng, r.lat])).toBeCloseTo((480 * 1.852 * 30) / 3600, 1);
    expect(r.lng).toBeGreaterThan(0);
  });

  it('caps at 60 s and then freezes', () => {
    const at60 = deadReckon(a, (1000 + MAX_DEAD_RECKON_S) * 1000);
    const at300 = deadReckon(a, 1300 * 1000);
    expect(at300.extrapolatedS).toBe(MAX_DEAD_RECKON_S);
    expect(at300.frozen).toBe(true);
    expect(at300.lng).toBeCloseTo(at60.lng, 9);
  });

  it('never moves aircraft on the ground or without track/speed', () => {
    expect(deadReckon({ ...a, onGround: true }, 1030_000)).toMatchObject({ lat: 51, lng: 0, extrapolatedS: 0 });
    expect(deadReckon({ ...a, trackDeg: null }, 1030_000)).toMatchObject({ lat: 51, lng: 0, extrapolatedS: 0 });
    expect(deadReckon({ ...a, gsKt: null }, 1030_000)).toMatchObject({ lat: 51, lng: 0, extrapolatedS: 0 });
  });

  it('does not extrapolate backwards when the clock is behind the observation', () => {
    expect(deadReckon(a, 990 * 1000)).toMatchObject({ lat: 51, lng: 0, frozen: false });
  });
});
