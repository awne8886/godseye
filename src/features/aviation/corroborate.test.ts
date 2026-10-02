import { describe, expect, it } from 'vitest';
import legs from './__fixtures__/route-legs-2026-10-01.json';
import r5 from './__fixtures__/route-r5-2026-10-01.json';
import fp from './__fixtures__/route-fixpass-2026-10-01.json';
import ual374 from '@/features/flight-paths/__fixtures__/r3/flight-UAL374.json';
import traceA5d31d from '@/features/flight-paths/__fixtures__/r3/trace-a5d31d.json';
import { flyingRoute } from '@/features/flight-paths/lib/geometry';
import { distanceKm } from '@/lib/geo';
import { alongCorridor, awayFromDestination, corroborateLeg, headingFor, lastTakeoff, legTakeoff, onCourseFor, sinceTurnaround, type LegEnd } from './corroborate';
import { onRouteCorridor, pickLeg, type RoutePosition } from './route-geometry';

// R2 round 5 BLOCKING-1 cases: real adsb.lol traces (2026-10-01, fetched 16:07Z) and VRS standing
// data (fetched 16:15Z); `observed` is the trace row nearest the position R2 recorded at 13:2xZ.
type R5 = (typeof r5.cases)[number];
const r5Case = (cs: string): R5 => r5.cases.find((c) => c.cs === cs)!;
const posOf = (c: R5): RoutePosition => ({ lat: c.observed.lat, lng: c.observed.lng, speedKt: c.observed.gsKt, trackDeg: c.observed.trackDeg, altFt: c.observed.altFt, vrFpm: c.observed.vrFpm });
const legOf = (c: R5): [LegEnd, LegEnd] => pickLeg(c.airports, [c.observed.lng, c.observed.lat], c.observed.trackDeg);

// R2 round 4 scans (2026-10-01 05:15–05:21Z), 744 aircraft with a listed route.
type Legs = (typeof legs.multi)[number];
const ap = (a: (string | number)[]) => ({ icao: a[0] as string, lat: a[1] as number, lng: a[2] as number });
const legsCase = (cs: string): Legs => legs.multi.find((c) => c.cs === cs)!;
const legsPos = (c: Legs): RoutePosition => ({ lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg });

describe('awayFromDestination: the trigger no longer needs "toward the origin"', () => {
  it('fires for SWA1241, UAL1789 and SWA1332 (away from the listed destination, not toward the origin)', () => {
    for (const cs of ['SWA1241', 'UAL1789', 'SWA1332']) {
      const c = r5Case(cs);
      const [o, d] = legOf(c);
      expect([o.icao, d.icao], cs).toEqual({ SWA1241: ['KLAS', 'KDCA'], UAL1789: ['KRDU', 'KIAD'], SWA1332: ['KATL', 'KMDW'] }[cs]);
      expect(awayFromDestination(o, d, posOf(c)), cs).toBe(true);
      // Not toward the origin either: the round 4 rule (toward o within 60°) let all three through.
      expect(headingFor({ ...posOf(c) }, o), cs).toBe(false);
    }
  });

  it('on the 744 recorded aircraft it fires only for the two known conflicts and eight aircraft off every corridor', () => {
    const fired: string[] = [];
    for (const c of [...legs.two, ...legs.multi]) {
      const aps = c.airports.map(ap);
      const [o, d] = pickLeg(aps, [c.lng, c.lat], c.trackDeg);
      if (!awayFromDestination(o, d, legsPos(c as Legs))) continue;
      fired.push(c.cs);
      if (!['UAL1118', 'WZZ1738'].includes(c.cs)) expect(onRouteCorridor(o, d, [c.lng, c.lat]), c.cs).toBe(false);
    }
    expect(fired.sort()).toEqual(['CXA8655', 'KYE9521', 'RYR737', 'RYR741', 'RYR742', 'RYR8879', 'UAL1118', 'UAL1564', 'UAL2464', 'WZZ1738']);
  });

  it('needs an observed track and is quiet within 60 km of either end (departure turns, arrival vectors)', () => {
    const c = legsCase('UAL1118');
    const [o, d] = c.airports.map(ap) as [ReturnType<typeof ap>, ReturnType<typeof ap>];
    expect(awayFromDestination(o, d, { ...legsPos(c), trackDeg: null })).toBe(false);
    expect(awayFromDestination(o, d, null)).toBe(false);
    expect(awayFromDestination(o, d, { lat: o.lat + 0.3, lng: o.lng, speedKt: 200, trackDeg: 270 })).toBe(false);
    expect(awayFromDestination(d, o, legsPos(c))).toBe(false); // flying toward its listed origin = toward the reverse leg's destination
  });
});

