// R4 round 3, B1 + M1 (live 2026-10-01 03:11Z, recorded from this server's /api/flight and
// /api/aircraft, adsb.lol trace + VRS standing data): the standing data names a pair, but the
// observed departure and course decide the direction.
//  - AAL606 (VRS DFW→JFK): hex ad049a departed JFK 00:31Z, track 276.6° inbound DFW.
//  - UAL374 (VRS ORD→LAX): hex a5d31d departed LAX 02:28Z, track 99.6° eastbound.
//  - AAL869 (VRS DFW→MKE): hex ad8769 departed MKE 01:50Z, track 200°.
//  - UAL1673 (VRS CLE→ORD): over Texas, FL327, track 237° — ~1,100 km off a 500 km route.
// Positions are the recorded ones; their vertical rate was not recorded, so 0 (level) is used —
// every case is > 150 km from both ends, where the vertical rate is not consulted.
import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '@/features/aviation/trace';
import aal606 from '../__fixtures__/r3/flight-AAL606.json';
import ual374 from '../__fixtures__/r3/flight-UAL374.json';
import aal869 from '../__fixtures__/r3/flight-AAL869.json';
import ual1673 from '../__fixtures__/r3/flight-UAL1673.json';
import traceAd049a from '../__fixtures__/r3/trace-ad049a.json';
import traceA5d31d from '../__fixtures__/r3/trace-a5d31d.json';
import traceAd8769 from '../__fixtures__/r3/trace-ad8769.json';
import { buildVrsIndex, findAirport } from './data';
import { flightDetail, type FlightDeps } from './flight';
import { aircraftOnRoute } from './live';

const ok = { ok: true, count: 1, ms: 1, age_s: 0 };
const NOW = Date.parse('2026-10-01T03:12:00Z');

interface Recorded {
  resolved: { callsign: string; hex: string; registration: string | null };
  origin: { icao: string; iata: string };
  destination: { icao: string; iata: string };
  position: { lat: number; lng: number; altFt: number | null; gsKt: number | null; trackDeg: number | null; observedAt: string } | null;
}
const record = (f: Recorded) => ({
  id: f.resolved.hex!,
  callsign: f.resolved.callsign!,
  registration: f.resolved.registration,
  typeCode: 'B738',
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
  seenAt: Date.parse(f.position!.observedAt) / 1000,
  source: 'adsblol_tiles',
  posSource: 'adsb',
  lat: f.position!.lat,
  lng: f.position!.lng,
  altFt: f.position!.altFt,
  gsKt: f.position!.gsKt,
  trackDeg: f.position!.trackDeg,
});

function deps(f: Recorded, track: readonly unknown[]): FlightDeps {
  return {
    records: async () => ({ records: [record(f)], run: { status: ok, okAt: NOW } }),
    adsblol: async () => [],
    adsbdbRegistration: async () => null,
    route: async () => ({ found: true, source: 'vrs', stale: false, sourceUpdatedAt: '2026-09-20', origin: f.origin, destination: f.destination, providers: { vrs: ok } }),
    aircraft: async () => ({ track, identity: null, providers: { adsblol_trace: ok } }),
    weather: async () => ({ byStation: new Map(), providers: {} }),
  } as unknown as FlightDeps;
}

const firstPoint = (t: readonly TrackPoint[]) => t[0]!;

