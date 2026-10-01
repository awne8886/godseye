import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { FlightRouteResponse } from '@/lib/schemas';
import fx from '../__fixtures__/route-legs-2026-10-01.json';
import r5 from '../__fixtures__/route-r5-2026-10-01.json';
import type { FlightRecord } from '../adsb';
import type { TrackPoint } from '../trace';
import { flightRoute, pickLeg, type RouteCandidate, type RouteDeps } from './route-lookup';

type A = RouteCandidate['airports'][number];
const ap = (icao: string, lat: number, lng: number, elevationFt: number | null = null) => ({ icao, iata: null, name: icao, city: null, country: null, lat, lng, elevationFt }) as A;
const DFW = ap('KDFW', 32.9, -97.04);
const JFK = ap('KJFK', 40.64, -73.78);

describe('pickLeg', () => {
  // VRS lists AAL606 as KDFW-KJFK-KDFW: both legs share one corridor; the track decides.
  const roundTrip = [DFW, JFK, DFW];
  const midway: [number, number] = [-85.4, 36.8];

  it('picks JFK→DFW for an aircraft heading south-west', () => {
    expect(pickLeg(roundTrip, midway, 240).map((a) => a.icao)).toEqual(['KJFK', 'KDFW']);
  });

  it('picks DFW→JFK for an aircraft heading north-east', () => {
    expect(pickLeg(roundTrip, midway, 60).map((a) => a.icao)).toEqual(['KDFW', 'KJFK']);
  });

  it('falls back to the nearest leg without a track', () => {
    expect(pickLeg(roundTrip, midway).map((a) => a.icao)).toEqual(['KDFW', 'KJFK']);
  });
});

// R2 round 4 BLOCKING-1 live cases (observed 2026-10-01 05:2x UTC; VRS airports probed 05:52 UTC).
const live = (cs: string) => fx.multi.find((c) => c.cs === cs)!;
const KDEN = ap('KDEN', 39.8617, -104.673, 5434);
const KCID = ap('KCID', 41.8847, -91.7108, 869);
const LFSB = ap('LFSB', 47.5896, 7.52991, 885);
const LWSK = ap('LWSK', 41.9616, 21.6214, 781);
const pt = (t: string, lat: number, lng: number, altFt: number | null, onGround = false): TrackPoint => ({ t, lat, lng, altFt, onGround, gsKt: null, trackDeg: null });
const rec = (p: Partial<FlightRecord>): FlightRecord => ({
  id: 'a12734', callsign: 'UAL1118', registration: null, typeCode: null, bucket: 'commercial', isHelicopter: false, onGround: false, lat: 0, lng: 0,
  altFt: 34000, altGeomFt: null, gsKt: 403, trackDeg: 270.7, vrFpm: 0, squawk: null, emergency: null, category: null, nacP: null,
  dbFlags: null, seenAt: 1_790_800_000, source: 'adsblol_tiles', posSource: 'adsb', ...p,
});
const deps = (airports: A[], extra: Partial<RouteDeps> = {}): RouteDeps => ({
  vrs: async () => ({ airports, source: 'vrs', updatedAt: null }) satisfies RouteCandidate,
  adsbdb: vi.fn(),
  hexdb: vi.fn(),
  live: () => null,
  track: async () => null,
  ...extra,
});

