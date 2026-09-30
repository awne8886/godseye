import { describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { greatCircle } from '../lib/geometry';
import type { Flight, Live, Plan } from './api';
import { ALT_RAMP_FT, altitudeColor, buildRouteAnimLayers, buildRouteLayers, cameraFor, framePadding, PULSE_RINGS, progressChip, routeFrame } from './layers';
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
    expect(ids(layers)).toEqual(['route-planned-glow', 'route-planned-arc', 'route-filed', 'route-filed-waypoints', 'route-endpoints', 'route-endpoint-labels', 'route-diversions', 'route-live-aircraft']);
    const arc = (layers as Layer[])[1]!;
    const data = arc.props.data as { path: number[][] }[];
    // Dashed: several pieces whose vertices are exactly the server's unwrapped points.
    expect(data.length).toBeGreaterThan(20);
    expect(data[0]!.path[0]).toEqual(gc.points[0]);
    expect(data.flatMap((d) => d.path).every((p) => gc.points.some((q) => q[0] === p[0] && q[1] === p[1]))).toBe(true);
    expect((arc.props.parameters as { cullMode: string }).cullMode).toBe('none');
    expect((arc.props as unknown as { antialiasing?: boolean }).antialiasing).toBe(true);
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

  it('altitude colours: FR24 stops when themed, two-stop fallback otherwise; camera fits the route length', () => {
    const low = [255, 215, 0, 255] as [number, number, number, number];
    const high = [0, 229, 255, 255] as [number, number, number, number];
    const two = { stopsFt: [0, 40_000], colors: [low, high] };
    expect(altitudeColor(null, two)).toEqual(low);
    expect(altitudeColor(0, two)).toEqual(low);
    expect(altitudeColor(40_000, two)).toEqual(high);
    expect(altitudeColor(80_000, two)).toEqual(high);
    const c = (n: number) => [n, n, n, 255] as [number, number, number, number];
    const fr24 = { stopsFt: ALT_RAMP_FT, colors: [0, 1, 2, 3, 4, 5, 6].map((k) => c(k * 40)) };
    expect(altitudeColor(100, fr24)).toEqual(c(13)); // between white (<300 ft) and yellow
    expect(altitudeColor(300, fr24)).toEqual(c(40));
    expect(altitudeColor(19_700, fr24)).toEqual(c(240)); // red above 19,700 ft
    expect(altitudeColor(38_000, fr24)).toEqual(c(240));
    const cam = cameraFor(plan);
    expect(cam.zoom).toBeGreaterThanOrEqual(1);
    expect(cam.zoom).toBeLessThan(3);
    expect(cameraFor({ greatCircle: { ...gc, distanceKm: 100 } }).zoom).toBeGreaterThan(cam.zoom);
  });

  it('§8 styling: filed idents only at z ≥ 5, return-leg arc only with reverse traffic, progress chips', () => {
    const live = { aircraft: [{ hex: 'a', callsign: 'JAL62', lat: 45, lng: 170, basis: 'matched', direction: 'reverse', progress: 0.421 }] } as unknown as Live;
    const far = buildRouteLayers({ plan, live, flight: null, globe: false, center: [0, 0], zoom: 3, theme: 0 });
    expect(ids(far)).not.toContain('route-filed-labels');
    const near = buildRouteLayers({ plan, live, flight: null, globe: false, center: [0, 0], zoom: 5, theme: 0 });
    expect(ids(near)).toContain('route-filed-labels');
    expect(ids(near)).toContain('route-reverse-arc');
    expect(ids(near).indexOf('route-reverse-arc')).toBeLessThan(ids(near).indexOf('route-planned-arc'));
    const chips = (near as Layer[]).find((l) => l.id === 'route-progress-chips')!;
    expect(chips.props.data).toHaveLength(1);
    expect(progressChip('JAL62', 0.421)).toBe('JAL62 · 42%');
    const noReverse = buildRouteLayers({ plan, live: null, flight: null, globe: false, center: [0, 0], theme: 0 });
    expect(ids(noReverse)).not.toContain('route-reverse-arc');
  });

  it('animation: ≤ 3 pulse rings per endpoint and a comet on the arc; nothing under reduced motion', () => {
    const frame = routeFrame(plan, null, null);
    const anim = buildRouteAnimLayers({ frame, globe: false, phase: 0.5, reducedMotion: false, theme: 0 }) as Layer[];
    expect(anim.map((l) => l.id)).toEqual(['route-endpoint-pulse', 'route-comet']);
    expect(anim[0]!.props.data).toHaveLength(2 * PULSE_RINGS);
    const head = (anim[1]!.props.data as { position: [number, number]; k: number }[]).find((d) => d.k === 0)!;
    const i = Math.floor(0.5 * (gc.points.length - 1));
    expect(head.position[0]).toBeGreaterThanOrEqual(Math.min(gc.points[i]![0], gc.points[i + 1]![0]));
    expect(head.position[0]).toBeLessThanOrEqual(Math.max(gc.points[i]![0], gc.points[i + 1]![0]));
    expect(buildRouteAnimLayers({ frame, globe: false, phase: 0.5, reducedMotion: true, theme: 0 })).toEqual([]);
  });

  it('fit padding: 80 px plus the docked panel, capped to leave room for the route', () => {
    expect(framePadding({ width: 1440, height: 900 }, null)).toEqual({ top: 80, right: 80, bottom: 80, left: 80 });
    expect(framePadding({ width: 1440, height: 900 }, { side: 'right', size: 424 })).toEqual({ top: 80, right: 504, bottom: 80, left: 80 });
    expect(framePadding({ width: 800, height: 900 }, { side: 'right', size: 424 }).right).toBe(440);
    expect(framePadding({ width: 390, height: 844 }, { side: 'bottom', size: 380 }).bottom).toBe(460);
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
