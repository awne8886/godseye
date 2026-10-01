/**
 * Deck layers for the Flight Path Planner (§8 rendering): planned great circle (glow + dashed arc,
 * a dimmer return-leg line when reverse traffic is live), filed plans (dotted, diamond waypoints,
 * idents at z ≥ 5), flown track coloured by altitude (short data-driven segments on the FR24-style
 * ramp), dashed remaining leg, endpoints with labels, live aircraft (MATCHED: solid ring + a
 * decluttered progress chip; INFERRED: dotted ◌ ring, no chip) and
 * diversion airports; plus the animated layers (≤ 3 pulse rings on the endpoints and a comet head
 * along the planned arc), which are omitted under reduced motion.
 *
 * Antimeridian (R4-B1): everything drawn for one route or flight is put into ONE longitude frame —
 * the planned arc's, which the server unwraps from the origin (it may run past ±180°). The flown
 * track is unwrapped point to point, the aircraft/remaining leg/filed plans/diversions are moved
 * into the arc's world copy. No segment spans more than 180° of longitude, so nothing is drawn
 * across the map in mercator and the globe gets the same continuous geometry. Pure (no React).
 * Client-only.
 */
import { LineLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { LayersList } from '@deck.gl/core';
import type { LngLatTuple } from '@/lib/geo';
import { getFarSideCamera, isFacing } from '@/lib/map/far-side';
import { hexToRgba, parseCssColor, readCssColor, UI_TOKENS, type MapToken, type Rgba } from '@/lib/tokens';
import { dashPieces, intoFrame, nearLng, pathBounds, pathIntoFrame, pointAlong, unwrapPath } from '../lib/geometry';
import type { Flight, Live, Plan } from './api';

export interface RouteLayerInput {
  plan: Plan | null;
  live: Live | null;
  flight: Flight | null;
  globe: boolean;
  /** Camera centre; changes re-run the far-side filter (globe only). */
  center: LngLatTuple;
  /** Camera zoom (filed-plan idents appear at z ≥ 5). */
  zoom?: number;
  /** Bumps when the theme changes so colours are re-read. */
  theme: number;
}

const NO_CULL = { cullMode: 'none' } as const;
/** On the globe, route lines float 8 km up (≈ cruise level) so they never z-fight the surface mesh. */
export const GLOBE_LIFT_M = 8000;
/** Filed-plan waypoint idents are only legible when zoomed in (§8: z ≥ 5). */
export const FILED_LABEL_MIN_ZOOM = 5;
/** At most this many expanding rings per endpoint (§7 motion budget). */
export const PULSE_RINGS = 3;
type Pos = [number, number] | [number, number, number];
const color = (t: MapToken, a = 1): Rgba => readCssColor(t, a);

/** A UI token (not a `--map-*` one) as RGBA, read from the document with the TS mirror as fallback. */
function uiColor(token: keyof typeof UI_TOKENS, a = 1): Rgba {
  const fallback = hexToRgba(UI_TOKENS[token], a);
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return (raw && parseCssColor(raw, a)) || fallback;
}

// ── Altitude ramp ─────────────────────────────────────────────────────────────────
/**
 * FR24-style altitude stops (§8): white < 300 ft, then yellow, green, cyan, blue, purple and red
 * above 19,700 ft. Colours come from the `--map-alt-0 … --map-alt-6` tokens; while a theme does not
 * define them the ramp falls back to the two-stop `--map-alt-low` → `--map-alt-high` mix.
 */
export const ALT_RAMP_FT = [0, 300, 2_000, 5_000, 10_000, 15_000, 19_700] as const;
export const ALT_RAMP_TOKENS = ['--map-alt-0', '--map-alt-1', '--map-alt-2', '--map-alt-3', '--map-alt-4', '--map-alt-5', '--map-alt-6'] as const;

export interface AltitudeRamp {
  stopsFt: readonly number[];
  colors: readonly Rgba[];
}

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [0, 1, 2, 3].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgba;
}

