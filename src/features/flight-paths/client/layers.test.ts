import { describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { greatCircle } from '../lib/geometry';
import type { Flight, Live, Plan } from './api';
import { altitudeColor, buildRouteLayers, cameraFor } from './layers';
import { codeOf, fmtKm, fmtLocal, fmtMinutes, fmtNm, fmtOffsetHours, fmtUtc } from './format';

const gc = greatCircle([140.386, 35.7647], [-118.408, 33.9425]);
const endpoint = (ident: string, iata: string, lng: number, lat: number) => ({ ident, icao: ident, iata, name: ident, lat, lng, tz: null, municipality: null, isoCountry: 'JP' });

const plan = {
  origin: endpoint('RJAA', 'NRT', 140.386, 35.7647),
  destination: endpoint('KLAX', 'LAX', -118.408, 33.9425),
  greatCircle: gc,
  diversionAirports: [{ code: 'ANC', name: 'Anchorage', runwayM: 3300, distanceFromPathKm: 150, alongPathKm: 4000, lat: 61.17, lng: -150.0 }],
  filedPlans: [{ id: 'fpdb:1', waypoints: [{ ident: 'A', type: 'FIX', lat: 35, lng: 141, altFt: null, via: null }, { ident: 'B', type: 'FIX', lat: 40, lng: 170, altFt: null, via: null }], distanceNm: 100, source: 'FlightPlanDatabase', disclaimer: 'sim only' }],
} as unknown as Plan;

const ids = (layers: unknown[]) => (layers as Layer[]).map((l) => l.id);

describe('buildRouteLayers', () => {
  it('plan: glow + arc on the unwrapped great circle, filed plans, endpoints, diversions, live aircraft', () => {
    const live = { aircraft: [{ hex: 'abc123', callsign: 'JAL62', lat: 45, lng: 170, basis: 'matched' }, { hex: 'abc124', callsign: null, lat: 45, lng: 175, basis: 'inferred' }] } as unknown as Live;
    const layers = buildRouteLayers({ plan, live, flight: null, globe: false, center: [0, 0], theme: 0 });
    expect(ids(layers)).toEqual(['route-planned-glow', 'route-planned-arc', 'route-filed', 'route-endpoints', 'route-endpoint-labels', 'route-diversions', 'route-live-aircraft']);
    const arc = (layers as Layer[])[1]!;
    const data = arc.props.data as { path: number[][] }[];
    expect(data[0]!.path).toBe(gc.points); // mercator: the server's unwrapped points as-is
    expect((arc.props.parameters as { cullMode: string }).cullMode).toBe('none');
  });

  it('flight: planned arc, flown track segments, remaining leg and the aircraft', () => {
    const flight = {
      ident: 'BAW117',
      resolved: { callsign: 'BAW117', hex: '4ca1fa', iataFlight: null, registration: null },
      origin: endpoint('EGLL', 'LHR', -0.46, 51.47),
      destination: endpoint('KJFK', 'JFK', -73.78, 40.64),
      plannedArc: [[-0.46, 51.47], [-73.78, 40.64]],
      flownTrack: [
        { t: '2026-09-30T20:00:00Z', lat: 51.47, lng: -0.46, altFt: null, onGround: true, gsKt: 10, trackDeg: 270 },
        { t: '2026-09-30T20:10:00Z', lat: 51.6, lng: -2, altFt: 20000, onGround: false, gsKt: 400, trackDeg: 280 },
        { t: '2026-09-30T20:20:00Z', lat: 52, lng: -5, altFt: 37000, onGround: false, gsKt: 480, trackDeg: 280 },
      ],
      remainingLeg: [[-5, 52], [-73.78, 40.64]],
      position: { lat: 52, lng: -5, altFt: 37000, gsKt: 480, trackDeg: 280, observedAt: '2026-09-30T20:20:00Z' },
    } as unknown as Flight;
    const layers = buildRouteLayers({ plan: null, live: null, flight, globe: true, center: [-5, 52], theme: 1 });
    expect(ids(layers)).toEqual(['route-planned-glow', 'route-planned-arc', 'route-flown-track', 'route-remaining', 'route-endpoints', 'route-endpoint-labels', 'route-live-aircraft']);
    expect(((layers as Layer[])[2]!.props.data as unknown[]).length).toBe(2);
    // Globe: lines lifted off the surface mesh.
    const arcPath = ((layers as Layer[])[1]!.props.data as { path: number[][] }[])[0]!.path;
    expect(arcPath[0]![2]).toBe(8000);
  });

  it('nothing to draw → no layers', () => {
    expect(buildRouteLayers({ plan: null, live: null, flight: null, globe: false, center: [0, 0], theme: 0 })).toEqual([]);
  });

  it('altitude colours ramp between the tokens; camera fits the route length', () => {
    const low = [255, 215, 0, 255] as [number, number, number, number];
    const high = [0, 229, 255, 255] as [number, number, number, number];
    expect(altitudeColor(null, low, high)).toEqual(low);
    expect(altitudeColor(0, low, high)).toEqual(low);
    expect(altitudeColor(40_000, low, high)).toEqual(high);
    expect(altitudeColor(80_000, low, high)).toEqual(high);
    const cam = cameraFor(plan);
    expect(cam.zoom).toBeGreaterThanOrEqual(1);
    expect(cam.zoom).toBeLessThan(3);
    expect(cameraFor({ greatCircle: { ...gc, distanceKm: 100 } }).zoom).toBeGreaterThan(cam.zoom);
  });
});

describe('format', () => {
  it('formats durations, offsets, local and UTC times', () => {
    expect(fmtMinutes(455)).toBe('7H 35M');
    expect(fmtOffsetHours(-5)).toBe('−5H');
    expect(fmtOffsetHours(5.5)).toBe('+5:30H');
    expect(fmtOffsetHours(0)).toBe('±0H');
    expect(fmtOffsetHours(null)).toBe('—');
    expect(fmtLocal('2026-09-30T21:05:00+01:00')).toBe('21:05 +01:00');
    expect(fmtLocal('2026-09-30T21:05:00+00:00')).toBe('21:05 UTC');
    expect(fmtLocal(null)).toBe('—');
    expect(fmtUtc('2026-09-30T03:12:00Z')).toBe('03:12Z');
    expect(fmtUtc(null)).toBe('—');
    expect(fmtUtc('x')).toBe('—');
    expect(fmtKm(5555.4)).toBe('5,555 KM');
    expect(fmtNm(2999.6)).toBe('3,000 NM');
    expect(codeOf({ iata: null, icao: 'EGLL', ident: 'EGLL' })).toBe('EGLL');
  });
});
