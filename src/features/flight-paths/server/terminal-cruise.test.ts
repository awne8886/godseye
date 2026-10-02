// R4 round 5 M1 (round 4 M1 residual) and the live half of B1, on recorded live data
// (__fixtures__/r5/route-live-matched.json: every MATCHED aircraft of /api/route/live?reverse=1 on
// 20 busy pairs at 14:2xZ plus LIT-LAS at 14:16Z, 2026-10-01, joined with its flights-snapshot row
// for the vertical rate).
//  - UAL1239 (VRS KATL-KORD) departed JAX and cruised at FL340, vr 0, 73 km east of ATL tracking
//    341° — ATL 88° off its nose. Near b a level aircraft was rejected only beyond 90°, so it was
//    listed MATCHED reverse (ORD→ATL), progress 0.9999, ETA 14:38Z.
//  - SWA2331 (VRS LIT→LAS) flew SE 600 km south of the great circle toward Laredo; it was listed
//    MATCHED reverse on LIT-LAS with an ETA at LIT.
// Every other MATCHED aircraft (climbing out, descending in, cruising en route) must stay MATCHED.
import { describe, expect, it } from 'vitest';
import { decodeFlight } from '@/features/aviation/codec';
import type { Cell } from '@/lib/columnar';
import { distanceKm } from '@/lib/geo';
import { arrivalCeilingFt, departureCeilingFt, flyingRoute, headingAlong, reverseLegReject } from '../lib/geometry';
import { findAirport, vrsIndex } from './data';
import { aircraftOnRoute } from './live';
import fixture from '../__fixtures__/r5/route-live-matched.json';

interface Case {
  from: string;
  to: string;
  round5: { direction: 'forward' | 'reverse'; progress: number; eta: string | null };
  row: Cell[];
}
const cases = fixture.cases as unknown as Case[];
const rec = (c: Case) => decodeFlight(c.row, ['adsblol_tiles'])!;
const find = (cs: string) => cases.find((c) => c.row[1] === cs)!;
const on = (c: Case) => aircraftOnRoute([rec(c)], findAirport(c.from)!, findAirport(c.to)!, { reverse: true, now: rec(c).seenAt * 1000 + 5_000, vrs: vrsIndex() });

describe('a level cruise aircraft passing abeam an endpoint is not arriving there (round 5 M1)', () => {
  const ual = find('UAL1239');
  const ATL = findAirport('ATL')!;
  const ORD = findAirport('ORD')!;
  const s = rec(ual);

  it('the fixture: UAL1239 is a VRS ATL→ORD service, at FL340 level 73 km from ATL, round 5 listed it MATCHED reverse', () => {
    expect(vrsIndex().byPair.get('KATL-KORD') ?? []).toContain('UAL1239');
    expect({ altFt: s.altFt, vrFpm: s.vrFpm, km: Math.round(distanceKm([s.lng, s.lat], [ATL.lng, ATL.lat])) }).toEqual({ altFt: 34000, vrFpm: 0, km: 73 });
    expect(ual.round5).toMatchObject({ direction: 'reverse', progress: 0.9999 });
  });

  it('headingAlong(ORD→ATL) is false and flyingRoute is false: 88° off the bearing to ATL (cone 60°) and 20,000 ft above a level arrival', () => {
    expect(headingAlong(s, [ORD.lng, ORD.lat], [ATL.lng, ATL.lat], { b: ATL.elevationFt })).toBe(false);
    expect(flyingRoute(s, [ORD.lng, ORD.lat], [ATL.lng, ATL.lat], { b: ATL.elevationFt })).toBe(false);
    // Either test alone rejects it: the ceiling 39 nm out is ≈ 18,000 ft above ATL.
    expect(s.altFt! - (ATL.elevationFt ?? 0)).toBeGreaterThan(arrivalCeilingFt(73, false, true));
  });

  it('/api/route/live?from=ATL&to=ORD&reverse=1 no longer lists it (and never with an ETA at ATL)', () => {
    expect(on(ual)).toEqual([]);
  });

  it('mirrored near a: the same aircraft is not an ATL→ORD departure either (level at FL340, track 109° off the radial from ATL)', () => {
    expect(headingAlong(s, [ATL.lng, ATL.lat], [ORD.lng, ORD.lat], { a: ATL.elevationFt })).toBe(false);
    // Above a level departure's ceiling 39 nm out (twice the 3° slope + 5,000 ft) as well.
    expect(s.altFt! - (ATL.elevationFt ?? 0)).toBeGreaterThan(departureCeilingFt(73, false));
    // The same position (due east of ATL) climbing through 20,000 ft on the 090° radial would be a departure.
    expect(headingAlong({ ...s, altFt: 20_000, vrFpm: 1_800, trackDeg: 90 }, [ATL.lng, ATL.lat], [ORD.lng, ORD.lat], { a: ATL.elevationFt })).toBe(true);
  });
});

describe('an unlisted reverse leg on /api/route/live (round 5 B1, live)', () => {
  const swa = find('SWA2331');
  const LAS = findAirport('LAS')!;
  const LIT = findAirport('LIT')!;

  it('SWA2331 (VRS LIT→LAS only) heading 130° 600 km south of the LAS–LIT great circle: not MATCHED reverse on LIT-LAS', () => {
    expect(vrsIndex().byPair.get('KLIT-KLAS') ?? []).toContain('SWA2331');
    expect(vrsIndex().byPair.get('KLAS-KLIT') ?? []).not.toContain('SWA2331');
    expect(swa.round5.direction).toBe('reverse');
    expect(reverseLegReject(rec(swa), [LAS.lng, LAS.lat], [LIT.lng, LIT.lat])).toBe('course');
    expect(on(swa)).toEqual([]);
  });
});

describe('every other MATCHED aircraft of the 20 recorded pairs stays MATCHED, same direction', () => {
  for (const c of cases.filter((x) => x.row[1] !== 'UAL1239' && x.row[1] !== 'SWA2331')) {
    const r = rec(c);
    it(`${c.row[1]} on ${c.from}-${c.to} (${c.round5.direction}, alt ${r.altFt}, vr ${r.vrFpm})`, () => {
      expect(on(c)).toMatchObject([{ callsign: c.row[1], basis: 'matched', direction: c.round5.direction }]);
    });
  }
});