/** The ramp from the document (FR24 tokens when all are defined, else the two-stop low/high tokens). */
export function readAltitudeRamp(): AltitudeRamp {
  if (typeof window !== 'undefined') {
    const cs = getComputedStyle(document.documentElement);
    const stops = ALT_RAMP_TOKENS.map((t) => parseCssColor(cs.getPropertyValue(t).trim() || '-'));
    if (stops.every((c): c is Rgba => c !== null)) return { stopsFt: ALT_RAMP_FT, colors: stops };
  }
  return { stopsFt: [0, 40_000], colors: [color('--map-alt-low'), color('--map-alt-high')] };
}

/** Colour for an altitude on a ramp (piecewise linear between stops; null altitude = the lowest stop). */
export function altitudeColor(altFt: number | null, ramp: AltitudeRamp): Rgba {
  const { stopsFt, colors } = ramp;
  if (altFt === null || altFt <= stopsFt[0]!) return colors[0]!;
  for (let i = 1; i < stopsFt.length; i++) {
    if (altFt <= stopsFt[i]!) return mix(colors[i - 1]!, colors[i]!, (altFt - stopsFt[i - 1]!) / (stopsFt[i]! - stopsFt[i - 1]!));
  }
  return colors[colors.length - 1]!;
}

// ── One longitude frame ───────────────────────────────────────────────────────────
interface Point {
  id: string;
  position: LngLatTuple;
  label: string;
}
interface Aircraft extends Point {
  matched: boolean;
  /** 0–1 along the route (server-computed) or null when unknown. */
  progress: number | null;
}
export interface FlownSegment {
  from: LngLatTuple;
  to: LngLatTuple;
  alt: number | null;
}

/** Everything drawn for one route/flight, in one continuous longitude frame. */
export interface RouteFrame {
  arc: LngLatTuple[];
  /** True when live traffic flies the pair in the reverse direction (return-leg line). */
  reverse: boolean;
  filed: { id: string; path: LngLatTuple[]; waypoints: Point[] }[];
  flown: FlownSegment[];
  remaining: LngLatTuple[];
  endpoints: Point[];
  diversions: Point[];
  aircraft: Aircraft[];
}

/** Observation gaps at least this long are left blank instead of being joined by a straight line. */
export const TRACK_GAP_MS = 10 * 60_000;

/**
 * Consecutive flown-track points → altitude-coloured segments. A pair more than `TRACK_GAP_MS` apart
 * (no coverage in between) is skipped, so the gap shows as a gap rather than an observed line.
 */
export function flownSegments(track: readonly LngLatTuple[], points: readonly { t: string; altFt: number | null }[], gapMs = TRACK_GAP_MS): FlownSegment[] {
  const out: FlownSegment[] = [];
  for (let i = 1; i < track.length && i < points.length; i++) {
    const dt = Date.parse(points[i]!.t) - Date.parse(points[i - 1]!.t);
    if (!(dt < gapMs)) continue;
    out.push({ from: track[i - 1]!, to: track[i]!, alt: points[i]!.altFt });
  }
  return out;
}

const codeOf = (e: { iata: string | null; icao: string | null; ident: string }) => e.iata ?? e.icao ?? e.ident;

