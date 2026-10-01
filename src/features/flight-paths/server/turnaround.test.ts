// R4 round 4 repros, fixtures captured live on 2026-10-01 (see `_captured` in each JSON):
//  - B1: SKW541T (VRS KDEN-KDRO, hex a08f6b) took off DEN 03:56Z, was last seen 04:26:45Z 60 km
//    from DRO at FL232, vanished for 37 min (landing + turnaround at DRO, 6,685 ft) and reappeared
//    05:03:21Z at FL235 tracking 41° back toward DEN. It was shown DEN→DRO, "observed departure
//    matches the route origin DEN", with both legs drawn as this flight.
//  - m1: ETA anchored to the request, not the observation (JAL908 at FL410 south of Honshu).
//  - m2: "earlier legs trimmed" claimed for a trace that starts in the OKA climb-out.
//  - m3: a registration without a callsign said "no route source answered".
import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '@/features/aviation/trace';
import skw from '../__fixtures__/r4/trace-SKW541T-a08f6b.json';
import jal from '../__fixtures__/r4/trace-JAL908-8479bc.json';
import { findAirport } from './data';
import { flightDetail, legOfTrack, lowness, sinceTurnaroundGap, type FlightDeps } from './flight';

const ok = { ok: true, count: 1, ms: 1, age_s: 0 };
const skwTrack = skw.track as TrackPoint[];
const jalTrack = jal.track as TrackPoint[];

function deps(rec: Record<string, unknown> | null, route: Record<string, unknown> | null, track: TrackPoint[], now: number): FlightDeps {
  return {
    records: async () => ({ records: rec ? [rec] : [], run: { status: ok, okAt: now } }),
    adsblol: async () => [],
    adsbdbRegistration: async () => null,
    route: async () => route,
    aircraft: async () => ({ track, identity: null, providers: { adsblol_trace: ok } }),
    weather: async () => ({ byStation: new Map(), providers: {} }),
  } as unknown as FlightDeps;
}

const base = { registration: null, bucket: 'commercial', isHelicopter: false, onGround: false, altGeomFt: null, squawk: null, emergency: null, nacP: 9, dbFlags: 0, source: 'adsblol_tiles', posSource: 'adsb' };

describe('unobserved turnaround at the destination (round 4 B1)', () => {
  const NOW = Date.parse('2026-10-01T05:17:30Z');
  const rec = { ...base, id: 'a08f6b', callsign: 'SKW541T', typeCode: 'CRJ7', category: 'A3', lat: 38.62341, lng: -106.08356, altFt: 25000, gsKt: 413.4, trackDeg: 42.3, vrFpm: 0, seenAt: NOW / 1000 - 13 };
  const route = { found: true, source: 'vrs', stale: false, sourceUpdatedAt: '2026-09-20', origin: { icao: 'KDEN', iata: 'DEN' }, destination: { icao: 'KDRO', iata: 'DRO' }, providers: { vrs: ok } };

  it('SKW541T flying back toward DEN is not shown DEN→DRO: route withheld with the reason', async () => {
    const d = (await flightDetail('SKW541T', deps(rec, route, skwTrack, NOW), NOW))!;
    expect(d.origin).toBeNull();
    expect(d.destination).toBeNull();
    expect(d.routeBasis).toBeNull();
    expect(d.progress).toBeNull();
    expect(d.eta).toBeNull();
    expect(d.routeCheck).toBe('departed DEN earlier, now on course back toward DEN — return leg or turnaround not observed; route not confirmed');
    const corr = d.sources.find((s) => s.name === 'corroboration')!;
    expect(corr.ok).toBe(false);
    expect(d.sources.some((s) => s.ok && /observed departure matches/.test(s.detail ?? ''))).toBe(false);
  });

  it('the previous DEN→DRO leg (before the 37-min gap) is not drawn; the observed return track is kept', async () => {
    const d = (await flightDetail('SKW541T', deps(rec, route, skwTrack, NOW), NOW))!;
    expect(d.flownTrack.length).toBeGreaterThan(10);
    expect(d.flownTrack[0]!.t).toBe('2026-10-01T05:03:21.637Z');
    expect(d.flownTrack.at(-1)!.t).toBe(skwTrack.at(-1)!.t);
    expect(d.sources.find((s) => s.name === 'flown track')?.detail).toMatch(/37-min coverage gap and a reversal of course/);
  });

  it('sinceTurnaroundGap cuts only at a long gap followed by a reversal (the 7- and 9-min en-route gaps stay)', () => {
    const cut = sinceTurnaroundGap(skwTrack);
    expect(cut.gapMin).toBe(37);
    expect(cut.track[0]!.t).toBe('2026-10-01T05:03:21.637Z');
    // Before the turnaround: the 412 s gap at 04:18Z has no change of course → nothing to cut.
    const outbound = skwTrack.filter((p) => p.t < '2026-10-01T05:00:00Z');
    expect(sinceTurnaroundGap(outbound)).toEqual({ track: outbound, gapMin: null });
  });

  it('low is above ground level at the nearer endpoint: the DEN climb-out at 5,250 ft MSL is low', () => {
    const DEN = findAirport('DEN')!;
    const DRO = findAirport('DRO')!;
    const isLow = lowness({ O: [DEN.lng, DEN.lat], D: [DRO.lng, DRO.lat], elevO: DEN.elevationFt, elevD: DRO.elevationFt });
    expect(DRO.elevationFt).toBeGreaterThan(6000);
    const climb = skwTrack[1]!; // 5,250 ft MSL a second after lift-off at DEN (5,434 ft)
    expect(isLow(climb)).toBe(true);
    expect(isLow({ ...climb, lat: DRO.lat, lng: DRO.lng, altFt: 9_000 })).toBe(true); // 2,315 ft AGL at DRO
    expect(isLow({ ...climb, lat: DRO.lat, lng: DRO.lng, altFt: 10_000 })).toBe(false);
  });
});

