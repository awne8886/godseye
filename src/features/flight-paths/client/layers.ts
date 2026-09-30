/**
 * Deck layers for the Flight Path Planner (§8 rendering): planned great circle (glow + line),
 * filed plans, flown track coloured by altitude (short data-driven segments), remaining leg,
 * endpoints with labels, live aircraft on the route and diversion airports. Paths use the
 * server's UNWRAPPED longitudes so they stay continuous in mercator and on the globe; billboard
 * points are filtered to the camera-facing hemisphere on the globe. Pure (no React). Client-only.
 */
import { LineLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { LayersList } from '@deck.gl/core';
import type { LngLatTuple } from '@/lib/geo';
import { getFarSideCamera, isFacing } from '@/lib/map/far-side';
import { readCssColor, type MapToken, type Rgba } from '@/lib/tokens';
import type { Flight, Live, Plan } from './api';

export interface RouteLayerInput {
  plan: Plan | null;
  live: Live | null;
  flight: Flight | null;
  globe: boolean;
  /** Camera centre; changes re-run the far-side filter (globe only). */
  center: LngLatTuple;
  /** Bumps when the theme changes so colours are re-read. */
  theme: number;
}

const NO_CULL = { cullMode: 'none' } as const;
/** On the globe, route lines float 8 km up (≈ cruise level) so they never z-fight the surface mesh. */
export const GLOBE_LIFT_M = 8000;
type Pos = [number, number] | [number, number, number];
const color = (t: MapToken, a = 1): Rgba => readCssColor(t, a);

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [0, 1, 2, 3].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgba;
}

/** Altitude colour: low (--map-alt-low) → high (--map-alt-high) over 0–40,000 ft. */
export function altitudeColor(altFt: number | null, low: Rgba, high: Rgba): Rgba {
  if (altFt === null) return low;
  return mix(low, high, Math.max(0, Math.min(1, altFt / 40_000)));
}

interface Point {
  id: string;
  position: LngLatTuple;
  label: string;
}

const facing = (globe: boolean) => (p: LngLatTuple) => !globe || isFacing(p, getFarSideCamera());