/** Build the single-frame geometry for a planned route or a tracked flight (null when nothing to draw). */
export function routeFrame(plan: Plan | null, live: Live | null, flight: Flight | null): RouteFrame | null {
  if (!plan && !flight) return null;
  const arc: LngLatTuple[] = plan ? plan.greatCircle.points.map(([x, y]) => [x, y] as LngLatTuple) : (flight?.plannedArc.map(([x, y]) => [x, y] as LngLatTuple) ?? []);

  const trackRaw: LngLatTuple[] = (flight?.flownTrack ?? []).map((p) => [p.lng, p.lat]);
  const track = trackRaw.length ? unwrapPath(trackRaw, arc.length ? intoFrame(trackRaw[0]!, arc)[0] : undefined) : [];
  const flown = flownSegments(track, flight?.flownTrack ?? []);
  // The frame for anything else: the arc, else the flown track (a flight without a known route).
  const ref = arc.length ? arc : track;
  const place = (p: LngLatTuple): LngLatTuple => (ref.length ? intoFrame(p, ref) : p);

  const aircraft: Aircraft[] = (live?.aircraft ?? []).map((a) => ({ id: a.hex, position: place([a.lng, a.lat]), label: a.callsign ?? a.hex, matched: a.basis === 'matched', progress: a.progress }));
  let remaining: LngLatTuple[] = [];
  if (flight?.position) {
    const raw: LngLatTuple = [flight.position.lng, flight.position.lat];
    const last = track[track.length - 1];
    const here: LngLatTuple = last ? [nearLng(raw[0], last[0]), raw[1]] : place(raw);
    aircraft.push({ id: flight.resolved.hex ?? 'flight', position: here, label: flight.resolved.callsign ?? flight.ident, matched: true, progress: flight.progress });
    if (flight.remainingLeg.length > 1) remaining = unwrapPath(flight.remainingLeg, here[0]);
  } else if (flight && flight.remainingLeg.length > 1) {
    remaining = ref.length ? pathIntoFrame(flight.remainingLeg, ref) : unwrapPath(flight.remainingLeg);
  }

  const ends = plan ? [plan.origin, plan.destination] : flight ? [flight.origin, flight.destination].filter((e) => e !== null) : [];
  const endpoints: Point[] = ends.map((e, i) => {
    const raw: LngLatTuple = [e.lng, e.lat];
    // Origin in the copy of the arc's start, destination in the copy of its end.
    const anchor = arc.length ? (i === 0 ? arc[0]! : arc[arc.length - 1]!) : null;
    return { id: e.ident, position: anchor ? [nearLng(raw[0], anchor[0]), raw[1]] : place(raw), label: codeOf(e) };
  });

  const diversions: Point[] = (plan?.diversionAirports ?? [])
    .filter((d): d is typeof d & { lat: number; lng: number } => typeof d.lat === 'number' && typeof d.lng === 'number')
    .map((d) => ({ id: d.code, position: place([d.lng, d.lat]), label: d.code }));

  const filed = (plan?.filedPlans ?? [])
    .map((f) => {
      const path = ref.length ? pathIntoFrame(f.waypoints.map((w) => [w.lng, w.lat] as LngLatTuple), ref) : unwrapPath(f.waypoints.map((w) => [w.lng, w.lat] as LngLatTuple));
      return { id: f.id, path, waypoints: f.waypoints.map((w, i) => ({ id: `${f.id}:${i}`, position: path[i]!, label: w.ident })) };
    })
    .filter((f) => f.path.length > 1);

  return { arc, reverse: (live?.aircraft ?? []).some((a) => a.direction === 'reverse'), filed, flown, remaining, endpoints, diversions, aircraft };
}

const facing = (globe: boolean) => (p: LngLatTuple) => !globe || isFacing(p, getFarSideCamera());

