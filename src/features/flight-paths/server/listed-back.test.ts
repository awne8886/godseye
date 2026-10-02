// Round 10 MINOR 4: DAL1311 (VRS KATL-KPBI-KATL, a round trip) departed PBI and flew back toward
// ATL on a track 29° off the direct bearing to ATL. The aircraft card (`corroborateLeg`) took the
// listed PBI→ATL leg ('departed'), while /api/flight applied the strict unlisted-reverse test
// (`headingFor`) and said "route not confirmed" for ~10 minutes. A leg the VRS chain lists now takes
// the card's corridor + trackAlong test; only an unlisted reverse leg needs `headingFor`.
// The airport index lists PBI as DJT/KDJT (ident KPBI), so the chain is matched by any of its codes.
// Fixture: positions synthesised along the PBI→ATL great circle (the recorded case's geometry).
import { describe, expect, it } from 'vitest';
import { initialBearing, type LngLatTuple } from '@/lib/geo';
import { corroborateLeg, headingFor } from '@/features/aviation/corroborate';
import { greatCircle } from '../lib/geometry';
import { findAirport, vrsIndex } from './data';
import { flightDetail, listedLeg, type FlightDeps } from './flight';

const ok = { ok: true, count: 1, ms: 1, age_s: 0 };
const NOW = Date.parse('2026-10-02T15:00:00Z');
const PBI: LngLatTuple = [-80.0956, 26.6832];
const ATL: LngLatTuple = [-84.4281, 33.6367];
const path = greatCircle(PBI, ATL).points;
const here = path[Math.round(path.length * 0.4)]!;
const toAtl = initialBearing(here, ATL);
const TRACK = (toAtl + 29) % 360;
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

// On the ground at PBI, the climb out, then cruise along the great circle to the present position.
const track = [
  { t: iso(40), lat: PBI[1], lng: PBI[0], altFt: null, onGround: true, gsKt: 10, trackDeg: 280 },
  { t: iso(38), lat: PBI[1] + 0.05, lng: PBI[0] - 0.05, altFt: 2000, onGround: false, gsKt: 200, trackDeg: 320 },
  ...[0.1, 0.2, 0.3].map((f, i) => {
    const p = path[Math.round(path.length * f)]!;
    return { t: iso(30 - i * 8), lat: p[1], lng: p[0], altFt: 30000, onGround: false, gsKt: 450, trackDeg: TRACK };
  }),
];

const record = {
  id: 'a1b2c3',
  callsign: 'DAL1311',
  registration: 'N123DL',
  typeCode: 'B739',
  bucket: 'commercial',
  isHelicopter: false,
  onGround: false,
  altGeomFt: null,
  vrFpm: 0,
  squawk: null,
  emergency: null,
  category: 'A3',
  nacP: 9,
  dbFlags: 0,
  seenAt: NOW / 1000,
  source: 'adsblol_tiles',
  posSource: 'adsb',
  lat: here[1],
  lng: here[0],
  altFt: 33000,
  gsKt: 460,
  trackDeg: TRACK,
};

const deps = {
  records: async () => ({ records: [record], run: { status: ok, okAt: NOW }, state: 'live' }),
  adsblol: async () => [],
  adsbdbRegistration: async () => null,
  // The route lookup names the chain's first leg (direction-blind), as it did live.
  route: async () => ({ found: true, source: 'vrs', stale: false, sourceUpdatedAt: '2026-09-20', origin: { icao: 'KATL', iata: 'ATL' }, destination: { icao: 'KPBI', iata: 'PBI' }, providers: { vrs: ok } }),
  aircraft: async () => ({ track, identity: null, providers: { adsblol_trace: ok } }),
  weather: async () => ({ byStation: new Map(), providers: {} }),
} as unknown as FlightDeps;

describe('a listed reverse leg takes the card rule (round 10 MINOR 4, DAL1311)', () => {
  it('the fixture is the disputed case: VRS lists ATL-PBI-ATL, track 29° off ATL fails headingFor', () => {
    expect(vrsIndex().chainOf.get('DAL1311')).toEqual(['KATL', 'KPBI', 'KATL']);
    expect(headingFor({ lat: here[1], lng: here[0], trackDeg: TRACK }, { lat: ATL[1], lng: ATL[0] })).toBe(false);
  });

  it('the aircraft card and /api/flight agree: the PBI→ATL leg of the standing-data route', async () => {
    const pbi = findAirport('KPBI')!;
    const atl = findAirport('KATL')!;
    const card = corroborateLeg(
      { lat: pbi.lat, lng: pbi.lng, iata: 'PBI', icao: 'KPBI', elevationFt: pbi.elevationFt },
      { lat: atl.lat, lng: atl.lng, iata: 'ATL', icao: 'KATL', elevationFt: atl.elevationFt },
      { lat: here[1], lng: here[0], speedKt: 460, trackDeg: TRACK, altFt: 33000, vrFpm: 0 },
      track,
    );
    expect(card.kind).toBe('departed');

    const d = (await flightDetail('DAL1311', deps, NOW))!;
    expect(d.origin?.ident).toBe('KPBI');
    expect(d.destination?.iata).toBe('ATL');
    expect(d.routeBasis).toBe('standing-data');
    expect(d.routeCheck).toMatch(/the DJT→ATL leg of standing-data route KATL→KPBI→KATL/);
    expect(d.routeCheck).not.toMatch(/not confirmed/);
  });

  it('the VRS chain matches an airport by any of its codes (PBI is KDJT in OurAirports, KPBI in VRS)', () => {
    expect(listedLeg('DAL1311', findAirport('KPBI')!, findAirport('KATL')!)).toBe(true);
    expect(listedLeg('DAL1311', findAirport('KATL')!, findAirport('KPBI')!)).toBe(true);
    expect(listedLeg('DAL1311', findAirport('KATL')!, findAirport('KMCO')!)).toBe(false);
  });

  it('an unlisted reverse leg still needs the strict heading test', async () => {
    // Same geometry, a callsign whose VRS chain is not a round trip: not shown as flown PBI→ATL.
    const unlisted = { ...deps, records: async () => ({ records: [{ ...record, callsign: 'ZZZ9999' }], run: { status: ok, okAt: NOW }, state: 'live' }) } as unknown as FlightDeps;
    const d = (await flightDetail('ZZZ9999', unlisted, NOW))!;
    expect(d.routeBasis).not.toBe('observed-reverse');
    expect(d.routeCheck).toMatch(/not confirmed|not listed/);
  });
});