describe('ETA and corroboration wording (round 4 m1, m2)', () => {
  const NOW = Date.parse('2026-10-01T05:15:06Z');
  const rec = (ageS: number) => ({ ...base, id: '8479bc', callsign: 'JAL908', registration: 'JA18XJ', typeCode: 'A359', category: 'A5', lat: 32.30859, lng: 135.79497, altFt: 41000, gsKt: 518.4, trackDeg: 50.3, vrFpm: 0, seenAt: NOW / 1000 - ageS });
  const route = { found: true, source: 'vrs', stale: false, sourceUpdatedAt: '2026-09-20', origin: { icao: 'ROAH', iata: 'OKA' }, destination: { icao: 'RJTT', iata: 'HND' }, providers: { vrs: ok } };

  it('the ETA is anchored to the observation: a position seen 130 s earlier gives an ETA 130 s earlier', async () => {
    const fresh = (await flightDetail('JAL908', deps(rec(0), route, jalTrack, NOW), NOW))!;
    const old = (await flightDetail('JAL908', deps(rec(130), route, jalTrack, NOW), NOW))!;
    expect(fresh.eta).not.toBeNull();
    expect(Date.parse(fresh.eta!) - Date.parse(old.eta!)).toBe(130_000);
  });

  it('no "earlier legs trimmed" when the trace starts in the origin climb-out', async () => {
    const d = (await flightDetail('JAL908', deps(rec(0), route, jalTrack, NOW), NOW))!;
    const c = d.sources.find((s) => s.name === 'corroboration')!;
    expect(c.ok).toBe(true);
    expect(c.detail).toBe('observed departure matches the route origin OKA');
  });

  it('"trimmed" is claimed when an airborne point before the take-off lies away from the origin', () => {
    const OKA = findAirport('OKA')!;
    const HND = findAirport('HND')!;
    const earlier = { t: '2026-10-01T01:00:00Z', lat: 30, lng: 132, altFt: 35000, onGround: false, gsKt: 480, trackDeg: 230 };
    const leg = legOfTrack([earlier, ...jalTrack], [OKA.lng, OKA.lat], [HND.lng, HND.lat], { elevO: OKA.elevationFt, elevD: HND.elevationFt });
    expect(leg.departure).toBe('origin');
    expect(leg.trimmed).toBe(true);
    const plain = legOfTrack(jalTrack, [OKA.lng, OKA.lat], [HND.lng, HND.lat], { elevO: OKA.elevationFt, elevD: HND.elevationFt });
    expect(plain.trimmed).toBe(false);
  });
});

describe('registration without a callsign (round 4 m3)', () => {
  it('says the route lookup is not possible, not that no source answered', async () => {
    const NOW = Date.parse('2026-10-01T05:30:00Z');
    const d = (await flightDetail('G-XWBA', deps(null, null, [], NOW), NOW))!;
    expect(d.resolved.callsign).toBeNull();
    expect(d.sources.find((s) => s.name === 'route')).toEqual({ name: 'route', ok: false, detail: 'no callsign: route lookup not possible' });
  });
});