describe('onCourseFor: the FLIGHT view’s flyingRoute AND the direct bearing', () => {
  it('UAL1789 inside the IAD–RDU corridor on 237° is not on course for RDU (it landed at San Antonio)', () => {
    const c = r5Case('UAL1789');
    const [rdu, iad] = legOf(c);
    const p = posOf(c);
    // flight-paths 0ac5b6a: en route, flyingRoute itself now needs the course within 45° of the bearing to RDU.
    expect(flyingRoute({ lat: p.lat, lng: p.lng, altFt: p.altFt!, gsKt: p.speedKt, trackDeg: p.trackDeg!, vrFpm: p.vrFpm! }, [iad.lng, iad.lat], [rdu.lng, rdu.lat])).toBe(false);
    expect(onCourseFor(p, iad, rdu)).toBe(false);
    expect(distanceKm([c.landed!.lng, c.landed!.lat], [-98.4698, 29.5337])).toBeLessThan(5); // KSAT
  });

  it('UAL1118 flying back toward Denver is on course for it — given a vertical rate within 150 km of CID', () => {
    const c = legsCase('UAL1118');
    const [den, cid] = c.airports.map(ap) as [ReturnType<typeof ap>, ReturnType<typeof ap>];
    const level = { ...legsPos(c), altFt: 34000, vrFpm: 0 };
    expect(onCourseFor(level, cid, den)).toBe(true);
    expect(onCourseFor(level, den, cid)).toBe(false);
    // The FLIGHT view's terminal-area rule: near an end, an unknown vertical rate leaves the direction unknown.
    expect(onCourseFor(legsPos(c), cid, den)).toBe(false);
  });
});

describe('lastTakeoff (AGL, latest take-off in the flown track)', () => {
  const den = { lat: 39.8617, lng: -104.673, elevationFt: 5434 };
  const cid = { lat: 41.8847, lng: -91.7108, elevationFt: 869 };
  const pt = (lat: number, lng: number, altFt: number | null, onGround = false) => ({ lat, lng, altFt, onGround });

  it('a take-off from the listed destination', () => {
    expect(lastTakeoff([pt(41.88, -91.72, null, true), pt(41.9, -91.9, 2500), pt(42.3, -92.1, 20000)], den, cid)?.end).toBe('d');
  });

  it('low near Denver is field elevation + 3,000 ft, i.e. below 8,434 ft MSL', () => {
    expect(lastTakeoff([pt(39.9, -104.6, 7900), pt(40.5, -100, 35000)], den, cid)?.end).toBe('o');
    expect(lastTakeoff([pt(39.9, -104.6, 9000), pt(40.5, -100, 35000)], den, cid)).toBeNull();
  });

  it('a take-off elsewhere has no end; none observed is null; a low point at the end (descending now) is not a take-off', () => {
    expect(lastTakeoff([pt(42.0, -87.9, 0, true), pt(42.2, -90, 30000)], den, cid)).toMatchObject({ end: null, lat: 42.0 });
    expect(lastTakeoff([], den, cid)).toBeNull();
    expect(lastTakeoff([pt(40.5, -100, 35000), pt(41.86, -91.7, 1500)], den, cid)).toBeNull();
  });

  it('reads the real traces: SWA1241 from BWI (51 km from DCA), UAL1789 from IAD, SWA1332 from Dallas Love Field', () => {
    const at = (cs: string) => {
      const c = r5Case(cs);
      const [o, d] = legOf(c);
      return lastTakeoff(c.track, o, d);
    };
    expect(at('SWA1241')?.end).toBe('d');
    expect(at('UAL1789')?.end).toBe('d');
    const dal = at('SWA1332')!;
    expect(dal.end).toBeNull();
    expect(distanceKm([dal.lng, dal.lat], [-96.8518, 32.8471])).toBeLessThan(25); // KDAL: the last point < 3,000 ft AGL of the climb-out
  });
});