describe('flightRoute direction conflict (2-airport routes)', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
  });

  // UAL1118 was 98 km from CID: inside the FLIGHT view's 150 km terminal area, where the vertical
  // rate decides the direction. The round 4 scan kept no vertical rate, so these cases state one
  // (level); `unknown vertical rate` below shows the answer without it.
  const level = (c: ReturnType<typeof live>) => ({ lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg, altFt: 34000, vrFpm: 0 });

  it('UAL1118 (KDEN-KCID) cruising west away from CID: route withheld with the reason, no progress', async () => {
    const c = live('UAL1118');
    const r = await flightRoute('UAL1118', level(c), deps([KDEN, KCID]));
    expect(FlightRouteResponse.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ found: true, origin: null, destination: null, basis: null, status: 'unknown', progress: null, directionConflict: true, source: 'vrs' });
    expect(r!.routeCheck).toMatch(/heading toward KDEN, opposite to standing data KDEN→KCID; departure not observed/);
  });

  it('unknown vertical rate near CID: the direction toward DEN is not asserted either, still withheld', async () => {
    const c = live('UAL1118');
    const r = await flightRoute('UAL1118', { lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg }, deps([KDEN, KCID]));
    expect(r).toMatchObject({ found: true, origin: null, destination: null, progress: null, directionConflict: true });
    expect(r!.routeCheck).toMatch(/^aircraft is not on standing-data route KDEN→KCID \(track points away from KCID\); departure not observed/);
  });

  it('WZZ1738 (LFSB-LWSK) flying back toward Basel: withheld', async () => {
    const c = live('WZZ1738');
    const r = await flightRoute('WZZ1738', { lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg }, deps([LFSB, LWSK]));
    expect(r).toMatchObject({ found: true, origin: null, destination: null, progress: null, directionConflict: true });
  });

  it('shows the reverse leg only when the flown track saw the take-off from the listed destination', async () => {
    const c = live('UAL1118');
    const track = [pt('2026-10-01T04:30:00Z', 41.884, -91.711, null, true), pt('2026-10-01T04:33:00Z', 41.95, -91.95, 2400), pt('2026-10-01T04:50:00Z', 42.5, -92.2, 34000)];
    const r = await flightRoute('UAL1118', level(c), deps([KDEN, KCID], { track: async () => track }), { icao24: 'a12734' });
    expect(FlightRouteResponse.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ found: true, reversed: true, basis: 'observed', status: 'airborne' });
    expect([r!.origin!.icao, r!.destination!.icao]).toEqual(['KCID', 'KDEN']);
    expect(r!.progress).toBeGreaterThan(0);
    expect(r!.progress).toBeLessThan(0.15);
    expect(r!.routeCheck).toMatch(/observed departure KCID/);
  });

  it('a take-off from the listed origin and a course back toward it is not corroboration (turnaround not observed)', async () => {
    const c = live('UAL1118');
    const track = [pt('2026-10-01T02:00:00Z', 39.86, -104.67, null, true), pt('2026-10-01T02:04:00Z', 39.95, -104.5, 7900), pt('2026-10-01T03:30:00Z', 41.8, -93, 35000)];
    const r = await flightRoute('UAL1118', level(c), deps([KDEN, KCID], { track: async () => track }), { icao24: 'a12734' });
    expect(r).toMatchObject({ origin: null, destination: null, directionConflict: true });
    expect(r!.routeCheck).toMatch(/departed KDEN earlier, now on course back toward KDEN/);
  });

  it('a trace lookup failure withholds instead of guessing', async () => {
    const c = live('UAL1118');
    const r = await flightRoute('UAL1118', level(c), deps([KDEN, KCID], { track: async () => { throw new Error('http_429'); } }), { icao24: 'a12734' });
    expect(r).toMatchObject({ origin: null, destination: null, directionConflict: true });
  });

  it('an aircraft flying the listed direction keeps the corridor answer (no conflict)', async () => {
    const r = await flightRoute('UAL1118', { lat: 41.0, lng: -98.0, speedKt: 450, trackDeg: 80 }, deps([KDEN, KCID]));
    expect(r).toMatchObject({ origin: { icao: 'KDEN' }, destination: { icao: 'KCID' }, basis: 'corridor', status: 'airborne' });
    expect(r!.directionConflict).toBeUndefined();
  });

  it('the multi-leg DAL709 round trip names the leg it is flying, not the first one', async () => {
    const c = live('DAL709');
    const aps = c.airports.map(([icao, lat, lng]) => ap(icao as string, lat as number, lng as number));
    const r = await flightRoute('DAL709', { lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg }, deps(aps));
    expect([r!.origin!.icao, r!.destination!.icao]).toEqual(['KSAN', 'KJFK']);
  });
});

describe('flightRoute with icao24: exact observed position (R2 round 4 MINOR-6)', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
  });

  it('judges leg and progress from the snapshot record, not the quantised query', async () => {
    const exact = rec({ lat: 41.03, lng: -98.26, trackDeg: 80 });
    const quantised = { lat: 41.0, lng: -98.5, speedKt: 400, trackDeg: 90 };
    const a = await flightRoute('UAL1118', quantised, deps([KDEN, KCID], { live: () => exact }), { icao24: 'a12734' });
    const b = await flightRoute('UAL1118', quantised, deps([KDEN, KCID]));
    expect(a!.positionSource).toBe('snapshot');
    expect(b!.positionSource).toBe('query');
    expect(a!.progress).not.toBe(b!.progress);
  });

  it('ignores a snapshot record under another callsign or on the ground', async () => {
    const q = { lat: 41.0, lng: -98.5, speedKt: 400, trackDeg: 90 };
    const other = await flightRoute('UAL1118', q, deps([KDEN, KCID], { live: () => rec({ callsign: 'UAL9', lat: 41.03, lng: -98.26 }) }), { icao24: 'a12734' });
    const ground = await flightRoute('UAL1118', q, deps([KDEN, KCID], { live: () => rec({ onGround: true, lat: 41.03, lng: -98.26 }) }), { icao24: 'a12734' });
    expect(other!.positionSource).toBe('query');
    expect(ground!.positionSource).toBe('query');
  });
});

