import { describe, expect, it } from 'vitest';
import { initialBearing, interpolate, type LngLatTuple } from '@/lib/geo';
import {
  APPROACH_MIN,
  blockMinutes,
  corridorMatch,
  corridorMinAltFt,
  corridorReject,
  daylightSamples,
  estimatesByClass,
  etaMs,
  greatCircle,
  onCorridor,
  progressOn,
  samplePoints,
  selectDiversions,
} from './geometry';

const LHR: LngLatTuple = [-0.461941, 51.4706];
const JFK: LngLatTuple = [-73.7781, 40.6413];
const NRT: LngLatTuple = [140.386, 35.7647];
const LAX: LngLatTuple = [-118.408, 33.9425];
const SVO: LngLatTuple = [37.4146, 55.9726];
const SYD: LngLatTuple = [151.177, -33.9461];
const SCL: LngLatTuple = [-70.7858, -33.393];
const AKL: LngLatTuple = [174.792, -37.0082];
const EZE: LngLatTuple = [-58.5358, -34.8222];

const maxStep = (pts: LngLatTuple[]) => Math.max(...pts.slice(1).map((p, i) => Math.abs(p[0] - pts[i]![0])));

describe('greatCircle', () => {
  it('LHR → JFK: 5,540 ± 30 km, initial bearing 288 ± 2°, ≥ 128 points', () => {
    const gc = greatCircle(LHR, JFK);
    expect(gc.distanceKm).toBeGreaterThan(5510);
    expect(gc.distanceKm).toBeLessThan(5570);
    expect(gc.distanceNm).toBeCloseTo(gc.distanceKm / 1.852, 0);
    expect(gc.initialBearing).toBeGreaterThan(286);
    expect(gc.initialBearing).toBeLessThan(290);
    expect(gc.finalBearing).toBeGreaterThan(225);
    expect(gc.finalBearing).toBeLessThan(240);
    expect(gc.points.length).toBeGreaterThanOrEqual(128);
    expect(gc.points[0]).toEqual([expect.closeTo(LHR[0], 4), expect.closeTo(LHR[1], 4)]);
    expect(gc.antimeridianCrossings).toBe(0);
    expect(gc.polar).toBe(false);
    // The midpoint of a northern transatlantic arc sits north of both ends.
    expect(gc.midpoint[1]).toBeGreaterThan(51.5);
    expect(gc.multiLineString.coordinates).toHaveLength(1);
  });

  it.each([
    ['NRT → LAX', NRT, LAX],
    ['SYD → SCL', SYD, SCL],
    ['AKL → EZE', AKL, EZE],
  ])('%s crosses the antimeridian without a jump (unwrapped) and splits for GeoJSON', (_n, a, b) => {
    const gc = greatCircle(a, b);
    expect(gc.antimeridianCrossings).toBe(1);
    expect(maxStep(gc.points)).toBeLessThan(10);
    // Unwrapped: some longitudes leave [-180, 180] so the line never wraps across the map.
    expect(gc.points.some(([lng]) => lng > 180 || lng < -180)).toBe(true);
    expect(gc.multiLineString.coordinates).toHaveLength(2);
    for (const seg of gc.multiLineString.coordinates) for (const [lng] of seg) expect(Math.abs(lng!)).toBeLessThanOrEqual(180);
  });

  it('SVO → LAX is a polar route', () => {
    const gc = greatCircle(SVO, LAX);
    expect(gc.polar).toBe(true);
    expect(Math.max(...gc.points.map(([, lat]) => lat))).toBeGreaterThan(75);
    expect(maxStep(gc.points)).toBeLessThan(30);
  });
});

