// Round 6: arc height on the globe, route clicks, airways layer, geocoded-place disclosure (R4 m7).
import { describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { distanceKm, type LngLatTuple } from '@/lib/geo';
import type { Selection } from '@/lib/layer-host';
import j80 from '../__fixtures__/faa-adds-ats-route-J80.json';
import { greatCircle } from '../lib/geometry';
import { mergeAirwayFeatures } from '../lib/airways';
import type { Live, Plan } from './api';
import { airportSelection, arcHeightAt, arcHeights, ARC_HEIGHT, buildRouteAnimLayers, buildRouteLayers, GLOBE_LIFT_M, routeFrame, routeNeedsFlights } from './layers';
import { draftMessage, nearText, type DraftSuggestion } from './draft';

const endpoint = (ident: string, iata: string, lng: number, lat: number) => ({ ident, icao: ident, iata, name: `${iata} Intl`, lat, lng, tz: null, municipality: null, isoCountry: 'US' });
const DEN: LngLatTuple = [-104.6731, 39.8617];
const CMH: LngLatTuple = [-82.8919, 39.998];
const gc = greatCircle(DEN, CMH);
const j80Lines = mergeAirwayFeatures(j80.body.features as unknown as Parameters<typeof mergeAirwayFeatures>[0])[0]!.lines;
const plan = {
  origin: endpoint('KDEN', 'DEN', ...DEN),
  destination: endpoint('KCMH', 'CMH', ...CMH),
  greatCircle: gc,
  diversionAirports: [{ code: 'MCI', name: 'Kansas City Intl', runwayM: 3300, distanceFromPathKm: 20, alongPathKm: 800, lat: 39.2976, lng: -94.7139 }],
  airways: [{ ident: 'J80', type: 'CONV', geometry: { type: 'MultiLineString', coordinates: j80Lines.slice(0, 3) } }],
} as unknown as Plan;
const byId = (layers: unknown[], id: string) => (layers as Layer[]).find((l) => l.id === id);
type Picker = (info: { object?: unknown }) => Selection | null;

describe('arc height (globe): getHeight-0.3 apex on a sin² profile', () => {
  it('z(t) = 0.15·D·sin²(πt): 0 at the ends, 0.15·D at the middle', () => {
    const z = arcHeights(gc.points);
    const D = gc.distanceKm * 1000;
    expect(z[0]).toBe(0);
    expect(z[z.length - 1]).toBeCloseTo(0, 6);
    const mid = Math.max(...z);
    expect(mid / D).toBeCloseTo(ARC_HEIGHT * 0.5, 2);
    expect(arcHeightAt(0.5, gc.distanceKm)).toBeCloseTo(ARC_HEIGHT * gc.distanceKm * 1000 * 0.5, 6);
  });

  it('round 7: the ends are tangent to the surface (no vertical climb projected past the endpoint)', () => {
    const km = 5555; // LHR→JFK
    // The old √(t(1−t)) profile climbed ~165 km in the first 1 %; sin² stays under 1 km there.
    expect(arcHeightAt(0.01, km)).toBeLessThan(1_000);
    expect(arcHeightAt(0.99, km)).toBeLessThan(1_000);
    // Slope (height per horizontal metre) → 0 at both ends, finite everywhere, symmetric.
    const slope = (t: number, dt = 1e-4) => (arcHeightAt(t + dt, km) - arcHeightAt(t, km)) / (dt * km * 1000);
    expect(slope(0)).toBeLessThan(0.001);
    expect(Math.abs(slope(1 - 1e-4))).toBeLessThan(0.001);
    for (let t = 0; t < 1; t += 0.01) expect(Math.abs(slope(t))).toBeLessThan(ARC_HEIGHT * Math.PI / 2 + 1e-3);
    expect(arcHeightAt(0.3, km)).toBeCloseTo(arcHeightAt(0.7, km), 6);
    // The drawn arc's first vertices hug the lift too.
    const z = arcHeights(gc.points);
    expect(z[1]!).toBeLessThan(ARC_HEIGHT * gc.distanceKm * 1000 * 0.01);
  });

  it('planned glow, arc and return line rise on the profile; flown/remaining/endpoints stay at the lift', () => {
    const live = { aircraft: [{ hex: 'a0b1c2', callsign: 'UAL1', lat: 39.5, lng: -95, basis: 'matched', direction: 'reverse', progress: 0.5, observedAt: '2026-10-02T00:00:00Z' }] } as unknown as Live;
    const layers = buildRouteLayers({ plan, live, flight: null, globe: true, center: [-95, 40], theme: 0 });
    for (const id of ['route-planned-glow', 'route-planned-arc', 'route-reverse-arc']) {
      const path = (byId(layers, id)!.props.data as { path: number[][] }[])[0]!.path;
      expect(path[0]![2]).toBe(GLOBE_LIFT_M);
      expect(Math.max(...path.map((q) => q[2]!))).toBeGreaterThan(GLOBE_LIFT_M + 100_000);
    }
    const merc = buildRouteLayers({ plan, live, flight: null, globe: false, center: [-95, 40], theme: 0 });
    expect((byId(merc, 'route-planned-arc')!.props.data as { path: number[][] }[])[0]!.path[0]).toHaveLength(2);
  });

  it('the comet head rides the same profile on the globe and the surface in mercator', () => {
    const frame = routeFrame(plan, null, null);
    const globe = buildRouteAnimLayers({ frame, globe: true, phase: 0.5, reducedMotion: false, theme: 0 }) as Layer[];
    const comet = globe.find((l) => l.id === 'route-comet')!;
    const head = (comet.props.data as { position: LngLatTuple; k: number }[]).find((d) => d.k === 0)!;
    const getPos = (comet.props as unknown as { getPosition: (d: unknown) => number[] }).getPosition;
    let km = 0;
    for (let i = 1; i < gc.points.length; i++) km += distanceKm(gc.points[i - 1]!, gc.points[i]!);
    expect(getPos(head)[2]).toBeCloseTo(GLOBE_LIFT_M + arcHeightAt(0.5, km), 0);
    const merc = buildRouteAnimLayers({ frame, globe: false, phase: 0.5, reducedMotion: false, theme: 0 }) as Layer[];
    expect((merc.find((l) => l.id === 'route-comet')!.props as unknown as { getPosition: (d: unknown) => number[] }).getPosition(head)[2]).toBe(0);
  });
});

describe('route clicks', () => {
  it('endpoints and diversions are pickable and select the airport (reference data, no observation time)', () => {
    const layers = buildRouteLayers({ plan, live: null, flight: null, globe: false, center: [-95, 40], theme: 0 });
    for (const [id, role, code] of [['route-endpoints', 'endpoint', 'DEN'], ['route-diversions', 'diversion', 'MCI']] as const) {
      const l = byId(layers, id)!;
      expect(l.props.pickable).toBe(true);
      const obj = (l.props.data as unknown[])[0];
      const s = (l.props as unknown as { toSelection: Picker }).toSelection({ object: obj })!;
      expect(s).toMatchObject({ kind: 'airport', layer: null, source: 'ourairports', observedAt: null, data: { code, role } });
      expect((l.props as unknown as { toSelection: Picker }).toSelection({})).toBeNull();
    }
  });

  it('airport selections wrap unwrapped longitudes back into ±180', () => {
    const s = airportSelection({ id: 'NZAA', position: [-185.2, -37], label: 'AKL', code: 'AKL', name: 'Auckland' }, 'endpoint');
    expect(s.lngLat![0]).toBeCloseTo(174.8, 6);
  });

  it('a matched live aircraft opens the aircraft card through the injected resolver (never a made-up record)', () => {
    const live = { aircraft: [{ hex: 'a0b1c2', callsign: 'UAL1', lat: 39.5, lng: -95, basis: 'matched', direction: 'forward', progress: 0.5, observedAt: '2026-10-02T00:00:00Z' }] } as unknown as Live;
    const sel: Selection = { kind: 'aircraft', id: 'a0b1c2', layer: 'flights', source: 'adsblol_tiles', observedAt: '2026-10-02T00:00:00Z', data: {}, lngLat: [-95, 39.5] };
    const asked: string[] = [];
    const aircraftSelect = (hex: string) => {
      asked.push(hex);
      return hex === 'a0b1c2' ? sel : null;
    };
    const layers = buildRouteLayers({ plan, live, flight: null, globe: false, center: [-95, 40], theme: 0, aircraftSelect });
    const l = byId(layers, 'route-live-aircraft')!;
    expect(l.props.pickable).toBe(true);
    expect((l.props as unknown as { toSelection: Picker }).toSelection({ object: (l.props.data as unknown[])[0] })).toBe(sel);
    expect(asked).toEqual(['a0b1c2']);
    const without = buildRouteLayers({ plan, live, flight: null, globe: false, center: [-95, 40], theme: 0 });
    expect(byId(without, 'route-live-aircraft')!.props.pickable).toBe(false);
  });

  it('round 7: a corridor-inferred aircraft is pickable and opens the aircraft card too', () => {
    const live = { aircraft: [{ hex: 'c0ffee', callsign: 'SWA9', lat: 39.4, lng: -96, basis: 'inferred', direction: 'forward', progress: null, observedAt: '2026-10-02T00:00:00Z' }] } as unknown as Live;
    const sel: Selection = { kind: 'aircraft', id: 'c0ffee', layer: 'flights', source: 'adsblol_tiles', observedAt: '2026-10-02T00:00:00Z', data: {}, lngLat: [-96, 39.4] };
    const asked: string[] = [];
    const aircraftSelect = (hex: string) => {
      asked.push(hex);
      return hex === 'c0ffee' ? sel : null;
    };
    const layers = buildRouteLayers({ plan, live, flight: null, globe: false, center: [-95, 40], theme: 0, aircraftSelect });
    expect(byId(layers, 'route-live-aircraft')).toBeUndefined();
    const l = byId(layers, 'route-inferred-aircraft')!;
    expect(l.props.pickable).toBe(true);
    const pick = (l.props as unknown as { toSelection: Picker }).toSelection;
    expect(pick({ object: (l.props.data as unknown[])[0] })).toBe(sel);
    expect(pick({})).toBeNull();
    expect(asked).toEqual(['c0ffee']);
    const without = buildRouteLayers({ plan, live, flight: null, globe: false, center: [-95, 40], theme: 0 });
    expect(byId(without, 'route-inferred-aircraft')!.props.pickable).toBe(false);
  });

  it('round 7: the shared flights query is enabled for inferred aircraft as well as matched ones', () => {
    const inferred = { aircraft: [{ hex: 'c0ffee', basis: 'inferred' }] } as unknown as Live;
    const matched = { aircraft: [{ hex: 'a0b1c2', basis: 'matched' }] } as unknown as Live;
    expect(routeNeedsFlights(inferred, null)).toBe(true);
    expect(routeNeedsFlights(matched, undefined)).toBe(true);
    expect(routeNeedsFlights({ aircraft: [] } as unknown as Live, null)).toBe(false);
    expect(routeNeedsFlights(undefined, { position: { lat: 1, lng: 2 } } as never)).toBe(true);
    expect(routeNeedsFlights(undefined, { position: null } as never)).toBe(false);
  });
});

describe('route-airways layer', () => {
  it('draws the US airways under the route; ident labels only at z ≥ 5', () => {
    const far = buildRouteLayers({ plan, live: null, flight: null, globe: false, center: [-95, 40], zoom: 4, theme: 0 });
    const ids = (far as Layer[]).map((l) => l.id);
    expect(ids[0]).toBe('route-airways');
    expect(ids).not.toContain('route-airway-labels');
    expect((byId(far, 'route-airways')!.props.data as unknown[]).length).toBe(3);
    const near = buildRouteLayers({ plan, live: null, flight: null, globe: false, center: [-95, 40], zoom: 5, theme: 0 });
    const labels = byId(near, 'route-airway-labels')!;
    expect((labels.props.data as { label: string }[]).map((d) => d.label)).toEqual(['J80']);
    expect((labels.props.parameters as { depthCompare?: string }).depthCompare).toBe('always');
  });
});

describe('geocoded-place disclosure (R4 m7)', () => {
  it('the draft names the place, the source and the distance', () => {
    const s: DraftSuggestion = { code: 'BRS', label: 'Bristol', side: 'from', text: 'Glastonbury', near: { place: 'Glastonbury, United Kingdom', source: 'photon', distanceKm: 31.6 } };
    expect(nearText(s.near!)).toBe('Nearest airport to Glastonbury, United Kingdom (photon):');
    expect(draftMessage({ unresolved: ['Glastonbury'], failed: [], same: null, suggestions: [s] })).toBe(
      'No airport named "Glastonbury". Nearest airport to Glastonbury, United Kingdom (photon): Did you mean BRS (Bristol, 32 km)?',
    );
  });
});