describe('corroborateLeg on the three R2 round 5 cases (agrees with the FLIGHT view)', () => {
  const verdict = (cs: string, withTrack = true) => {
    const c = r5Case(cs);
    const [o, d] = legOf(c);
    return corroborateLeg(o, d, posOf(c), withTrack ? c.track : null, withTrack ? null : 'flown track lookup failed');
  };

  it('SWA1241: departed near DCA, not on course for LAS → withheld', () => {
    expect(verdict('SWA1241')).toEqual({ kind: 'withhold', routeCheck: 'observed departure DCA contradicts standing data LAS→DCA, and the aircraft is not on course for LAS — route not confirmed' });
  });

  it('UAL1789: departed IAD, not on course for RDU → withheld (not "flown IAD→RDU")', () => {
    expect(verdict('UAL1789')).toEqual({ kind: 'withhold', routeCheck: 'observed departure IAD contradicts standing data RDU→IAD, and the aircraft is not on course for RDU — route not confirmed' });
  });

  it('SWA1332: departed neither ATL nor MDW → withheld', () => {
    expect(verdict('SWA1332')).toEqual({ kind: 'withhold', routeCheck: 'observed departure is not ATL — contradicts standing data ATL→MDW; route not confirmed' });
  });

  it('UAL374 (VRS ORD-LAX, flight-paths r3 fixture): departed LAX along the corridor but on 100° with ORD at ~60° → withheld (it landed at Phoenix)', () => {
    // Airport coordinates: OurAirports. The trace a5d31d fetched 2026-10-01T16:49Z shows the
    // landing at KPHX 03:24Z; the FLIGHT view's lenient corridor test had shown "flown LAX→ORD".
    const ord: LegEnd = { icao: 'KORD', iata: 'ORD', lat: 41.9786, lng: -87.9048, elevationFt: 672 };
    const lax: LegEnd = { icao: 'KLAX', iata: 'LAX', lat: 33.9425, lng: -118.408, elevationFt: 125 };
    const p = ual374.position;
    const pos: RoutePosition = { lat: p.lat, lng: p.lng, speedKt: p.gsKt, trackDeg: p.trackDeg, altFt: p.altFt, vrFpm: 0 };
    expect(awayFromDestination(ord, lax, pos)).toBe(true);
    expect(alongCorridor(pos, lax, ord)).toBe(true); // what the FLIGHT view's `rev` saw
    expect(onCourseFor(pos, lax, ord)).toBe(false);
    expect(corroborateLeg(ord, lax, pos, traceA5d31d.track)).toEqual({
      kind: 'withhold',
      routeCheck: 'observed departure LAX contradicts standing data ORD→LAX, and the aircraft is not on course for ORD — route not confirmed',
    });
  });

  it('without a flown track every case is withheld, with the reason', () => {
    for (const cs of ['SWA1241', 'UAL1789', 'SWA1332']) {
      const v = verdict(cs, false);
      expect(v.kind, cs).toBe('withhold');
      expect('routeCheck' in v ? v.routeCheck : null, cs).toMatch(/departure not observed \(flown track lookup failed\) — route not confirmed$/);
    }
  });

  it('a take-off from the origin with a course away from the destination keeps the leg without progress', () => {
    const den: LegEnd = { icao: 'KDEN', iata: 'DEN', lat: 39.8617, lng: -104.673, elevationFt: 5434 };
    const cid: LegEnd = { icao: 'KCID', iata: 'CID', lat: 41.8847, lng: -91.7108, elevationFt: 869 };
    // 300 km east of Denver, tracking 180° (south): away from CID (bearing ~075°), not toward DEN.
    const pos: RoutePosition = { lat: 39.9, lng: -101.2, speedKt: 420, trackDeg: 180, altFt: 34000, vrFpm: 0 };
    const track = [
      { lat: 39.86, lng: -104.67, altFt: null, onGround: true },
      { lat: 39.9, lng: -104.5, altFt: 7400, onGround: false },
      { lat: 39.9, lng: -102.5, altFt: 33000, onGround: false },
    ];
    expect(awayFromDestination(den, cid, pos)).toBe(true);
    const v = corroborateLeg(den, cid, pos, track);
    expect(v.kind).toBe('listed');
    expect('routeCheck' in v ? v.routeCheck : null).toMatch(/^departed DEN but not observed on course for CID \(\d+ km off the great circle, track pointing away from CID\) — progress not shown$/);
  });
});