describe('estimates', () => {
  it('block = distance / cruise + 30 min', () => {
    expect(blockMinutes(450 * 1.852, 450)).toBe(90);
    expect(blockMinutes(0, 450)).toBe(30);
    const e = estimatesByClass(5555);
    expect(e.widebody.cruiseKts).toBe(480);
    expect(e.widebody.blockMinutes).toBe(Math.round((5555 / (480 * 1.852)) * 60 + 30));
    expect(e.turboprop.blockMinutes).toBeGreaterThan(e.narrowbody.blockMinutes);
    expect(e.bizjet.cruiseKts).toBe(460);
  });
});

describe('daylightSamples', () => {
  it('10 samples, fractions 0 → 1, day at noon over London', () => {
    const noon = Date.parse('2026-06-21T12:00:00Z');
    const d = daylightSamples(LHR, JFK, noon);
    expect(d).toHaveLength(10);
    expect(d[0]!.fraction).toBe(0);
    expect(d[9]!.fraction).toBe(1);
    expect(d[0]).toEqual({ fraction: 0, isDay: true, twilight: 'day' });
  });

  it('night over London at midnight in December', () => {
    const d = daylightSamples(LHR, JFK, Date.parse('2026-12-21T00:00:00Z'));
    expect(d[0]!.isDay).toBe(false);
    expect(d[0]!.twilight).toBe('night');
  });
});

describe('samplePoints', () => {
  it('interior points only, normalised longitudes', () => {
    const s = samplePoints(NRT, LAX, 8);
    expect(s).toHaveLength(8);
    expect(s[0]!.fraction).toBeGreaterThan(0);
    expect(s[7]!.fraction).toBeLessThan(1);
    for (const { point } of s) expect(Math.abs(point[0])).toBeLessThanOrEqual(180);
  });
});

describe('selectDiversions', () => {
  const cands = [
    { code: 'SNN', name: 'Shannon', lat: 52.702, lng: -8.9248, runwayM: 3199 },
    { code: 'KEF', name: 'Keflavik', lat: 63.985, lng: -22.6056, runwayM: 3065 },
    // On the great circle two thirds of the way (computed, so the test does not depend on atlas values).
    { code: 'MID', name: 'On path', lat: interpolate(LHR, JFK, 2 / 3)[1], lng: interpolate(LHR, JFK, 2 / 3)[0], runwayM: 2591 },
    { code: 'ORK', name: 'Cork', lat: 51.8413, lng: -8.4911, runwayM: 2133 },
    { code: 'LGW', name: 'Gatwick', lat: 51.1481, lng: -0.1903, runwayM: 3316 },
    { code: 'MAD', name: 'Madrid', lat: 40.4719, lng: -3.5626, runwayM: 4349 },
    { code: 'NUL', name: 'No runway data', lat: 55, lng: -30, runwayM: null },
  ];
  it('keeps long runways near the path, strictly between the ends, in path order', () => {
    const d = selectDiversions(LHR, JFK, cands, new Set(['LHR', 'JFK']));
    const codes = d.map((x) => x.code);
    expect(codes).toContain('SNN');
    expect(codes).toContain('MID');
    expect(codes).not.toContain('ORK'); // runway < 2,400 m
    expect(codes).not.toContain('MAD'); // far from the path
    expect(codes).not.toContain('NUL');
    expect(codes).not.toContain('KEF'); // > 200 km north of the LHR–JFK great circle
    const along = d.map((x) => x.alongPathKm);
    expect([...along].sort((a, b) => a - b)).toEqual(along);
    for (const x of d) expect(x.distanceFromPathKm).toBeLessThanOrEqual(200);
  });

  it('honours the exclude set and one airport per 300 km stretch', () => {
    const near = [
      { code: 'AAA', name: 'A', lat: 52.7, lng: -8.9, runwayM: 3000 },
      { code: 'BBB', name: 'B', lat: 52.71, lng: -8.95, runwayM: 3500 },
    ];
    const d = selectDiversions(LHR, JFK, near);
    expect(d).toHaveLength(1);
    expect(selectDiversions(LHR, JFK, near, new Set(['AAA', 'BBB']))).toEqual([]);
  });
});

