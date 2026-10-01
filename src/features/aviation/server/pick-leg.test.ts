import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { FlightRouteResponse } from '@/lib/schemas';
import fx from '../__fixtures__/route-legs-2026-10-01.json';
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

  it('UAL1118 (KDEN-KCID) cruising west away from CID: route withheld with the reason, no progress', async () => {
    const c = live('UAL1118');
    const r = await flightRoute('UAL1118', { lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg }, deps([KDEN, KCID]));
    expect(FlightRouteResponse.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ found: true, origin: null, destination: null, basis: null, status: 'unknown', progress: null, directionConflict: true, source: 'vrs' });
    expect(r!.routeCheck).toMatch(/heading toward KDEN, opposite to standing data KDEN→KCID; departure not observed/);
  });

  it('WZZ1738 (LFSB-LWSK) flying back toward Basel: withheld', async () => {
    const c = live('WZZ1738');
    const r = await flightRoute('WZZ1738', { lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg }, deps([LFSB, LWSK]));
    expect(r).toMatchObject({ found: true, origin: null, destination: null, progress: null, directionConflict: true });
  });

  it('shows the reverse leg only when the flown track saw the take-off from the listed destination', async () => {
    const c = live('UAL1118');
    const track = [pt('2026-10-01T04:30:00Z', 41.884, -91.711, null, true), pt('2026-10-01T04:33:00Z', 41.95, -91.95, 2400), pt('2026-10-01T04:50:00Z', 42.5, -92.2, 34000)];
    const r = await flightRoute('UAL1118', { lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg }, deps([KDEN, KCID], { track: async () => track }), { icao24: 'a12734' });
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
    const r = await flightRoute('UAL1118', { lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg }, deps([KDEN, KCID], { track: async () => track }), { icao24: 'a12734' });
    expect(r).toMatchObject({ origin: null, destination: null, directionConflict: true });
    expect(r!.routeCheck).toMatch(/departed KDEN earlier, now on course back toward KDEN/);
  });

  it('a trace lookup failure withholds instead of guessing', async () => {
    const c = live('UAL1118');
    const r = await flightRoute('UAL1118', { lat: c.lat, lng: c.lng, speedKt: c.gsKt, trackDeg: c.trackDeg }, deps([KDEN, KCID], { track: async () => { throw new Error('http_429'); } }), { icao24: 'a12734' });
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
