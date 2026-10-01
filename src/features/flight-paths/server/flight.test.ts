// R4 round 2, M1: /api/flight/UAL61 (MEL→SFO, aircraft N24990 parked at MEL, 2026-10-01 01:14Z)
// returned the aircraft's previous leg SFO→MEL as UAL61's flown track and claimed corridor
// corroboration. The fixture is that live track (700 points, departs SFO 2026-09-30 07:49Z).
import { describe, expect, it } from 'vitest';
import { distanceKm, type LngLatTuple } from '@/lib/geo';
import type { TrackPoint } from '@/features/aviation/trace';
import ual61 from '../__fixtures__/flight-UAL61-previous-leg.json';
import { flightDetail, legOfTrack, type FlightDeps } from './flight';

const ok = { ok: true, count: 1, ms: 1, age_s: 0 };
const MEL: LngLatTuple = [144.843, -37.6733];
const SFO: LngLatTuple = [-122.375, 37.619];
const previousLeg = ual61.flownTrack as TrackPoint[];

const record = (over: Record<string, unknown>) => ({
  id: 'a2551a',
  callsign: 'UAL61',
  registration: 'N24990',
  lat: -37.67054,
  lng: 144.84346,
  altFt: null,
  onGround: true,
  gsKt: 7.2,
  trackDeg: 267.8,
  source: 'adsblol_tiles',
  seenAt: 1790817242,
  ...over,
});

function deps(rec: Record<string, unknown>, track: TrackPoint[]): FlightDeps {
  return {
    records: async () => ({ records: [rec], run: { status: ok, okAt: Date.now() } }),
    adsblol: async () => [],
    adsbdbRegistration: async () => null,
    route: async () => ({ found: true, source: 'vrs', stale: false, sourceUpdatedAt: '2026-09-20', origin: { icao: 'YMML', iata: 'MEL' }, destination: { icao: 'KSFO', iata: 'SFO' }, providers: { vrs: ok } }),
    aircraft: async () => ({ track, identity: null, providers: { adsblol_trace: ok } }),
    weather: async () => ({ byStation: new Map(), providers: {} }),
  } as unknown as FlightDeps;
}

const NOW = Date.parse('2026-10-01T01:16:30Z');