// R2 round 5 BLOCKING-1: an aircraft flying AWAY from the destination but not toward the origin
// kept a confident card. Real traces + VRS standing data (fixture `_captured`).
describe('flightRoute: away from the destination needs a corroborating take-off (R2 round 5 BLOCKING-1)', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
  });
  type R5 = (typeof r5.cases)[number];
  const r5Case = (cs: string): R5 => r5.cases.find((c) => c.cs === cs)!;
  const snapshot = (c: R5) =>
    rec({ id: c.hex, callsign: c.cs, lat: c.observed.lat, lng: c.observed.lng, altFt: c.observed.altFt, gsKt: c.observed.gsKt, trackDeg: c.observed.trackDeg, vrFpm: c.observed.vrFpm });
  // What the card sends: the 0.5° / 50 kt / 45° quantised query (the server prefers the snapshot).
  const quantised = (c: R5) => ({ lat: Math.round(c.observed.lat * 2) / 2, lng: Math.round(c.observed.lng * 2) / 2, speedKt: 450, trackDeg: (Math.round(c.observed.trackDeg / 45) * 45) % 360 });

  for (const [cs, reason] of [
    ['SWA1241', /^observed departure DCA contradicts standing data LAS→DCA, and the aircraft is not on course for LAS — route not confirmed$/],
    ['UAL1789', /^observed departure IAD contradicts standing data RDU→IAD, and the aircraft is not on course for RDU — route not confirmed$/],
    ['SWA1332', /^observed departure is not ATL — contradicts standing data ATL→MDW; route not confirmed$/],
  ] as const) {
    it(`${cs} (${r5Case(cs).vrs}): the card withholds the leg, like the FLIGHT view`, async () => {
      const c = r5Case(cs);
      const track = vi.fn(async () => c.track);
      const r = await flightRoute(cs, quantised(c), deps(c.airports as A[], { live: () => snapshot(c), track }), { icao24: c.hex });
      expect(FlightRouteResponse.safeParse(r).success).toBe(true);
      expect(r).toMatchObject({ found: true, origin: null, destination: null, basis: null, status: 'unknown', progress: null, distanceKm: null, directionConflict: true, positionSource: 'snapshot', source: 'vrs' });
      expect(r!.routeCheck).toMatch(reason);
      expect(track).toHaveBeenCalledWith(c.hex);
    });
  }

  it('without an aircraft address or with a failed trace lookup: withheld, saying why', async () => {
    const c = r5Case('SWA1241');
    const pos = { lat: c.observed.lat, lng: c.observed.lng, speedKt: c.observed.gsKt, trackDeg: c.observed.trackDeg };
    const a = await flightRoute('SWA1241', pos, deps(c.airports as A[]));
    expect(a).toMatchObject({ origin: null, destination: null, status: 'unknown', progress: null, directionConflict: true });
    expect(a!.routeCheck).toMatch(/departure not observed \(no aircraft address given to read its flown track\)/);
    const failing = deps(c.airports as A[], {
      track: async () => {
        throw new Error('http_429');
      },
    });
    const b = await flightRoute('SWA1241', pos, failing, { icao24: c.hex });
    expect(b!.routeCheck).toMatch(/departure not observed \(flown track lookup failed\)/);
  });

  // The reviewer's repros (positions as R2 recorded them, no flown track): no confident leg.
  it('R2 repro: SWA1241 at 36.35,-80.00 track 214 is not LAS→DCA airborne; UAL1789 at 37.58,-79.92 track 237 is not RDU→IAD', async () => {
    const a = await flightRoute('ZZR5A', { lat: 36.34901, lng: -79.99584, speedKt: 450, trackDeg: 213.9 }, deps(r5Case('SWA1241').airports as A[]));
    expect(a?.status === 'airborne' && a?.destination?.icao === 'KDCA').toBe(false);
    const b = await flightRoute('ZZR5B', { lat: 37.58057, lng: -79.91911, speedKt: 450, trackDeg: 237.2 }, deps(r5Case('UAL1789').airports as A[]));
    expect(b?.status === 'airborne' && b?.origin?.icao === 'KRDU' && b?.destination?.icao === 'KIAD').toBe(false);
  });

  it('a take-off from the origin and a course away from the destination keeps the leg, without progress', async () => {
    const track = [pt('2026-10-01T02:00:00Z', 39.86, -104.67, null, true), pt('2026-10-01T02:04:00Z', 39.9, -104.5, 7400), pt('2026-10-01T02:30:00Z', 39.9, -102.5, 33000)];
    const r = await flightRoute('UAL1118', { lat: 39.9, lng: -101.2, speedKt: 420, trackDeg: 180 }, deps([KDEN, KCID], { track: async () => track }), { icao24: 'a12734' });
    expect(FlightRouteResponse.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ found: true, origin: { icao: 'KDEN' }, destination: { icao: 'KCID' }, basis: 'observed', status: 'airborne', progress: null });
    expect(r!.reversed).toBeUndefined();
    expect(r!.routeCheck).toMatch(/^departed KDEN but not observed on course for KCID/);
  });

  it('an aircraft on course for its destination never reads the flown track', async () => {
    const track = vi.fn(async () => null);
    const r = await flightRoute('UAL1118', { lat: 41.0, lng: -98.0, speedKt: 450, trackDeg: 80 }, deps([KDEN, KCID], { track }), { icao24: 'a12734' });
    expect(r).toMatchObject({ origin: { icao: 'KDEN' }, destination: { icao: 'KCID' }, basis: 'corridor', status: 'airborne' });
    expect(track).not.toHaveBeenCalled();
  });
});

