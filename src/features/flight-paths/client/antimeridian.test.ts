// R4-B1: FLIGHT and ROUTE mode across the antimeridian, in mercator and on the globe. The QFA11
// shape is the live /api/flight/QFA11 answer of 2026-09-30 21:40Z (SYD→LAX, aircraft near LAX).
import { describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { greatCirclePoints, type LngLatTuple } from '@/lib/geo';
import { greatCircle, pathIntoFrame } from '../lib/geometry';
import type { Flight, Live, Plan } from './api';
import { buildRouteLayers, frameBounds, routeFrame } from './layers';

const endpoint = (ident: string, iata: string, lng: number, lat: number) => ({ ident, icao: ident, iata, name: ident, lat, lng, tz: null, municipality: null, isoCountry: 'XX' });
const SYD: LngLatTuple = [151.177, -33.9461];
const LAX: LngLatTuple = [-118.408, 33.9425];
const NRT: LngLatTuple = [140.386, 35.7647];
const HERE: LngLatTuple = [-119.92978, 33.62915];
const MID_PACIFIC: LngLatTuple = [-165.2, 1.8];

const tp = (lng: number, lat: number, altFt: number, t: string) => ({ t, lat, lng, altFt, onGround: false, gsKt: 480, trackDeg: 60 });

/** A flight as the server built it before the fix: arc unwrapped from the origin, the rest raw. */
function rawFlight(o: LngLatTuple, d: LngLatTuple, here: LngLatTuple, track: [number, number][]): Flight {
  return {
    ident: 'QFA11',
    resolved: { callsign: 'QFA11', hex: '7c4ee8', iataFlight: null, registration: 'VH-OQI' },
    origin: endpoint('YSSY', 'SYD', ...o),
    destination: endpoint('KLAX', 'LAX', ...d),
    plannedArc: greatCirclePoints(o, d, 128), // ends at 241.592 for SYD→LAX
    flownTrack: track.map(([x, y], i) => tp(x, y, 38_000, `2026-09-30T${String(8 + i).padStart(2, '0')}:00:00Z`)),
    remainingLeg: greatCirclePoints(here, d, 64), // starts at the raw −119.9
    position: { lat: here[1], lng: here[0], altFt: 16325, gsKt: 356, trackDeg: 70, observedAt: '2026-09-30T21:40:00Z' },
    progress: 0.98,
  } as unknown as Flight;
}

const qfa11 = rawFlight(SYD, LAX, HERE, [
  [151.2, -33.9],
  [170, -20],
  [179.9, -19.9],
  [-179.9, -19.8],
  [-150, 5],
  HERE,
]);

const byId = (layers: unknown[], id: string) => (layers as Layer[]).find((l) => l.id === id)!;
const pathsOf = (l: Layer) => (l.props.data as { path: number[][] }[]).map((d) => d.path);
const maxStep = (pts: readonly (readonly number[])[]) => Math.max(0, ...pts.slice(1).map((p, i) => Math.abs(p[0]! - pts[i]![0]!)));

for (const globe of [false, true]) {
  const proj = globe ? 'globe' : 'mercator';
  describe(`antimeridian, FLIGHT mode (${proj})`, () => {
    const layers = buildRouteLayers({ plan: null, live: null, flight: qfa11, globe, center: HERE, theme: 0 });

    it('flown track: no segment spans more than 180° of longitude', () => {
      const segs = byId(layers, 'route-flown-track').props.data as { from: LngLatTuple; to: LngLatTuple }[];
      expect(Math.max(...segs.map((s) => Math.abs(s.to[0] - s.from[0])))).toBeLessThanOrEqual(180);
      expect(segs.length).toBe(5);
    });

    it('planned arc, flown track, remaining leg and aircraft sit in one world copy', () => {
      const arc = pathsOf(byId(layers, 'route-planned-arc')).flat();
      expect(maxStep(arc)).toBeLessThanOrEqual(180);
      const arcEnd = qfa11.plannedArc[qfa11.plannedArc.length - 1]![0];
      const rem = pathsOf(byId(layers, 'route-remaining')).flat();
      expect(Math.abs(arcEnd - rem[0]![0]!)).toBeLessThan(180);
      expect(Math.abs(rem[rem.length - 1]![0]! - arcEnd)).toBeLessThan(0.05); // remaining leg ends where the arc ends (LAX)
      const segs = byId(layers, 'route-flown-track').props.data as { from: LngLatTuple; to: LngLatTuple }[];
      const trackEnd = segs[segs.length - 1]!.to[0];
      const aircraft = (byId(layers, 'route-live-aircraft').props.data as { position: LngLatTuple }[])[0]!.position[0];
      expect(Math.abs(trackEnd - aircraft)).toBeLessThan(1);
      expect(Math.abs(aircraft - rem[0]![0]!)).toBeLessThan(1);
      const dest = (byId(layers, 'route-endpoints').props.data as { id: string; position: LngLatTuple }[]).find((e) => e.id === 'KLAX')!;
      expect(Math.abs(dest.position[0] - arcEnd)).toBeLessThan(0.05);
    });

    it('frame bounds are one continuous span (no 360° box)', () => {
      const b = frameBounds(routeFrame(null, null, qfa11)!)!;
      expect(b[1][0] - b[0][0]).toBeLessThan(120); // SYD 151° → LAX 241.6°: ≈ 90°
    });
  });
}

describe('antimeridian, NRT→LAX tracked mid-Pacific (server output after the fix)', () => {
  const arc = greatCirclePoints(NRT, LAX, 128);
  const f = {
    ...rawFlight(NRT, LAX, MID_PACIFIC, [
      [140.4, 35.8],
      [170, 45],
      [-175, 47],
    ]),
    plannedArc: arc,
    // flight.ts now builds the remaining leg in the arc's frame.
    remainingLeg: pathIntoFrame(greatCirclePoints([-175, 47], LAX, 64), arc),
    position: { lat: 47, lng: -175, altFt: 37000, gsKt: 480, trackDeg: 90, observedAt: '2026-09-30T21:40:00Z' },
  } as unknown as Flight;

  it('the server remaining leg already continues the arc past 180°', () => {
    expect(f.remainingLeg[0]![0]).toBeGreaterThan(180);
    expect(maxStep(f.remainingLeg)).toBeLessThan(5);
  });

  for (const globe of [false, true]) {
    it(`everything drawn is continuous (${globe ? 'globe' : 'mercator'})`, () => {
      const fr = routeFrame(null, null, f)!;
      expect(maxStep(fr.arc)).toBeLessThanOrEqual(180);
      expect(Math.max(...fr.flown.map((s) => Math.abs(s.to[0] - s.from[0])))).toBeLessThanOrEqual(180);
      expect(fr.flown[fr.flown.length - 1]!.to[0]).toBeCloseTo(185, 5);
      expect(fr.aircraft[0]!.position[0]).toBeCloseTo(185, 5);
      const layers = buildRouteLayers({ plan: null, live: null, flight: f, globe, center: [-175, 47], theme: 0 });
      for (const id of ['route-planned-arc', 'route-remaining']) for (const p of pathsOf(byId(layers, id))) expect(maxStep(p)).toBeLessThanOrEqual(180);
    });
  }
});

describe('antimeridian, ROUTE mode (SYD–SCL, AKL–EZE) with live aircraft and filed plans', () => {
  for (const [a, b, name] of [
    [SYD, [-70.7858, -33.393] as LngLatTuple, 'SYD-SCL'],
    [[174.785, -37.0082] as LngLatTuple, [-58.5358, -34.8222] as LngLatTuple, 'AKL-EZE'],
  ] as const) {
    it(`${name}: aircraft, diversions and filed waypoints join the arc's world copy`, () => {
      const gc = greatCircle(a, b);
      const mid = gc.points[128]!;
      const rawMid: LngLatTuple = [((mid[0] + 540) % 360) - 180, mid[1]];
      const plan = {
        origin: endpoint('A', 'AAA', ...a),
        destination: endpoint('B', 'BBB', ...b),
        greatCircle: gc,
        diversionAirports: [{ code: 'D', name: 'D', runwayM: 3000, distanceFromPathKm: 10, alongPathKm: 1, lat: rawMid[1], lng: rawMid[0] }],
        filedPlans: [{ id: 'f', waypoints: [a, rawMid, b].map(([lng, lat], i) => ({ ident: `W${i}`, type: 'FIX', lat, lng, altFt: null, via: null })), distanceNm: 1, source: 'FlightPlanDatabase', disclaimer: 'sim' }],
      } as unknown as Plan;
      const live = { aircraft: [{ hex: 'x', callsign: 'LAN800', lat: rawMid[1], lng: rawMid[0], basis: 'matched', direction: 'forward', progress: 0.5 }] } as unknown as Live;
      const fr = routeFrame(plan, live, null)!;
      expect(fr.aircraft[0]!.position[0]).toBeCloseTo(mid[0], 5);
      expect(fr.diversions[0]!.position[0]).toBeCloseTo(mid[0], 5);
      expect(maxStep(fr.filed[0]!.path)).toBeLessThanOrEqual(180);
      expect(fr.endpoints[1]!.position[0]).toBeCloseTo(gc.points[gc.points.length - 1]![0], 5);
      const layers = buildRouteLayers({ plan, live, flight: null, globe: false, center: [0, 0], theme: 0 });
      expect((byId(layers, 'route-filed').props as { wrapLongitude?: boolean }).wrapLongitude).toBeFalsy();
    });
  }
});