export function buildRouteLayers(o: RouteLayerInput, frame: RouteFrame | null = routeFrame(o.plan, o.live, o.flight)): LayersList {
  const out: LayersList = [];
  if (!frame) return out;
  const planned = color('--map-route-planned');
  const vis = facing(o.globe);
  const trigger = { getColor: [o.theme], getFillColor: [o.theme], getLineColor: [o.theme], getPath: [o.globe] };
  const lift = (path: readonly LngLatTuple[]): Pos[] => (o.globe ? path.map(([x, y]) => [x, y, GLOBE_LIFT_M] as Pos) : (path as Pos[]));
  const pathLayer = (id: string, paths: readonly (readonly LngLatTuple[])[], rgba: Rgba, width: number) =>
    new PathLayer<{ path: Pos[] }>({
      id,
      data: paths.map((p) => ({ path: lift(p) })),
      getPath: (d) => d.path,
      getColor: rgba,
      getWidth: width,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      antialiasing: true,
      parameters: NO_CULL,
      updateTriggers: trigger,
    } as ConstructorParameters<typeof PathLayer<{ path: Pos[] }>>[0]);

  if (frame.arc.length > 1) {
    out.push(pathLayer('route-planned-glow', [frame.arc], color('--map-route-planned', 0.15), 6));
    if (frame.reverse) out.push(pathLayer('route-reverse-arc', [frame.arc], color('--map-route-planned', 0.25), 1));
    // Dashed: runs of arc vertices with gaps (no dash extension needed; every vertex is the server's).
    out.push(pathLayer('route-planned-arc', dashPieces(frame.arc, 4, 3), [planned[0], planned[1], planned[2], 153], 2));
  }

  if (frame.filed.length) {
    const filedColor = color('--map-route-filed', 0.85);
    out.push(pathLayer('route-filed', frame.filed.flatMap((f) => dashPieces(f.path, 1, 1)), filedColor, 1.5));
    const wpts = frame.filed.flatMap((f) => f.waypoints).filter((w) => vis(w.position));
    out.push(
      new TextLayer<Point>({
        id: 'route-filed-waypoints',
        data: wpts,
        getPosition: (d) => d.position,
        getText: () => '◆',
        characterSet: ['◆'],
        getColor: filedColor,
        getSize: 9,
        billboard: true,
        parameters: { ...NO_CULL, depthCompare: 'always' },
        updateTriggers: trigger,
      }),
    );
    if ((o.zoom ?? 0) >= FILED_LABEL_MIN_ZOOM) {
      out.push(
        new TextLayer<Point>({
          id: 'route-filed-labels',
          data: wpts,
          getPosition: (d) => d.position,
          getText: (d) => d.label,
          getColor: filedColor,
          getSize: 10,
          getPixelOffset: [0, -11],
          fontFamily: 'JetBrains Mono, monospace',
          billboard: true,
          parameters: { ...NO_CULL, depthCompare: 'always' },
          updateTriggers: trigger,
        }),
      );
    }
  }

  if (frame.flown.length) {
    const ramp = readAltitudeRamp();
    out.push(
      new LineLayer<FlownSegment>({
        id: 'route-flown-track',
        data: frame.flown,
        getSourcePosition: (d) => (o.globe ? [d.from[0], d.from[1], GLOBE_LIFT_M] : d.from),
        getTargetPosition: (d) => (o.globe ? [d.to[0], d.to[1], GLOBE_LIFT_M] : d.to),
        getColor: (d) => altitudeColor(d.alt, ramp),
        getWidth: 3,
        widthUnits: 'pixels',
        antialiasing: true,
        parameters: NO_CULL,
        updateTriggers: { ...trigger, getSourcePosition: [o.globe], getTargetPosition: [o.globe] },
      } as ConstructorParameters<typeof LineLayer<FlownSegment>>[0]),
    );
  }

  if (frame.remaining.length > 1) out.push(pathLayer('route-remaining', dashPieces(frame.remaining, 2, 2), color('--map-route-planned', 0.45), 1.5));

  const endpoints = frame.endpoints.filter((p) => vis(p.position));
  if (endpoints.length) {
    const ring = color('--map-airport-watch');
    out.push(
      new ScatterplotLayer<Point>({
        id: 'route-endpoints',
        data: endpoints,
        getPosition: (d) => d.position,
        getRadius: 5,
        radiusUnits: 'pixels',
        getFillColor: uiColor('--text-primary'),
        getLineColor: ring,
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
        getColor: ring,
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

  const diversions = frame.diversions.filter((p) => vis(p.position));
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

  const aircraft = frame.aircraft.filter((p) => vis(p.position));
  const ring = color('--map-flight-watch');
  // R2-M2: corridor-inferred aircraft are secondary — a small dotted ring (◌), dimmer, no progress
  // chip — so they never read like a MATCHED service on the pair. Matched keep the solid ring.
  const inferred = aircraft.filter((a) => !a.matched);
  if (inferred.length) {
    out.push(
      new TextLayer<Aircraft>({
        id: 'route-inferred-aircraft',
        data: inferred,
        getPosition: (d) => d.position,
        getText: () => INFERRED_GLYPH,
        characterSet: [INFERRED_GLYPH],
        getColor: [ring[0], ring[1], ring[2], 170],
        getSize: 18,
        billboard: true,
        parameters: { ...NO_CULL, depthCompare: 'always' },
        updateTriggers: trigger,
      }),
    );
  }
  const matched = aircraft.filter((a) => a.matched);
  if (matched.length) {
    out.push(
      new ScatterplotLayer<Aircraft>({
        id: 'route-live-aircraft',
        data: matched,
        getPosition: (d) => d.position,
        getRadius: 9,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: ring,
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        billboard: true,
        parameters: { depthCompare: 'always' },
        updateTriggers: trigger,
      }),
    );
    // R2-M3: chips only for matched aircraft, decluttered in screen space (none on top of an
    // endpoint label, no two overlapping, at most CHIP_MAX).
    const project = screenProjector(o.globe, o.center, o.zoom ?? 2);
    const chips = selectChips(
      matched.filter((a) => typeof a.progress === 'number'),
      endpoints.map((e) => e.position),
      project,
    );
    if (chips.length) {
      out.push(
        new TextLayer<Aircraft>({
          id: 'route-progress-chips',
          data: chips,
          getPosition: (d) => d.position,
          getText: (d) => progressChip(d.label, d.progress ?? 0),
          characterSet: 'auto',
          getColor: uiColor('--text-primary'),
          background: true,
          getBackgroundColor: uiColor('--bg-primary', 0.85),
          getBorderColor: ring,
          getBorderWidth: 1,
          backgroundPadding: [4, 2],
          getSize: 10,
          getPixelOffset: [0, 20],
          fontFamily: 'JetBrains Mono, monospace',
          billboard: true,
          parameters: { ...NO_CULL, depthCompare: 'always' },
          updateTriggers: { ...trigger, getBackgroundColor: [o.theme], getBorderColor: [o.theme] },
        }),
      );
    }
  }
  return out;
}

// ── Label declutter (R2-M3) ───────────────────────────────────────────────────────
/** Dotted-circle glyph marking an INFERRED (corridor-heuristic) aircraft on the map. */
export const INFERRED_GLYPH = '◌';
/** At most this many progress chips at once. */
export const CHIP_MAX = 6;
/** No chip whose anchor is within this many px of an endpoint (its label sits there). */
export const ENDPOINT_CLEAR_PX = 48;
/** Chip box estimate: 10 px JetBrains Mono ≈ 6.2 px per character, plus padding. */
const CHIP_CHAR_PX = 6.2;
const CHIP_H_PX = 16;
const CHIP_OFFSET_Y = 20;
const TILE_PX = 512;

export type Projector = (p: LngLatTuple) => [number, number] | null;

/**
 * Approximate screen-pixel projection for decluttering (pitch ignored): web-mercator world pixels,
 * or on the globe an orthographic view around the camera centre whose radius follows MapLibre's
 * globe scale (`worldSize / 2π / cos(centre lat)`). Far-side points project to null.
 */
export function screenProjector(globe: boolean, center: LngLatTuple, zoom: number): Projector {
  const world = TILE_PX * 2 ** zoom;
  if (!globe) {
    return ([lng, lat]) => {
      const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
      return [(world * (lng + 180)) / 360, world * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI))];
    };
  }
  const rad = Math.PI / 180;
  const lat0 = center[1] * rad;
  const lng0 = center[0] * rad;
  const R = world / (2 * Math.PI) / Math.max(0.05, Math.cos(lat0));
  return ([lng, lat]) => {
    const φ = lat * rad;
    const dλ = lng * rad - lng0;
    const cosc = Math.sin(lat0) * Math.sin(φ) + Math.cos(lat0) * Math.cos(φ) * Math.cos(dλ);
    if (cosc < 0) return null;
    return [R * Math.cos(φ) * Math.sin(dλ), -R * (Math.cos(lat0) * Math.sin(φ) - Math.sin(lat0) * Math.cos(φ) * Math.cos(dλ))];
  };
}

/**
 * Greedy chip placement in priority order (the server's order: forward, then by progress; a
 * tracked flight first): skip chips anchored within `ENDPOINT_CLEAR_PX` of an endpoint, chips whose
 * box overlaps one already placed, and everything past `CHIP_MAX`. The aircraft rings stay.
 */
export function selectChips<T extends { position: LngLatTuple; label: string; progress: number | null }>(
  candidates: readonly T[],
  endpoints: readonly LngLatTuple[],
  project: Projector,
  max = CHIP_MAX,
): T[] {
  const ends = endpoints.map(project).filter((p): p is [number, number] => p !== null);
  const boxes: [number, number, number, number][] = [];
  const out: T[] = [];
  for (const c of candidates) {
    if (out.length >= max) break;
    const p = project(c.position);
    if (!p) continue;
    if (ends.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < ENDPOINT_CLEAR_PX)) continue;
    const w = progressChip(c.label, c.progress ?? 0).length * CHIP_CHAR_PX + 8;
    const box: [number, number, number, number] = [p[0] - w / 2, p[1] + CHIP_OFFSET_Y - CHIP_H_PX / 2, p[0] + w / 2, p[1] + CHIP_OFFSET_Y + CHIP_H_PX / 2];
    if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    out.push(c);
  }
  return out;
}

/** "BAW117 · 42%" — progress along the route as the server computed it. */
export function progressChip(label: string, progress: number): string {
  return `${label} · ${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}

// ── Animated layers (pulse + comet) ───────────────────────────────────────────────
export interface RouteAnimInput {
  frame: RouteFrame | null;
  globe: boolean;
  /** Animation phase 0–1 (one pulse / one comet pass per period). */
  phase: number;
  reducedMotion: boolean;
  theme: number;
}

/** Comet tail: this many trailing dots, fading, behind the head. */
export const COMET_TAIL = 6;

/**
 * Pulse rings (≤ 3 per endpoint) and the comet head moving along the planned arc. Returns [] under
 * reduced motion: the static endpoint rings and the dashed arc already carry the information.
 */
export function buildRouteAnimLayers(o: RouteAnimInput): LayersList {
  if (o.reducedMotion || !o.frame || o.frame.arc.length < 2) return [];
  const vis = facing(o.globe);
  const ring = color('--map-airport-watch');
  const rings = o.frame.endpoints
    .filter((p) => vis(p.position))
    .flatMap((p) => Array.from({ length: PULSE_RINGS }, (_, k) => ({ position: p.position, t: (o.phase * 2 + k / PULSE_RINGS) % 1 })));
  const arc = o.frame.arc;
  const head = o.phase;
  const comet = Array.from({ length: COMET_TAIL + 1 }, (_, k) => ({ position: pointAlong(arc, head - k * 0.006)!, k })).filter((c) => head - c.k * 0.006 >= 0 && vis(c.position));
  const planned = color('--map-route-planned');
  const liftZ = o.globe ? GLOBE_LIFT_M : 0;
  return [
    new ScatterplotLayer<{ position: LngLatTuple; t: number }>({
      id: 'route-endpoint-pulse',
      data: rings,
      getPosition: (d) => d.position,
      getRadius: (d) => 6 + d.t * 18,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineColor: (d) => [ring[0], ring[1], ring[2], Math.round(200 * (1 - d.t))],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      billboard: true,
      parameters: { depthCompare: 'always' },
      updateTriggers: { getRadius: [o.phase], getLineColor: [o.phase, o.theme] },
    }),
    new ScatterplotLayer<{ position: LngLatTuple; k: number }>({
      id: 'route-comet',
      data: comet,
      getPosition: (d) => [d.position[0], d.position[1], liftZ],
      getRadius: (d) => (d.k === 0 ? 4 : 3 - d.k * 0.35),
      radiusUnits: 'pixels',
      getFillColor: (d) => [planned[0], planned[1], planned[2], Math.round(255 * (1 - d.k / (COMET_TAIL + 1)))],
      billboard: true,
      parameters: { depthCompare: 'always' },
      updateTriggers: { getPosition: [o.phase, o.globe], getFillColor: [o.theme] },
    }),
  ];
}

// ── Camera ────────────────────────────────────────────────────────────────────────
/** Camera target for a planned route: the arc midpoint and a zoom that fits its length. */
export function cameraFor(plan: Pick<Plan, 'greatCircle'>): { lng: number; lat: number; zoom: number } {
  const [lng, lat] = plan.greatCircle.midpoint;
  const km = Math.max(50, plan.greatCircle.distanceKm);
  return { lng, lat, zoom: Math.max(1, Math.min(8, Math.log2(24_000 / km) + 0.6)) };
}

/** Bounds of everything framed for a route/flight (unwrapped; MapLibre handles lng outside ±180). */
export function frameBounds(frame: RouteFrame): [[number, number], [number, number]] | null {
  return pathBounds(framePoints(frame));
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Breathing room between the route and the HUD chrome / viewport edge. */
export const FRAME_MARGIN_PX = 40;
/**
 * Fixed HUD chrome over the map (R2-M4): header row (top-16 = 64 px), status bar (28 px), and on
 * ≥ 768 px the left layer rail (w-12 = 48 px). The docked panel is passed separately.
 */
export function hudChrome(viewport: { width: number }): { top: number; bottom: number; left: number } {
  return { top: 64, bottom: 28, left: viewport.width >= 768 ? 48 : 0 };
}

/**
 * Fit padding: the HUD chrome (header, status bar, left rail) plus a 40 px margin, plus the docked
 * panel on the right (desktop) or the bottom sheet (phone); the panel share is capped so at least
 * a quarter of the viewport stays for the route.
 */
export function framePadding(viewport: { width: number; height: number }, panel: { side: 'right' | 'bottom'; size: number } | null): Padding {
  const c = hudChrome(viewport);
  const m = FRAME_MARGIN_PX;
  const p: Padding = { top: c.top + m, right: m, bottom: c.bottom + m, left: c.left + m };
  if (panel?.side === 'right') p.right = Math.max(m, Math.min(m + panel.size, viewport.width * 0.75 - p.left));
  if (panel?.side === 'bottom') p.bottom = Math.max(p.bottom, Math.min(m + panel.size, viewport.height * 0.75 - p.top));
  return p;
}

const D2R = Math.PI / 180;
const toVec = ([lng, lat]: LngLatTuple): [number, number, number] => [Math.cos(lat * D2R) * Math.cos(lng * D2R), Math.cos(lat * D2R) * Math.sin(lng * D2R), Math.sin(lat * D2R)];
const angleDeg = (a: LngLatTuple, b: LngLatTuple) => {
  const [x1, y1, z1] = toVec(a);
  const [x2, y2, z2] = toVec(b);
  return Math.acos(Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2))) / D2R;
};

/** Every point that must be on screen for a route/flight (arc, flown track, endpoints, matched aircraft). */
export function framePoints(frame: RouteFrame): LngLatTuple[] {
  const pts: LngLatTuple[] = [...frame.arc, ...frame.flown.map((s) => s.to), ...frame.endpoints.map((e) => e.position), ...frame.aircraft.filter((a) => a.matched).map((a) => a.position)];
  if (frame.flown[0]) pts.push(frame.flown[0].from);
  return pts;
}

/**
 * Globe framing (R2-M4). A lng/lat bounding box is meaningless for polar or antimeridian routes
 * (SVO→LAX's box spans 156° of longitude while the arc passes 80° N), so on the globe the camera
 * centres on the arc's midpoint (else the spherical centroid) and zooms so the farthest framed
 * point — at angular distance θ — fits the padded viewport: MapLibre's globe radius in px is
 * `512·2^z / 2π / cos(centre lat)` and a point θ from the centre sits `R·sin θ` from it.
 */
export function globeCamera(frame: RouteFrame, viewport: { width: number; height: number }, padding: Padding, maxZoom = 8): { center: LngLatTuple; zoom: number } | null {
  const pts = framePoints(frame);
  if (!pts.length) return null;
  let center: LngLatTuple;
  if (frame.arc.length > 1) center = pointAlong(frame.arc, 0.5)!;
  else {
    const s = pts.map(toVec).reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]] as [number, number, number], [0, 0, 0]);
    const n = Math.hypot(...s) || 1;
    center = [Math.atan2(s[1], s[0]) / D2R, Math.asin(s[2] / n) / D2R];
  }
  center = [((((center[0] + 180) % 360) + 360) % 360) - 180, center[1]];
  const theta = Math.max(0.05, ...pts.map((p) => angleDeg(center, p)));
  const avail = Math.max(60, Math.min(viewport.width - padding.left - padding.right, viewport.height - padding.top - padding.bottom) / 2);
  const sinT = theta >= 90 ? 1 : Math.sin(theta * D2R);
  const zoom = Math.log2((avail * 2 * Math.PI * Math.cos(center[1] * D2R)) / (TILE_PX * sinT));
  return { center, zoom: Math.max(0, Math.min(maxZoom, zoom)) };
}