describe('live helpers', () => {
  const mid = greatCircle(LHR, JFK).points[128]!;
  // Tracking straight at JFK from mid-route (the local great-circle bearing, ≈ 260°).
  const bearing = Math.round(initialBearing(mid, JFK));
  it('progressOn: mid-route ≈ 0.5 and remaining ≈ half', () => {
    const p = progressOn(mid, LHR, JFK);
    expect(p.progress).toBeGreaterThan(0.45);
    expect(p.progress).toBeLessThan(0.55);
    expect(p.remainingKm).toBeGreaterThan(2600);
    expect(p.remainingKm).toBeLessThan(2900);
  });

  it('corridorMatch requires altitude, heading and position', () => {
    const base = { lat: mid[1], lng: mid[0], altFt: 37000, gsKt: 480, trackDeg: bearing, vrFpm: 0 };
    expect(corridorMatch(base, LHR, JFK)).toBe(true);
    expect(corridorMatch({ ...base, altFt: 5000 }, LHR, JFK)).toBe(false);
    expect(corridorMatch({ ...base, trackDeg: 90 }, LHR, JFK)).toBe(false);
    expect(corridorMatch({ ...base, trackDeg: null }, LHR, JFK)).toBe(false);
    expect(corridorMatch({ ...base, lat: mid[1] + 5 }, LHR, JFK)).toBe(false);
    expect(corridorMatch({ ...base, lat: LHR[1], lng: LHR[0] }, LHR, JFK)).toBe(false); // at the origin (< 2 %)
    expect(corridorMatch(base, LHR, [-0.2, 51.2])).toBe(false); // too short a route
    expect(onCorridor(mid, LHR, JFK)).toBe(true);
    expect(onCorridor([100, 0], LHR, JFK)).toBe(false);
  });

  it('corridorReject names the failed test (R2-M2 tightening)', () => {
    const base = { lat: mid[1], lng: mid[0], altFt: 37000, gsKt: 480, trackDeg: bearing, vrFpm: 0 };
    expect(corridorReject(base, LHR, JFK)).toBeNull();
    expect(corridorMinAltFt(5500)).toBe(25_000);
    expect(corridorReject({ ...base, altFt: 22_000 }, LHR, JFK)).toBe('altitude'); // below the long-haul cruise band
    expect(corridorReject({ ...base, trackDeg: bearing + 25 }, LHR, JFK)).toBe('heading');
    expect(corridorReject({ ...base, trackDeg: bearing + 12 }, LHR, JFK)).toBe('course'); // along the path, not at JFK
    expect(corridorReject({ ...base, trackDeg: (bearing + 180) % 360 }, LHR, JFK)).toBe('heading'); // opposite direction
    // 250 km short of JFK on the arc: every arrival converges here, so nothing is inferred.
    const nearJfk = interpolate(LHR, JFK, 0.955);
    expect(corridorReject({ ...base, lat: nearJfk[1], lng: nearJfk[0], trackDeg: Math.round(initialBearing(nearJfk, JFK)) }, LHR, JFK)).toBe('near-endpoint');
  });

  it('etaMs: steady cruise, blended when slow/climbing, null without speed', () => {
    const now = Date.parse('2026-09-30T20:00:00Z');
    const cruise = etaMs(480 * 1.852, { gsKt: 480, vrFpm: 0 }, now)!;
    expect(Math.abs(cruise - (now + 3_600_000 + APPROACH_MIN * 60_000))).toBeLessThan(1000);
    const climbing = etaMs(390 * 1.852, { gsKt: 300, vrFpm: 2000 }, now)!;
    expect(Math.abs(climbing - (now + 3_600_000 + APPROACH_MIN * 60_000))).toBeLessThan(1000);
    expect(etaMs(889, { gsKt: null, vrFpm: null }, now)).toBeNull();
    expect(etaMs(889, { gsKt: 20, vrFpm: null }, now)).toBeNull();
  });
});
