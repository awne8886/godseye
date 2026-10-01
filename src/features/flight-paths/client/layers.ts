/**
 * Deck layers for the Flight Path Planner (§8 rendering): planned great circle (glow + dashed arc,
 * a dimmer return-leg line when reverse traffic is live), filed plans (dotted, diamond waypoints,
 * idents at z ≥ 5), flown track coloured by altitude (short data-driven segments on the FR24-style
 * ramp), dashed remaining leg, endpoints with labels, live aircraft with progress chips and
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
  if (aircraft.length) {
    const ring = color('--map-flight-watch');
    out.push(
      new ScatterplotLayer<Aircraft>({
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
    const chips = aircraft.filter((a) => typeof a.progress === 'number');
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
          getBorderColor: (d) => (d.matched ? ring : [ring[0], ring[1], ring[2], 140]),
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
  const pts: LngLatTuple[] = [...frame.arc, ...frame.flown.map((s) => s.to), ...frame.endpoints.map((e) => e.position), ...frame.aircraft.filter((a) => a.matched).map((a) => a.position)];
  if (frame.flown[0]) pts.push(frame.flown[0].from);
  return pathBounds(pts);
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Fit-bounds padding (§8: 80 px), plus room for the docked panel on the right (desktop) or the
 * bottom sheet (phone), capped so at least a quarter of the viewport stays for the route.
 */
export function framePadding(viewport: { width: number; height: number }, panel: { side: 'right' | 'bottom'; size: number } | null): Padding {
  const p: Padding = { top: 80, right: 80, bottom: 80, left: 80 };
  if (panel?.side === 'right') p.right = Math.min(80 + panel.size, Math.max(80, viewport.width * 0.75 - 160));
  if (panel?.side === 'bottom') p.bottom = Math.min(80 + panel.size, Math.max(80, viewport.height * 0.75 - 160));
  return p;
}