// Round 5 fix pass BLOCKING-1: the reviewer's live check (2026-10-01 20:3xZ; fixture `_captured`).
// The card showed these legs with a progress bar while the FLIGHT view withheld them.
type FP = (typeof fp.cases)[number];
const fpCase = (cs: string): FP => fp.cases.find((c) => c.cs === cs)!;
const fpPos = (c: FP): RoutePosition => ({ lat: c.observed.lat, lng: c.observed.lng, speedKt: c.observed.gsKt, trackDeg: c.observed.trackDeg, altFt: c.observed.altFt, vrFpm: c.observed.vrFpm });
const fpLeg = (c: FP): [LegEnd, LegEnd] => pickLeg(c.airports as LegEnd[], [c.observed.lng, c.observed.lat], c.observed.trackDeg);
const DEN: LegEnd = { icao: 'KDEN', iata: 'DEN', lat: 39.8617, lng: -104.673, elevationFt: 5434 };
const CID: LegEnd = { icao: 'KCID', iata: 'CID', lat: 41.8847, lng: -91.7108, elevationFt: 869 };
const tp = (t: string, lat: number, lng: number, altFt: number | null, trackDeg: number | null, onGround = false) => ({ t, lat, lng, altFt, onGround, trackDeg });

describe('legTakeoff: the take-off of the leg flown now (round 5 fix pass)', () => {
  it('TVF8023 (VRS GOBD-LFLL): the LYS take-off before a 299-min gap and a reversal of course was the previous leg', () => {
    const c = fpCase('TVF8023');
    const [o, d] = fpLeg(c);
    expect([o.icao, d.icao]).toEqual(['GOBD', 'LFLL']);
    expect(lastTakeoff(c.track, o, d)?.end).toBe('d');
    expect(sinceTurnaround(c.track).length).toBeLessThan(c.track.length);
    expect(legTakeoff(c.track, o, d, fpPos(c))).toBeNull();
    expect(corroborateLeg(o, d, fpPos(c), c.track)).toEqual({ kind: 'unobserved' });
  });

  it('DAL1957 (VRS MKJS-KJFK): the JFK take-off before a 193-min gap and a reversal of course likewise', () => {
    const c = fpCase('DAL1957');
    const [o, d] = fpLeg(c);
    expect(lastTakeoff(c.track, o, d)?.end).toBe('d');
    expect(legTakeoff(c.track, o, d, fpPos(c))).toBeNull();
  });

  it('a long gap without a reversal of course (coverage lost en route) keeps the take-off', () => {
    const track = [tp('2026-10-01T02:00:00Z', 39.86, -104.67, null, null, true), tp('2026-10-01T02:04:00Z', 39.9, -104.5, 7400, 80), tp('2026-10-01T02:10:00Z', 40.1, -103.5, 20000, 78), tp('2026-10-01T03:00:00Z', 41.0, -98.0, 35000, 76)];
    expect(legTakeoff(track, DEN, CID, { lat: 41.0, lng: -98.0 })?.end).toBe('o');
  });

  it('a trace that ends on the ground, or low more than 60 km from the aircraft, has no take-off for this leg', () => {
    const climb = [tp('2026-10-01T02:00:00Z', 39.86, -104.67, null, null, true), tp('2026-10-01T02:04:00Z', 39.9, -104.5, 7400, 80), tp('2026-10-01T02:30:00Z', 40.5, -100, 34000, 80)];
    const landedAtCid = [...climb, tp('2026-10-01T03:40:00Z', 41.88, -91.72, 1200, 90), tp('2026-10-01T03:42:00Z', 41.884, -91.711, null, null, true)];
    expect(legTakeoff(landedAtCid, DEN, CID, { lat: 41.0, lng: -94.0 })).toBeNull();
    const lowAtCid = landedAtCid.slice(0, -1);
    // 200 km west of CID now: the trace's landing was an earlier leg.
    expect(legTakeoff(lowAtCid, DEN, CID, { lat: 41.6, lng: -94.1 })).toBeNull();
    // Still descending into CID: the take-off from DEN is this leg's.
    expect(legTakeoff(lowAtCid, DEN, CID, { lat: 41.87, lng: -91.75 })?.end).toBe('o');
  });
});