describe('flightRoute: a round trip asked without a position (R2 round 5 MINOR-3)', () => {
  beforeEach(() => {
    clearL1();
    setStore(new MemoryStore());
  });
  // VRS standing data for DAL3069, fetched 2026-10-01T16:15Z: KATL-KBNA-KATL.
  const ATL = { icao: 'KATL', iata: 'ATL', name: 'Hartsfield Jackson Atlanta International Airport', city: 'Atlanta', country: 'US', lat: 33.6367, lng: -84.428101, elevationFt: 1026 } as A;
  const BNA = { icao: 'KBNA', iata: 'BNA', name: 'Nashville International Airport', city: 'Nashville', country: 'US', lat: 36.1245, lng: -86.6782, elevationFt: 599 } as A;

  it('withholds the leg instead of answering ATL→ATL with 0 km', async () => {
    const r = await flightRoute('DAL3069', null, deps([ATL, BNA, ATL]));
    expect(FlightRouteResponse.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ found: true, origin: null, destination: null, basis: null, status: 'unknown', progress: null, distanceKm: null, source: 'vrs', positionSource: null });
    expect(r!.routeCheck).toBe('round trip ATL→BNA→ATL: the leg being flown is unknown without an observed position');
    expect(r!.directionConflict).toBeUndefined();
  });

  it('with a position it names the leg being flown (never one airport to itself)', async () => {
    const r = await flightRoute('DAL3069', { lat: 35.0, lng: -85.6, speedKt: 420, trackDeg: 330 }, deps([ATL, BNA, ATL]));
    expect([r!.origin!.icao, r!.destination!.icao]).toEqual(['KATL', 'KBNA']);
    const back = await flightRoute('DAL3069', { lat: 35.0, lng: -85.6, speedKt: 420, trackDeg: 150 }, deps([ATL, BNA, ATL]));
    expect([back!.origin!.icao, back!.destination!.icao]).toEqual(['KBNA', 'KATL']);
  });

  it('a listed "local flight" (one airport twice) is never shown as a leg', async () => {
    const r = await flightRoute('N123AB', { lat: 33.7, lng: -84.4, speedKt: 120, trackDeg: 90 }, deps([ATL, { ...ATL }]));
    expect(r).toMatchObject({ found: true, origin: null, destination: null, progress: null });
    expect(r!.routeCheck).toBe('standing data lists ATL→ATL, from and back to ATL: no leg to show');
  });
});
