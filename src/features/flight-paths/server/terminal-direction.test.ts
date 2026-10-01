// R4 round 4 M1 (synthetic positions from the reviewer's repro, 2026-10-01; AAL606 is a real VRS
// KDFW-KJFK service): within 150 km of an endpoint headingAlong() ignored the track whenever the
// vertical rate was small, so a level aircraft tracking INTO DFW, or a JFK departure in a SID
// level-off, was "flying DFW→JFK" and /api/route/live listed it MATCHED forward with an ETA at JFK.
import { describe, expect, it } from 'vitest';
import type { FlightRecord } from '@/features/aviation/adsb';
import { headingAlong } from '../lib/geometry';
import { findAirport, vrsIndex } from './data';
import { aircraftOnRoute } from './live';

const NOW = Date.parse('2026-10-01T05:20:00Z');
const DFW = findAirport('DFW')!;
const JFK = findAirport('JFK')!;
type S = { lat: number; lng: number; altFt: number; gsKt: number; trackDeg: number; vrFpm: number };
const rec = (s: S): FlightRecord =>
  ({
    id: 'ad049a', callsign: 'AAL606', registration: null, typeCode: 'A321', bucket: 'commercial', isHelicopter: false, onGround: false, altGeomFt: null,
    squawk: null, emergency: null, category: 'A3', nacP: 9, dbFlags: 0, seenAt: NOW / 1000 - 5, source: 'adsblol_tiles', posSource: 'adsb', ...s,
  }) as FlightRecord;
const on = (s: S, reverse = false) => aircraftOnRoute([rec(s)], DFW, JFK, { reverse, now: NOW, vrs: vrsIndex() });

describe('MATCHED direction in the terminal area (round 4 M1)', () => {
  it('the fixture callsign really is a VRS DFW→JFK service', () => {
    expect(vrsIndex().byPair.get('KDFW-KJFK') ?? []).toContain('AAL606');
  });

  it('level inbound to DFW (100 km E, track 265°, vr 0) is not flying DFW→JFK', () => {
    const s = { lat: 32.95, lng: -96.0, altFt: 11000, gsKt: 280, trackDeg: 265, vrFpm: 0 };
    expect(headingAlong(s, [DFW.lng, DFW.lat], [JFK.lng, JFK.lat])).toBe(false);
    expect(on(s)).toEqual([]);
  });

  it('a JFK departure in a SID level-off (60 km SW, track 230°, vr 0) is not a DFW→JFK arrival with an ETA', () => {
    const s = { lat: 40.25, lng: -74.35, altFt: 5000, gsKt: 250, trackDeg: 230, vrFpm: 0 };
    expect(headingAlong(s, [DFW.lng, DFW.lat], [JFK.lng, JFK.lat])).toBe(false);
    expect(on(s)).toEqual([]);
  });

  it('still matched: climbing out of DFW toward the east, and descending into JFK on a downwind leg', () => {
    const climbOut = { lat: 32.95, lng: -96.0, altFt: 11000, gsKt: 300, trackDeg: 70, vrFpm: 2000 };
    expect(on(climbOut)).toMatchObject([{ callsign: 'AAL606', basis: 'matched', direction: 'forward' }]);
    const downwind = { lat: 40.25, lng: -74.35, altFt: 5000, gsKt: 220, trackDeg: 230, vrFpm: -1200 };
    expect(on(downwind)).toMatchObject([{ callsign: 'AAL606', basis: 'matched', direction: 'forward' }]);
  });

  it('the inbound-DFW aircraft is listed only as reverse traffic with reverse=1', () => {
    const s = { lat: 32.95, lng: -96.0, altFt: 11000, gsKt: 280, trackDeg: 265, vrFpm: -800 };
    expect(on(s)).toEqual([]);
    expect(on(s, true)).toMatchObject([{ callsign: 'AAL606', direction: 'reverse' }]);
  });

  it('ETA runs from the observation time (round 4 m1)', () => {
    const s = { lat: 36, lng: -86, altFt: 35000, gsKt: 480, trackDeg: 60, vrFpm: 0 };
    const fresh = aircraftOnRoute([rec(s)], DFW, JFK, { reverse: false, now: NOW, vrs: vrsIndex() })[0]!;
    const old = aircraftOnRoute([{ ...rec(s), seenAt: NOW / 1000 - 125 }], DFW, JFK, { reverse: false, now: NOW, vrs: vrsIndex() })[0]!;
    expect(Date.parse(fresh.eta!) - Date.parse(old.eta!)).toBe(120_000);
  });
});