describe('corroborateLeg for every airborne aircraft (round 5 fix pass BLOCKING-1: agrees with the FLIGHT view)', () => {
  const where: Record<string, [string, number, number]> = {
    SWA864: ['LAS', 36.08, -115.152],
    EJA761: ['Louisville', 38.228, -85.664],
    MMD6300: ['GVA', 46.238, 6.109],
    VIV7066: ['CUN', 21.036, -86.877],
    SWA4968: ['BNA', 36.124, -86.678],
  };
  for (const [cs, sched] of [
    ['SWA864', 'ONT→PHX'],
    ['EJA761', 'TEB→PHX'],
    ['MMD6300', 'FKB→SGD'],
    ['VIV7066', 'NLU→ACA'],
    ['SWA4968', 'DCA→ATL'],
  ] as const) {
    it(`${cs} (${fpCase(cs).route}, card ${fpCase(cs).card2034.basis} ${fpCase(cs).card2034.progress ?? ''}): took off at ${where[cs]![0]} → withheld`, () => {
      const c = fpCase(cs);
      const [o, d] = fpLeg(c);
      const pos = fpPos(c);
      // The old trigger: none of them flies away from its listed destination.
      expect(awayFromDestination(o, d, pos)).toBe(false);
      const t = legTakeoff(c.track, o, d, pos)!;
      expect(t.end).toBeNull();
      expect(distanceKm([t.lng, t.lat], [where[cs]![2], where[cs]![1]])).toBeLessThan(30);
      expect(corroborateLeg(o, d, pos, c.track)).toEqual({ kind: 'withhold', routeCheck: `observed departure is not ${sched.split('→')[0]} — contradicts standing data ${sched}; route not confirmed` });
    });
  }

  it('ASA418 (VRS KSEA-KMCI-KSEA) departed MCI flying west: the MCI→SEA leg, corroborated', () => {
    const c = fpCase('ASA418');
    const [o, d] = fpLeg(c);
    expect([o.icao, d.icao]).toEqual(['KMCI', 'KSEA']);
    expect(corroborateLeg(o, d, fpPos(c), c.track)).toEqual({ kind: 'departed', routeCheck: 'observed departure matches the listed origin MCI' });
    // The leg a trackless pick falls back to (the earlier one) is the reverse of what was flown.
    const [sea, mci] = pickLeg(c.airports as LegEnd[], [c.observed.lng, c.observed.lat], null);
    expect(corroborateLeg(sea, mci, fpPos(c), c.track).kind).toBe('reverse');
  });

  it('UAL1363 departed ORD and is on course: the leg with progress', () => {
    const c = fpCase('UAL1363');
    const [o, d] = fpLeg(c);
    expect(corroborateLeg(o, d, fpPos(c), c.track)).toEqual({ kind: 'departed', routeCheck: 'observed departure matches the listed origin ORD' });
  });

  it('ENY4242 departed FWA but flies 277 km off the FWA–DFW great circle: the listed leg without progress', () => {
    const c = fpCase('ENY4242');
    const [o, d] = fpLeg(c);
    expect(corroborateLeg(o, d, fpPos(c), c.track)).toEqual({ kind: 'listed', routeCheck: 'departed FWA but not observed on course for DFW (277 km off the great circle) — progress not shown' });
  });

  it('no take-off observed and nothing contradicting: the standing data stands', () => {
    const pos: RoutePosition = { lat: 41.0, lng: -98.0, speedKt: 450, trackDeg: 80, altFt: 35000, vrFpm: 0 };
    expect(corroborateLeg(DEN, CID, pos, null, 'no flown track available for this aircraft')).toEqual({ kind: 'unobserved' });
    expect(corroborateLeg(DEN, CID, pos, [tp('2026-10-01T02:30:00Z', 40.5, -100, 34000, 80)])).toEqual({ kind: 'unobserved' });
  });
});