export function buildRouteLayers(o: RouteLayerInput): LayersList {
  const out: LayersList = [];
  const planned = color('--map-route-planned');
  const vis = facing(o.globe);
  const trigger = { getColor: [o.theme], getFillColor: [o.theme], getLineColor: [o.theme], getPath: [o.globe] };
  const lift = (path: readonly [number, number][]): Pos[] => (o.globe ? path.map(([x, y]) => [x, y, GLOBE_LIFT_M] as Pos) : (path as Pos[]));

  const arcs: { id: string; path: Pos[] }[] = [];
  if (o.plan) arcs.push({ id: 'plan', path: lift(o.plan.greatCircle.points) });
  else if (o.flight?.plannedArc.length) arcs.push({ id: 'flight', path: lift(o.flight.plannedArc) });
  if (arcs.length) {
    out.push(
      new PathLayer<{ path: Pos[] }>({
        id: 'route-planned-glow',
        data: arcs,
        getPath: (d) => d.path,
        getColor: color('--map-route-planned', 0.15),
        getWidth: 6,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        parameters: NO_CULL,
        updateTriggers: trigger,
      }),
      new PathLayer<{ path: Pos[] }>({
        id: 'route-planned-arc',
        data: arcs,
        getPath: (d) => d.path,
        getColor: [planned[0], planned[1], planned[2], 153],
        getWidth: 2,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        parameters: NO_CULL,
        updateTriggers: trigger,
      }),
    );
  }

  const filed = o.plan?.filedPlans ?? [];
  if (filed.length) {
    out.push(
      new PathLayer<{ path: Pos[] }>({
        id: 'route-filed',
        data: filed.map((f) => ({ path: lift(f.waypoints.map((w) => [w.lng, w.lat] as [number, number])) })),
        getPath: (d) => d.path,
        getColor: color('--map-route-filed', 0.85),
        getWidth: 1.5,
        widthUnits: 'pixels',
        wrapLongitude: true,
        parameters: NO_CULL,
        updateTriggers: trigger,
      }),
    );
  }

  const track = o.flight?.flownTrack ?? [];
  if (track.length > 1) {
    const low = color('--map-alt-low');
    const high = color('--map-alt-high');
    const segs = track.slice(1).map((p, i) => ({ from: [track[i]!.lng, track[i]!.lat] as LngLatTuple, to: [p.lng, p.lat] as LngLatTuple, alt: p.altFt }));
    out.push(
      new LineLayer<(typeof segs)[number]>({
        id: 'route-flown-track',
        data: segs,
        getSourcePosition: (d) => d.from,
        getTargetPosition: (d) => d.to,
        getColor: (d) => altitudeColor(d.alt, low, high),
        getWidth: 3,
        widthUnits: 'pixels',
        parameters: NO_CULL,
        updateTriggers: trigger,
      }),
    );
  }

  const remaining = o.flight?.remainingLeg ?? [];
  if (remaining.length > 1) {
    out.push(
      new PathLayer<{ path: Pos[] }>({
        id: 'route-remaining',
        data: [{ path: lift(remaining) }],
        getPath: (d) => d.path,
        getColor: color('--map-route-planned', 0.45),
        getWidth: 1.5,
        widthUnits: 'pixels',
        parameters: NO_CULL,
        updateTriggers: trigger,
      }),
    );
  }

  const ends = o.plan ? [o.plan.origin, o.plan.destination] : o.flight ? [o.flight.origin, o.flight.destination].filter((e) => e !== null) : [];
  const endpoints: Point[] = ends.map((e) => ({ id: e.ident, position: [e.lng, e.lat] as LngLatTuple, label: e.iata ?? e.icao ?? e.ident })).filter((p) => vis(p.position));
  if (endpoints.length) {
    out.push(
      new ScatterplotLayer<Point>({
        id: 'route-endpoints',
        data: endpoints,
        getPosition: (d) => d.position,
        getRadius: 5,
        radiusUnits: 'pixels',
        getFillColor: [255, 255, 255, 255],
        getLineColor: color('--map-airport-watch'),
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        stroked: true,
        billboard: true,
        parameters: { depthCompare: 'always' },
        updateTriggers: trigger,
      }),
      new TextLayer<Point>({
        id: 'route-endpoint-labels',
        data: endpoints,
        getPosition: (d) => d.position,
        getText: (d) => d.label,
        getColor: color('--map-airport-watch'),
        getSize: 12,
        getPixelOffset: [0, -16],
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: 600,
        billboard: true,
        parameters: { ...NO_CULL, depthCompare: 'always' },
        updateTriggers: trigger,
      }),
    );
  }

  const diversions: Point[] = (o.plan?.diversionAirports ?? [])
    .filter((d): d is typeof d & { lat: number; lng: number } => typeof d.lat === 'number' && typeof d.lng === 'number')
    .map((d) => ({ id: d.code, position: [d.lng, d.lat] as LngLatTuple, label: d.code }))
    .filter((p) => vis(p.position));
  if (diversions.length) {
    out.push(
      new ScatterplotLayer<Point>({
        id: 'route-diversions',
        data: diversions,
        getPosition: (d) => d.position,
        getRadius: 3.5,
        radiusUnits: 'pixels',
        getFillColor: color('--map-route-filed', 0.8),
        billboard: true,
        parameters: { depthCompare: 'always' },
        updateTriggers: trigger,
      }),
    );
  }

  const aircraft: (Point & { matched: boolean })[] = (o.live?.aircraft ?? [])
    .map((a) => ({ id: a.hex, position: [a.lng, a.lat] as LngLatTuple, label: a.callsign ?? a.hex, matched: a.basis === 'matched' }))
    .filter((p) => vis(p.position));
  if (o.flight?.position) {
    const p: LngLatTuple = [o.flight.position.lng, o.flight.position.lat];
    if (vis(p)) aircraft.push({ id: o.flight.resolved.hex ?? 'flight', position: p, label: o.flight.resolved.callsign ?? o.flight.ident, matched: true });
  }
  if (aircraft.length) {
    const ring = color('--map-flight-watch');
    out.push(
      new ScatterplotLayer<(typeof aircraft)[number]>({
        id: 'route-live-aircraft',
        data: aircraft,
        getPosition: (d) => d.position,
        getRadius: 9,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: (d) => (d.matched ? ring : [ring[0], ring[1], ring[2], 140]),
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        billboard: true,
        parameters: { depthCompare: 'always' },
        updateTriggers: trigger,
      }),
    );
  }
  return out;
}

/** Camera target for a planned route: the arc midpoint and a zoom that fits its length. */
export function cameraFor(plan: Pick<Plan, 'greatCircle'>): { lng: number; lat: number; zoom: number } {
  const [lng, lat] = plan.greatCircle.midpoint;
  const km = Math.max(50, plan.greatCircle.distanceKm);
  return { lng, lat, zoom: Math.max(1, Math.min(8, Math.log2(24_000 / km) + 0.6)) };
}