describe('flight view never shows another leg as the flown track (R4-M1)', () => {
  it('UAL61 parked at MEL: no SFO→MEL track, status scheduled, no corridor corroboration claimed', async () => {
    const d = (await flightDetail('UAL61', deps(record({}), previousLeg), NOW))!;
    expect(d.origin?.iata).toBe('MEL');
    expect(d.destination?.iata).toBe('SFO');
    expect(d.flownTrack).toEqual([]);
    expect(d.status).toBe('scheduled');
    expect(d.sources.find((s) => s.name === 'flown track')?.detail).toMatch(/previous leg/);
    const corr = d.sources.find((s) => s.name === 'corroboration')!;
    expect(corr.ok).toBe(false);
    expect(corr.detail).not.toMatch(/corridor/);
  });

  it('the fixture really departs SFO and ends at MEL', () => {
    expect(distanceKm([previousLeg[0]!.lng, previousLeg[0]!.lat], SFO)).toBeLessThan(25);
    const last = previousLeg[previousLeg.length - 1]!;
    expect(distanceKm([last.lng, last.lat], MEL)).toBeLessThan(25);
    expect(legOfTrack(previousLeg, MEL, SFO).departure).toBe('elsewhere');
  });

  const t = (i: number) => new Date(Date.parse('2026-10-01T02:00:00Z') + i * 60_000).toISOString();
  const pt = (i: number, lng: number, lat: number, altFt: number | null): TrackPoint => ({ t: t(i), lat, lng, altFt, onGround: altFt === null, gsKt: altFt === null ? 10 : 450, trackDeg: 60 });

  it('trims earlier legs and keeps the part after the take-off from the origin', () => {
    // Inbound SFO→MEL tail, a turnaround at MEL without 4 ground samples, then the climb out to SFO.
    const track = [pt(0, -122.37, 37.62, null), pt(1, -123, 37, 20_000), pt(2, 144.9, -37.7, 1_000), pt(3, MEL[0], MEL[1], null), pt(4, 145.5, -37, 15_000), pt(5, 150, -30, 35_000)];
    const leg = legOfTrack(track, MEL, SFO);
    expect(leg.departure).toBe('origin');
    expect(leg.trimmed).toBe(true);
    expect(leg.track[0]!.t).toBe(t(3));
  });

  it('an approach into the origin is not mistaken for a take-off', () => {
    const track = [pt(0, -122.37, 37.62, null), pt(1, 140, -35, 30_000), pt(2, 144.6, -37.6, 2_500), pt(3, 144.8, -37.66, 800), pt(4, MEL[0], MEL[1], null)];
    expect(legOfTrack(track, MEL, SFO).departure).toBe('elsewhere');
  });

  it('a track starting in the air near the destination is the inbound leg', () => {
    const track = [pt(0, -122.6, 37.8, 9_000), pt(1, -130, 30, 35_000)];
    expect(legOfTrack(track, MEL, SFO).departure).toBe('elsewhere');
  });

  it('a track starting in the air mid-route is "departure not observed"', () => {
    const track = [pt(0, 170, -10, 37_000), pt(1, 175, -5, 37_000)];
    expect(legOfTrack(track, MEL, SFO).departure).toBe('unobserved');
  });

  it('airborne on course in the corridor after a trace that ended at MEL: route kept, earlier leg dropped, departure "not observed"', async () => {
    const rec = record({ lat: -10, lng: 170, altFt: 37_000, onGround: false, gsKt: 480, trackDeg: 50 });
    const d = (await flightDetail('UAL61', deps(rec, previousLeg), NOW))!;
    expect(d.status).toBe('airborne');
    expect(d.flownTrack).toEqual([]);
    expect([d.origin?.iata, d.destination?.iata]).toEqual(['MEL', 'SFO']);
    expect(d.sources.find((s) => s.name === 'flown track')?.detail).toMatch(/earlier leg not shown/);
    const corr = d.sources.find((s) => s.name === 'corroboration')!;
    expect(corr).toMatchObject({ ok: true });
    expect(corr.detail).toMatch(/on course for SFO \(departure not observed\)/);
    expect(d.progress).not.toBeNull();
  });

  it('same position heading back toward MEL: route not confirmed, no progress', async () => {
    const rec = record({ lat: -10, lng: 170, altFt: 37_000, onGround: false, gsKt: 480, trackDeg: 230 });
    const d = (await flightDetail('UAL61', deps(rec, previousLeg), NOW))!;
    expect(d.origin).toBeNull();
    expect(d.progress).toBeNull();
    expect(d.routeCheck).toMatch(/heading toward MEL.*route not confirmed/);
  });

  it('a track that departed the origin is kept and corroborates the route', async () => {
    const track = [pt(0, MEL[0], MEL[1], null), pt(1, 145.5, -37, 15_000), pt(2, 150, -30, 35_000)];
    const rec = record({ lat: -30, lng: 150, altFt: 35_000, onGround: false, gsKt: 480 });
    const d = (await flightDetail('UAL61', deps(rec, track), NOW))!;
    expect(d.flownTrack).toHaveLength(3);
    expect(d.sources.find((s) => s.name === 'corroboration')).toMatchObject({ ok: true, detail: 'observed departure matches the route origin MEL' });
  });
});

// R4 round 3 m1: a trace that begins in cruise on the previous leg (coverage starts over Austria),
// lands at the origin without onGround rows (no ground coverage), then departs for D. Synthetic
// geometry from the reviewer's repro; no live case was found.
describe('legOfTrack with an unobserved start (round 3 m1)', () => {
  const t0 = Date.parse('2026-10-01T00:00:00Z');
  const p = (min: number, lat: number, lng: number, altFt: number): TrackPoint => ({ t: new Date(t0 + min * 60_000).toISOString(), lat, lng, altFt, onGround: false, gsKt: 400, trackDeg: 90 });
  const LHR: LngLatTuple = [-0.4543, 51.47];
  const JFK: LngLatTuple = [-73.7781, 40.6398];
  const track = [
    p(0, 47.5, 14.0, 37000), p(30, 49.5, 8.0, 36000), p(60, 51.0, 2.0, 20000), p(70, 51.45, 0.2, 6000),
    p(75, 51.47, -0.3, 1200), p(76, 51.47, -0.45, 300),
    p(160, 51.47, -0.5, 800), p(165, 51.6, -1.5, 9000), p(190, 52.5, -10.0, 35000), p(260, 54.0, -30.0, 37000),
  ];
  it('trims the previous DXB→LHR leg instead of drawing it as LHR→JFK', () => {
    const leg = legOfTrack(track, LHR, JFK);
    expect(leg.departure).toBe('origin');
    expect(leg.trimmed).toBe(true);
    expect(leg.track.every((q) => q.lng <= 0)).toBe(true);
    expect(leg.track[0]!.altFt).toBe(800);
  });
});
