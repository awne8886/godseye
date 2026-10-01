import { describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { greatCircle } from '../lib/geometry';
import type { Flight, Live, Plan } from './api';
import {
  ALT_RAMP_FT,
  altitudeColor,
  buildRouteAnimLayers,
  buildRouteLayers,
  cameraFor,
  CHIP_MAX,
  flownSegments,
  frameBounds,
  PULSE_RINGS,
  progressChip,
  routeFrame,
  screenProjector,
  selectChips,
  TRACK_GAP_MS,
} from './layers';
import { frameArea, framePadding, globeProjector, solveFrame, type Padding } from './framing';
import { codeOf, fmtKm, fmtLocal, fmtMinutes, fmtNm, fmtOffsetHours, fmtUtc } from './format';

const gc = greatCircle([140.386, 35.7647], [-118.408, 33.9425]);
const endpoint = (ident: string, iata: string, lng: number, lat: number) => ({ ident, icao: ident, iata, name: ident, lat, lng, tz: null, municipality: null, isoCountry: 'JP' });

const plan = {
  origin: endpoint('RJAA', 'NRT', 140.386, 35.7647),
  destination: endpoint('KLAX', 'LAX', -118.408, 33.9425),
  greatCircle: gc,
  diversionAirports: [{ code: 'ANC', name: 'Anchorage', runwayM: 3300, distanceFromPathKm: 150, alongPathKm: 4000, lat: 61.17, lng: -150.0 }],
  filedPlans: [
    {
      id: 'fpdb:1',
      waypoints: [
        { ident: 'A', type: 'FIX', lat: 35, lng: 141, altFt: null, via: null },
        { ident: 'B', type: 'FIX', lat: 40, lng: 170, altFt: null, via: null },
      ],
      distanceNm: 100,
      source: 'FlightPlanDatabase',
      disclaimer: 'sim only',
    },
  ],
} as unknown as Plan;

const ids = (layers: unknown[]) => (layers as Layer[]).map((l) => l.id);

describe('buildRouteLayers', () => {
  it('plan: glow + arc on the unwrapped great circle, filed plans, endpoints, diversions, live aircraft', () => {
    const live = {
      aircraft: [
        { hex: 'abc123', callsign: 'JAL62', lat: 45, lng: 170, basis: 'matched' },
        { hex: 'abc124', callsign: null, lat: 45, lng: 175, basis: 'inferred' },
      ],
    } as unknown as Live;
    const layers = buildRouteLayers({ plan, live, flight: null, globe: false, center: [0, 0], theme: 0 });
    expect(ids(layers)).toEqual([
      'route-planned-glow',
      'route-planned-arc',
      'route-filed',
      'route-filed-waypoints',
      'route-endpoints',
      'route-endpoint-labels',
      'route-diversions',
      'route-inferred-aircraft',
      'route-live-aircraft',
    ]);
    // R2-M2: the inferred aircraft is a dotted-ring glyph, not the solid MATCHED ring.
    const inferred = (layers as Layer[]).find((l) => l.id === 'route-inferred-aircraft')!;
    expect(inferred.props.data).toHaveLength(1);
    expect((layers as Layer[]).find((l) => l.id === 'route-live-aircraft')!.props.data).toHaveLength(1);
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
      plannedArc: [
        [-0.46, 51.47],
        [-73.78, 40.64],
      ],
      flownTrack: [
        { t: '2026-09-30T20:00:00Z', lat: 51.47, lng: -0.46, altFt: null, onGround: true, gsKt: 10, trackDeg: 270 },
        { t: '2026-09-30T20:05:00Z', lat: 51.6, lng: -2, altFt: 20000, onGround: false, gsKt: 400, trackDeg: 280 },
        { t: '2026-09-30T20:09:00Z', lat: 52, lng: -5, altFt: 37000, onGround: false, gsKt: 480, trackDeg: 280 },
      ],
      remainingLeg: [
        [-5, 52],
        [-73.78, 40.64],
      ],
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

  it('fit padding: HUD chrome (header, status bar, left rail) + 40 px (16 px on phones), plus the docked panel, capped', () => {
    expect(framePadding({ width: 1440, height: 900 }, null)).toEqual({ top: 104, right: 40, bottom: 68, left: 88 });
    expect(framePadding({ width: 1440, height: 900 }, { side: 'right', size: 424 })).toEqual({ top: 104, right: 464, bottom: 68, left: 88 });
    expect(framePadding({ width: 800, height: 900 }, { side: 'right', size: 424 }).right).toBe(464);
    expect(framePadding({ width: 600, height: 900 }, { side: 'right', size: 424 }).right).toBe(434); // capped: ¾ of the width minus the left side (phone margin)
    // Phone: no rail; the bottom sheet.
    expect(framePadding({ width: 390, height: 844 }, { side: 'bottom', size: 380 })).toEqual({ top: 80, right: 16, bottom: 396, left: 16 });
  });
});

describe('route-progress chips declutter (R2-M3)', () => {
  const JFK: [number, number] = [-73.7781, 40.6413];
  const LHR: [number, number] = [-0.4619, 51.47];
  const ac = (id: string, lng: number, lat: number, progress = 0.5) => ({ id, label: id, position: [lng, lat] as [number, number], progress, matched: true });

  it('drops chips on top of an endpoint label and chips that overlap one already placed; caps the count', () => {
    const project = screenProjector(false, [-40, 50], 2.5);
    const cands = [
      ac('NEARJFK1', -73.6, 40.7, 0.99), // inside the endpoint clearance at z 2.5
      ac('NEARJFK2', -73.9, 40.5, 0.98),
      ac('MID1', -40, 52),
      ac('MID2', -40.2, 52.05), // a few px from MID1 → overlapping box
      ac('EAST', -15, 53),
    ];
    const out = selectChips(cands, [JFK, LHR], project);
    expect(out.map((a) => a.id)).toEqual(['MID1', 'EAST']);
    // Zoomed in, the near-JFK aircraft separate from the airport and from each other.
    const close = selectChips(cands, [JFK, LHR], screenProjector(false, JFK, 9));
    expect(close.map((a) => a.id)).toContain('NEARJFK1');
    const many = Array.from({ length: 20 }, (_, i) => ac(`A${i}`, -60 + i * 2.5, 48 + (i % 2) * 6));
    expect(selectChips(many, [JFK, LHR], project).length).toBeLessThanOrEqual(CHIP_MAX);
  });

  it('globe projection: far-side points never get a chip; inferred aircraft never get one', () => {
    const project = screenProjector(true, [-40, 50], 2);
    expect(project([140, -30])).toBeNull();
    expect(selectChips([ac('FAR', 140, -30)], [], project)).toEqual([]);
    const live = { aircraft: [{ hex: 'a', callsign: 'JAL62', lat: 45, lng: 170, basis: 'inferred', direction: 'forward', progress: 0.5 }] } as unknown as Live;
    const layers = buildRouteLayers({ plan, live, flight: null, globe: false, center: [170, 45], zoom: 4, theme: 0 });
    expect(ids(layers)).not.toContain('route-progress-chips');
    expect(ids(layers)).toContain('route-inferred-aircraft');
  });

  it('on the real screen a chip is never placed under the HUD chrome or off screen (round 5 visual-qa: "JBU…" ran under the BLACK MARBLE chip)', () => {
    // A 390×844 phone in viewport px; each aircraft's screen point is given directly (MapLibre's
    // projection in the app). The chip box sits 20 px below the aircraft (CHIP_OFFSET_Y).
    const screenAt = new Map<string, [number, number]>([
      ['1,0', [120, 600]], // its chip would land on the BLACK MARBLE chip
      ['2,0', [200, 300]], // clear
      ['3,0', [385, 420]], // its chip would run off the right edge
    ]);
    const project = (p: [number, number]) => screenAt.get(`${p[0]},${p[1]}`) ?? null;
    const all = [ac('JBU1107', 1, 0, 0.42), ac('CLEAR', 2, 0), ac('EDGE', 3, 0)];
    const blackMarble = { left: 50, top: 612, right: 290, bottom: 638 };
    const screen = { obstacles: [blackMarble], width: 390, height: 844 };
    // Without the screen (the approximate projector of the unit tests) nothing knows about the chrome …
    expect(selectChips(all, [], project).map((a) => a.id)).toEqual(['JBU1107', 'CLEAR', 'EDGE']);
    // … with it, the chip under the BLACK MARBLE chip and the one cut by the edge are dropped (their rings stay).
    expect(selectChips(all, [], project, CHIP_MAX, screen).map((a) => a.id)).toEqual(['CLEAR']);
  });

  it('endpoint chips pile-up at a busy endpoint reduces to a readable few', () => {
    // Ten matched aircraft within ~150 km of JFK at the zoom that frames LHR–JFK.
    const pile = Array.from({ length: 10 }, (_, i) => ac(`P${i}`, -73.8 + (i % 5) * 0.35, 40.7 + Math.floor(i / 5) * 0.35, 0.9));
    const out = selectChips(pile, [JFK, LHR], screenProjector(true, [-41.3, 52.2], 2.3));
    expect(out).toEqual([]);
  });
});

describe('globe framing (R2-M4)', () => {
  const ep = (ident: string, iata: string, lng: number, lat: number) => endpoint(ident, iata, lng, lat);
  const viewport = { width: 1440, height: 900 };
  const area = frameArea(viewport, { side: 'right', size: 424 });
  const globeCamera = (frame: NonNullable<ReturnType<typeof routeFrame>>) => solveFrame(frame, { projection: 'globe', viewport, area });
  const projectFits = (cam: { center: [number, number]; zoom: number; anchor: [number, number]; padding: Padding }, pts: [number, number][]) => {
    const project = globeProjector(cam.center, cam.zoom, viewport.height);
    return pts.every((p) => {
      const xy = project(p);
      if (xy === null) return false;
      const x = cam.anchor[0] + xy[0];
      const y = cam.anchor[1] + xy[1];
      return x >= area.left - 1 && x <= area.right + 1 && y >= area.top - 1 && y <= area.bottom + 1;
    });
  };

  it('SVO→LAX (polar): centred near the arc midpoint in the Arctic, every arc point on the near side and inside the padded viewport', () => {
    const g = greatCircle([37.4146, 55.9726], [-118.408, 33.9425]);
    const frame = routeFrame(
      { ...plan, origin: ep('UUEE', 'SVO', 37.4146, 55.9726), destination: ep('KLAX', 'LAX', -118.408, 33.9425), greatCircle: g, filedPlans: [], diversionAirports: [] } as unknown as Plan,
      null,
      null,
    )!;
    const cam = globeCamera(frame)!;
    expect(cam.fits).toBe(true);
    expect(cam.center[1]).toBeGreaterThan(40); // over the Arctic side of the route, not the naive box centre
    // Within 30° of arc of the midpoint (longitudes converge up there: compare on the sphere).
    const D = Math.PI / 180;
    const [l1, p1] = [cam.center[0] * D, cam.center[1] * D];
    const [l2, p2] = [g.midpoint[0] * D, g.midpoint[1] * D];
    const arc = Math.acos(Math.min(1, Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(l1 - l2))) / D;
    expect(arc).toBeLessThan(30);
    expect(cam.zoom).toBeGreaterThan(-2);
    expect(projectFits(cam, frame.arc)).toBe(true);
    // The naive lng/lat box is centred at ~57° N, -40° — well away from the arc's 80° N apex.
    const b = frameBounds(frame)!;
    expect(b[1][0] - b[0][0]).toBeGreaterThan(150);
  });

  it('NRT→LAX (antimeridian): centre over the North Pacific, the whole arc fits', () => {
    const frame = routeFrame(plan, null, null)!;
    const cam = globeCamera(frame)!;
    expect(cam.fits).toBe(true);
    expect(cam.center[1]).toBeGreaterThan(20);
    expect(Math.abs(cam.center[0])).toBeGreaterThan(120); // over the North Pacific, normalised
    expect(projectFits(cam, frame.arc)).toBe(true);
  });

  it('LHR→JFK fits too and zooms in further than the long polar route', () => {
    const g = greatCircle([-0.4619, 51.47], [-73.7781, 40.6413]);
    const frame = routeFrame(
      { ...plan, origin: ep('EGLL', 'LHR', -0.4619, 51.47), destination: ep('KJFK', 'JFK', -73.7781, 40.6413), greatCircle: g, filedPlans: [], diversionAirports: [] } as unknown as Plan,
      null,
      null,
    )!;
    const cam = globeCamera(frame)!;
    expect(projectFits(cam, frame.arc)).toBe(true);
    const svo = globeCamera(routeFrame({ ...plan, greatCircle: greatCircle([37.4146, 55.9726], [-118.408, 33.9425]), filedPlans: [], diversionAirports: [] } as unknown as Plan, null, null)!)!;
    // Compare on-screen globe size (log2 px radius), not the zoom number (it depends on the centre latitude).
    const size = (c: { zoom: number; center: [number, number] }) => c.zoom - Math.log2(Math.cos((c.center[1] * Math.PI) / 180));
    expect(size(cam)).toBeGreaterThan(size(svo));
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

describe('flown track observation gaps (R4-m1)', () => {
  // ANA106 HND→LAX, live 2026-10-01: a 7 h 26 min gap between 16:26Z and 23:52Z over the Pacific.
  const pts = [
    { t: '2026-09-30T16:20:00Z', altFt: 37000 },
    { t: '2026-09-30T16:26:00Z', altFt: 37000 },
    { t: '2026-09-30T23:52:00Z', altFt: 36000 },
    { t: '2026-09-30T23:58:00Z', altFt: 30000 },
  ];
  const track: [number, number][] = [
    [144.2, 36.5],
    [144.79, 36.86],
    [233.67, 40.23],
    [234.5, 39.6],
  ];

  it('a pair 10 min or more apart is not joined: the gap is left blank', () => {
    expect(TRACK_GAP_MS).toBe(600_000);
    const segs = flownSegments(track, pts);
    expect(segs).toHaveLength(2);
    expect(Math.max(...segs.map((s) => Math.abs(s.to[0] - s.from[0])))).toBeLessThan(2);
  });

  it('routeFrame drops the gap segment', () => {
    const flight = {
      ident: 'ANA106',
      resolved: { callsign: 'ANA106', hex: '86e7a4', iataFlight: null, registration: null },
      origin: null,
      destination: null,
      plannedArc: [],
      flownTrack: pts.map((p, i) => ({ ...p, lat: track[i]![1], lng: ((track[i]![0] + 540) % 360) - 180, onGround: false, gsKt: 480, trackDeg: 60 })),
      remainingLeg: [],
      position: null,
    } as unknown as Flight;
    expect(routeFrame(null, null, flight)!.flown).toHaveLength(2);
  });
});