describe('observed departure and course beat the schedule (round 3 B1)', () => {
  it('AAL606 departed JFK inbound DFW: shown as flown JFK→DFW, never DFW→JFK with an ETA at JFK', async () => {
    const d = (await flightDetail('AAL606', deps(aal606, traceAd049a.track), NOW))!;
    expect(d.origin?.iata).toBe('JFK');
    expect(d.destination?.iata).toBe('DFW');
    expect(d.routeBasis).toBe('observed-reverse');
    expect(d.routeCheck).toMatch(/standing data lists DFW→JFK/);
    expect(d.etaTz).toBe('America/Chicago');
    expect(d.progress).toBeGreaterThan(0.8); // ~170 km east of DFW on a 2,200 km leg
    // The real JFK→DFW track is shown (it is this flight), starting on the ground at JFK.
    expect(d.flownTrack.length).toBeGreaterThan(100);
    expect(Math.abs(firstPoint(d.flownTrack).lng - -73.8)).toBeLessThan(0.5);
    expect(d.sources.find((s) => s.name === 'corroboration')?.ok).toBe(true);
    expect(d.sources.some((s) => /another leg/.test(s.detail ?? ''))).toBe(false);
  });

  it('UAL374 departed LAX eastbound: LAX→ORD as flown, progress from LAX', async () => {
    const d = (await flightDetail('UAL374', deps(ual374, traceA5d31d.track), NOW))!;
    expect([d.origin?.iata, d.destination?.iata]).toEqual(['LAX', 'ORD']);
    expect(d.routeBasis).toBe('observed-reverse');
    expect(d.progress).toBeLessThan(0.3);
  });

  it('AAL869 departed MKE heading 200°: MKE→DFW as flown, ETA at DFW', async () => {
    const d = (await flightDetail('AAL869', deps(aal869, traceAd8769.track), NOW))!;
    expect([d.origin?.iata, d.destination?.iata]).toEqual(['MKE', 'DFW']);
    expect(d.etaTz).toBe('America/Chicago');
    expect(d.eta).not.toBeNull();
  });

  it('UAL1673 (VRS CLE→ORD) 1,100 km off the route: route not confirmed, observed track kept, no progress', async () => {
    const d = (await flightDetail('UAL1673', deps(ual1673, ual1673.flownTrack), NOW))!;
    expect(d.origin).toBeNull();
    expect(d.destination).toBeNull();
    expect(d.progress).toBeNull();
    expect(d.eta).toBeNull();
    expect(d.plannedArc).toEqual([]);
    expect(d.position).not.toBeNull();
    expect(d.flownTrack.length).toBe(ual1673.flownTrack.length);
    expect(d.routeCheck).toMatch(/km off the great circle.*route not confirmed/);
    expect(d.sources.find((s) => s.name === 'corroboration')).toMatchObject({ ok: false });
  });
});

describe('/api/route/live MATCHED needs the observed direction (round 3 M1)', () => {
  const DFW = findAirport('DFW')!;
  const JFK = findAirport('JFK')!;
  const vrs = buildVrsIndex({ version: 1, generatedAt: '2026-10-01T00:00:00Z', lastModified: null, licence: 'CC0-1.0', chains: { 'KDFW-KJFK': ['AAL606'] } });
  const rec = record(aal606) as never;

  it('a DFW→JFK service flying into DFW is not a forward aircraft', () => {
    expect(aircraftOnRoute([rec], DFW, JFK, { reverse: false, now: NOW, vrs })).toEqual([]);
  });

  it('with the reverse toggle it is counted on the reverse leg, ETA at DFW', () => {
    const out = aircraftOnRoute([rec], DFW, JFK, { reverse: true, now: NOW, vrs });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ hex: 'ad049a', direction: 'reverse', basis: 'matched', etaTz: 'America/Chicago' });
    expect(out[0]!.progress).toBeGreaterThan(0.8);
  });

  it('flying the listed direction it stays MATCHED forward', () => {
    const fwd = { ...(rec as object), trackDeg: 70 } as never;
    expect(aircraftOnRoute([fwd], DFW, JFK, { reverse: false, now: NOW, vrs })[0]).toMatchObject({ direction: 'forward', basis: 'matched' });
  });

  it('an unknown track is never MATCHED', () => {
    const blind = { ...(rec as object), trackDeg: null } as never;
    expect(aircraftOnRoute([blind], DFW, JFK, { reverse: true, now: NOW, vrs })).toEqual([]);
  });
});
