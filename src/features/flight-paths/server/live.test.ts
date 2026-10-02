import { describe, expect, it } from 'vitest';
import { normalizeAdsbRow, type AdsbRow, type FlightRecord } from '@/features/aviation/adsb';
import type { LngLatTuple } from '@/lib/geo';
import points from '../__fixtures__/adsblol-point-lhr-jfk-ends.json';
import { buildVrsIndex, findAirport } from './data';
import { aircraftOnRoute, inferReject } from './live';

// Real rows from two adsb.lol /v2/point probes on 2026-10-01 (west of Ireland and New England).
const records: FlightRecord[] = (points.ac as AdsbRow[]).flatMap((row) => {
  const r = normalizeAdsbRow(row, points.now, 'adsblol_point');
  return r.kind === 'ok' ? [r.record] : [];
});
const byCallsign = (cs: string) => {
  const r = records.find((x) => x.callsign === cs);
  if (!r) throw new Error(`fixture lacks ${cs}`);
  return r;
};
const LHR = findAirport('LHR')!;
const JFK = findAirport('JFK')!;
const A: LngLatTuple = [LHR.lng, LHR.lat];
const B: LngLatTuple = [JFK.lng, JFK.lat];
const vrs = buildVrsIndex({
  version: 1,
  generatedAt: '2026-10-01T00:00:00Z',
  lastModified: null,
  licence: 'CC0-1.0',
  chains: { 'EGLL-KJFK': ['BAW117'], 'KJFK-EGLL': ['BAW290'], 'HECA-KJFK': ['MSR981'] },
});

describe('corridor inference (R2-M2)', () => {
  it('fixture is real-shaped and normalises', () => {
    expect(records.length).toBeGreaterThan(60);
  });

  it('rejects regional types, cargo, military, bizjets and known other routes', () => {
    expect(inferReject(byCallsign('RPA5593'), A, B, 'EGLL', 'KJFK', undefined)).toBe('short-range-type');
    expect(inferReject(byCallsign('FDX1273'), A, B, 'EGLL', 'KJFK', undefined)).toBe('cargo');
    expect(inferReject(byCallsign('UPS1017'), A, B, 'EGLL', 'KJFK', undefined)).toBe('cargo');
    expect(inferReject(byCallsign('DUCE53'), A, B, 'EGLL', 'KJFK', undefined)).toBe('category');
    expect(inferReject(byCallsign('SIO007'), A, B, 'EGLL', 'KJFK', undefined)).toBe('category');
    expect(inferReject(byCallsign('MSR981'), A, B, 'EGLL', 'KJFK', ['HECA', 'KJFK'])).toBe('known-route');
  });

  it('rejects a domestic leg near the destination, the opposite heading and low altitude', () => {
    // A321 domestic leg ~230 km from JFK: too close to the endpoint for any inference.
    const dal = byCallsign('DAL1474');
    expect(inferReject({ ...dal, trackDeg: 245 }, A, B, 'EGLL', 'KJFK', undefined)).toBe('altitude');
    expect(inferReject({ ...dal, trackDeg: 245, altFt: 35_000 }, A, B, 'EGLL', 'KJFK', undefined)).toBe('near-endpoint');
    // A real eastbound widebody west of Ireland, against LHR→JFK.
    const dal22 = byCallsign('DAL22');
    expect(inferReject(dal22, A, B, 'EGLL', 'KJFK', undefined)).toBe('heading');
    // Same aircraft below the cruise band for a 5,500 km route.
    expect(inferReject({ ...dal22, altFt: 12_000 }, B, A, 'KJFK', 'EGLL', undefined)).toBe('altitude');
  });

  it('rejects a course that does not lead to the destination (eastbound off Ireland, not for London)', () => {
    // DAL70 (A339, 53.4N 9.1W, track 86°): on the JFK→LHR path but heading well north of London.
    expect(inferReject(byCallsign('DAL70'), B, A, 'KJFK', 'EGLL', undefined)).toBe('course');
    // AFR343 (B789, 50.5N 7.4W, track 110°): Paris-bound, too far off the great circle.
    expect(inferReject(byCallsign('AFR343'), B, A, 'KJFK', 'EGLL', undefined)).toBe('off-path');
  });

  it('LHR→JFK over the real snapshot: nothing westbound is inferred; reverse inference stays narrow', () => {
    const out = aircraftOnRoute(records, LHR, JFK, { reverse: true, now: points.now, vrs });
    const inferred = out.filter((a) => a.basis === 'inferred');
    expect(inferred.filter((a) => a.direction === 'forward')).toEqual([]);
    const names = inferred.map((a) => a.callsign);
    for (const cs of ['RPA5593', 'RPA3445', 'FDX1273', 'UPS1017', 'DUCE53', 'SIO007', 'MSR981', 'DAL1474', 'AAL1843', 'UAL1397', 'DAL70', 'AFR343']) expect(names).not.toContain(cs);
    // Every reverse inference is a commercial widebody/narrowbody at cruise, ≥ 400 km from both ends.
    for (const a of inferred) expect(a.altFt).toBeGreaterThanOrEqual(25_000);
    expect(inferred.length).toBeLessThanOrEqual(8);
    // Matched aircraft sort before inferred ones within a direction.
    const reverse = out.filter((a) => a.direction === 'reverse');
    expect(reverse.findIndex((a) => a.basis === 'inferred')).toBeGreaterThanOrEqual(reverse.filter((a) => a.basis === 'matched').length);
  });

  it('a VRS-matched callsign is matched even near the endpoint; without reverse=1 nothing reverse appears', () => {
    const out = aircraftOnRoute(records, JFK, LHR, { reverse: false, now: points.now, vrs });
    expect(out.find((a) => a.callsign === 'BAW290')).toMatchObject({ basis: 'matched', direction: 'forward' });
    expect(out.every((a) => a.direction === 'forward')).toBe(true);
  });
});
