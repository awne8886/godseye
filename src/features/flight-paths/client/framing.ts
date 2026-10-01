/**
 * Camera framing for a planned route or a tracked flight, in both projections (R2-M4, round 3 M2,
 * round 4 R3-m5/R3-m9 remainders). Pure: no DOM, no MapLibre — RouteLayer measures the HUD chrome
 * (insets.ts) and applies the result with `easeTo({center, zoom, padding})`.
 *
 * The model:
 *  - `area`: the screen box the whole drawing must stay inside — the viewport minus the edge chrome
 *    (header band, status bar, left rail, docked panel or phone sheet) and a margin;
 *  - `obstacles`: every overlay box measured over the map (header block, telemetry, view controls,
 *    imagery chips, attribution, readout row …). The endpoint dots and their code labels ("marks")
 *    must clear every obstacle; the arc may pass under small chrome when that is the price of a
 *    usable size (it never leaves the area);
 *  - the camera: a centre, a zoom and an *anchor* (the screen point where the centre lands, set
 *    with MapLibre's padding). The anchor is free inside the area, so the route can sit in the
 *    band between the phone's view controls and its chip/attribution stack, or right of the rail.
 *
 * Solving: for each candidate centre (globe: points along the arc, pulled toward the equator in
 * steps — MapLibre's globe radius grows with 1/cos(centre latitude); mercator: the route's world-box
 * centre) the highest zoom is searched (coarse descending scan, then bisection) at which an anchor
 * exists that keeps every point in the area and every mark clear of the obstacles. Levels, best
 * first: (A) the area also shrunk away from chrome the arc can avoid cheaply, (B) marks clear,
 * (C) one endpoint's marks clear, else marks inside the area only — the endpoints left under
 * chrome are reported (`hidden`, shown in PATHS), (D) nothing fits at the minimum zoom — centred on the route's visible hemisphere and
 * reported as a partial fit.
 */
import type { LngLatTuple } from '@/lib/geo';
import { pointAlong } from '../lib/geometry';
import type { RouteFrame } from './layers';

/** A viewport-space box (CSS px). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  width: number;
  height: number;
}

// ── Area (edge chrome + margin) ───────────────────────────────────────────────────
/** Breathing room between the route and the edge chrome on desktop. */
export const FRAME_MARGIN_PX = 40;
/** Phones have ~250 px of map above the sheet: a small margin keeps the route usable. */
export const PHONE_FRAME_MARGIN_PX = 16;
/** Tailwind `md`: below it the HUD has no left rail and the panel is a bottom sheet. */
export const PHONE_MAX_WIDTH = 768;

/**
 * Whether a viewport uses the phone layout when the caller does not say: width only. The app
 * passes `isPhoneLayout()` (insets.ts: the HUD's own media query, which also matches landscape
 * phones, 844×390, that have no rail and a bottom sheet).
 */
const phoneByWidth = (viewport: { width: number }) => viewport.width < PHONE_MAX_WIDTH;

/**
 * Fixed edge chrome over the map (R2-M4): header row (top-16 = 64 px), status bar (28 px), and in
 * the desktop layout the left layer rail (w-12 = 48 px). The docked panel / phone sheet is passed
 * separately.
 */
export function hudChrome(viewport: { width: number }, phone = phoneByWidth(viewport)): { top: number; bottom: number; left: number } {
  return { top: 64, bottom: 28, left: phone ? 0 : 48 };
}

/**
 * Edge padding of the framing area: the HUD chrome plus a margin (40 px, 16 px on phones), plus
 * the docked panel on the right (desktop) or the bottom sheet (phone); the panel share is capped so
 * at least a quarter of the viewport stays for the route.
 */
export function framePadding(viewport: Viewport, panel: { side: 'right' | 'bottom'; size: number } | null, phone = phoneByWidth(viewport)): Padding {
  const c = hudChrome(viewport, phone);
  const m = phone ? PHONE_FRAME_MARGIN_PX : FRAME_MARGIN_PX;
  const p: Padding = { top: c.top + m, right: m, bottom: c.bottom + m, left: c.left + m };
  if (panel?.side === 'right') p.right = Math.max(m, Math.min(m + panel.size, viewport.width * 0.75 - p.left));
  if (panel?.side === 'bottom') p.bottom = Math.max(p.bottom, Math.min(m + panel.size, viewport.height * 0.75 - p.top));
  return p;
}

/** The framing area as a screen box. */
export function frameArea(viewport: Viewport, panel: { side: 'right' | 'bottom'; size: number } | null, phone = phoneByWidth(viewport)): Rect {
  const p = framePadding(viewport, panel, phone);
  return { left: p.left, top: p.top, right: viewport.width - p.right, bottom: viewport.height - p.bottom };
}

/** MapLibre padding that puts the camera centre at screen point `anchor` (the smallest such padding). */
export function paddingFor(anchor: readonly [number, number], viewport: Viewport): Padding {
  const [x, y] = anchor;
  const dx = 2 * x - viewport.width;
  const dy = 2 * y - viewport.height;
  return { left: Math.round(Math.max(0, dx)), right: Math.round(Math.max(0, -dx)), top: Math.round(Math.max(0, dy)), bottom: Math.round(Math.max(0, -dy)) };
}

export const intersects = (a: Rect, b: Rect): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// ── Marks (endpoint dots + code labels) ───────────────────────────────────────────
/** Vertical gap (px) between an endpoint dot and its label when the label sits above/below it. */
export const LABEL_GAP_Y_PX = 17;
/** Horizontal gap (px) from the dot to the label centre (a 3–4 letter code is ~ 30 px wide). */
export const LABEL_GAP_X_PX = 28;

/**
 * Screen offset for an endpoint label (R3-m4): opposite the direction the arc leaves the endpoint,
 * so the label never sits on its own route and moves off the dense side where the route's country
 * labels sit. Direction in local east/north (lng scaled by cos lat; screen y grows downward).
 * Without an arc the label goes above the dot.
 */
export function endpointLabelOffset(end: LngLatTuple, toward: LngLatTuple | null): [number, number] {
  if (!toward) return [0, -LABEL_GAP_Y_PX];
  const east = (toward[0] - end[0]) * Math.cos(end[1] * (Math.PI / 180));
  const north = toward[1] - end[1];
  const n = Math.hypot(east, north);
  if (n < 1e-9) return [0, -LABEL_GAP_Y_PX];
  const ux = -east / n;
  const uy = north / n; // away from the arc, in screen y (down = +)
  return [Math.round(ux * LABEL_GAP_X_PX) + 0, Math.round(uy * LABEL_GAP_Y_PX) + 0]; // + 0: no -0
}

/** Endpoint label: 12 px JetBrains Mono (600) on a pill with [4, 2] px padding and a 1 px border. */
export const LABEL_FONT_PX = 12;
export const LABEL_PADDING_PX: [number, number] = [4, 2];
/** JetBrains Mono advances 0.6 em per glyph; 0.62 covers the font atlas' rounding. */
const LABEL_ADVANCE_EM = 0.62;
/** Endpoint dot: 5 px radius + 2 px ring. */
const DOT_HALF_PX = 7;
/** Clearance kept between a mark and any overlay. */
export const MARK_CLEAR_PX = 6;

/** Screen box of an endpoint label relative to the endpoint (centred on its pixel offset). */
export function labelBox(text: string, offset: readonly [number, number]): Rect {
  const w = text.length * LABEL_FONT_PX * LABEL_ADVANCE_EM + 2 * LABEL_PADDING_PX[0] + 2;
  const h = LABEL_FONT_PX + 2 * LABEL_PADDING_PX[1] + 2;
  return { left: offset[0] - w / 2, right: offset[0] + w / 2, top: offset[1] - h / 2, bottom: offset[1] + h / 2 };
}

export const DOT_BOX: Rect = { left: -DOT_HALF_PX, right: DOT_HALF_PX, top: -DOT_HALF_PX, bottom: DOT_HALF_PX };

/** A geographic point with a screen box around its projection (px, relative to the projected point). */
export interface Mark {
  at: LngLatTuple;
  box: Rect;
  /** Endpoint code (diagnostics). */
  label: string;
  kind: 'dot' | 'label';
}

/** The dot and the code label of every endpoint, as drawn by `buildRouteLayers`. */
export function endpointMarks(frame: Pick<RouteFrame, 'endpoints'>): Mark[] {
  return frame.endpoints.flatMap((e) => [
    { at: e.position, box: DOT_BOX, label: e.label, kind: 'dot' as const },
    { at: e.position, box: labelBox(e.label, e.labelOffset ?? [0, -LABEL_GAP_Y_PX]), label: e.label, kind: 'label' as const },
  ]);
}

// ── Points ────────────────────────────────────────────────────────────────────────
/** Every point that must be on screen for a route/flight (arc, flown track, endpoints, matched aircraft). */
export function framePoints(frame: RouteFrame): LngLatTuple[] {
  const pts: LngLatTuple[] = [...frame.arc, ...frame.flown.map((s) => s.to), ...frame.endpoints.map((e) => e.position), ...frame.aircraft.filter((a) => a.matched).map((a) => a.position)];
  if (frame.flown[0]) pts.push(frame.flown[0].from);
  return pts;
}

/** At most ~`max` points of a polyline, ends kept (the arc between samples bows by under a pixel). */
function thin(points: readonly LngLatTuple[], max: number): LngLatTuple[] {
  if (points.length <= max) return [...points];
  const step = Math.ceil(points.length / max);
  const out: LngLatTuple[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]!);
  out.push(points[points.length - 1]!);
  return out;
}

/** The framed points, thinned for the solver (arc and flown track ≤ ~64 points each). */
export function solverPoints(frame: RouteFrame): LngLatTuple[] {
  const flown = frame.flown.length ? [frame.flown[0]!.from, ...frame.flown.map((s) => s.to)] : [];
  return [...thin(frame.arc, 64), ...thin(flown, 64), ...frame.endpoints.map((e) => e.position), ...frame.aircraft.filter((a) => a.matched).map((a) => a.position)];
}

// ── Projections (pitch 0, offsets in px from the anchor) ──────────────────────────
const D2R = Math.PI / 180;
const TILE_PX = 512;
/** MapLibre's default vertical field of view (degrees): `cameraToCenterDistance = 0.5 / tan(fov/2) · height`. */
export const GLOBE_FOV_DEG = 36.87;

export type Projector = (p: LngLatTuple) => [number, number] | null;

/**
 * Perspective globe projection as MapLibre draws it at pitch 0 (round 3 M2): globe radius
 * `512·2^z / 2π / cos(centre lat)` px, camera `0.5/tan(fov/2)·H` px above the surface point at the
 * centre. Padding only shifts the vanishing point, so offsets are relative to the anchor. Returns
 * null behind the horizon.
 */
export function globeProjector(center: LngLatTuple, zoom: number, viewportHeight: number): Projector {
  const lat0 = center[1] * D2R;
  const lng0 = center[0] * D2R;
  const R = (TILE_PX * 2 ** zoom) / (2 * Math.PI) / Math.max(0.05, Math.cos(lat0));
  const camDist = (0.5 / Math.tan((GLOBE_FOV_DEG / 2) * D2R)) * viewportHeight;
  const camZ = R + camDist;
  const horizon = (R * R) / camZ;
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  return ([lng, lat]) => {
    const φ = lat * D2R;
    const dλ = lng * D2R - lng0;
    const x = R * Math.cos(φ) * Math.sin(dλ);
    const y = R * (cosLat0 * Math.sin(φ) - sinLat0 * Math.cos(φ) * Math.cos(dλ));
    const z = R * (sinLat0 * Math.sin(φ) + cosLat0 * Math.cos(φ) * Math.cos(dλ));
    if (z < horizon) return null;
    const s = camDist / (camZ - z);
    return [x * s, -y * s];
  };
}

const MERC_MAX_LAT = 85.051129;
/** Web-mercator world px (unwrapped longitudes stay linear: 400° is east of 180°). */
function mercWorld([lng, lat]: LngLatTuple, world: number): [number, number] {
  const s = Math.sin(Math.max(-MERC_MAX_LAT, Math.min(MERC_MAX_LAT, lat)) * D2R);
  return [(world * (lng + 180)) / 360, world * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI))];
}

/** Web-mercator at pitch 0: px offsets from the anchor (where `center` is drawn). */
export function mercatorProjector(center: LngLatTuple, zoom: number): Projector {
  const world = TILE_PX * 2 ** zoom;
  const [cx, cy] = mercWorld(center, world);
  return (p) => {
    const [x, y] = mercWorld(p, world);
    return [x - cx, y - cy];
  };
}

// ── Solver ────────────────────────────────────────────────────────────────────────
export interface FrameEnv {
  projection: 'globe' | 'mercator';
  viewport: Viewport;
  /** Every framed point and mark stays inside this box. */
  area: Rect;
  /** Overlay chrome; marks keep `MARK_CLEAR_PX` away from each one that reaches into the area. */
  obstacles?: readonly Rect[];
  minZoom?: number;
  maxZoom?: number;
}

export interface FrameFit {
  center: LngLatTuple;
  zoom: number;
  /** Screen point where `center` lands (the padded centre). */
  anchor: [number, number];
  /** MapLibre padding that puts `center` at `anchor`. */
  padding: Padding;
  /**
   * True when every framed point is in front of the horizon and inside the area at `zoom`. False
   * when the route cannot fit even at the minimum zoom: the camera then sits at the minimum zoom,
   * centred where the most of the route (both ends first) is in view.
   */
  fits: boolean;
  /** True when every endpoint dot and label is clear of every overlay. */
  clear: boolean;
  /**
   * Endpoint codes whose dot or label lands under an overlay at this camera (a fitting framing
   * that could not keep them clear, e.g. PER-LHR on a 390×844 phone); empty when `clear` or when
   * the route does not fit at all (PATHS then says that instead).
   */
  hidden: string[];
}

interface Shape {
  ext: Rect;
  marks: Rect[];
}

/** Offsets of every point and mark box from the anchor, or null when one is behind the horizon. */
function shapeOf(project: Projector, pts: readonly LngLatTuple[], marks: readonly Mark[]): Shape | null {
  const ext: Rect = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const p of pts) {
    const xy = project(p);
    if (!xy) return null;
    if (xy[0] < ext.left) ext.left = xy[0];
    if (xy[0] > ext.right) ext.right = xy[0];
    if (xy[1] < ext.top) ext.top = xy[1];
    if (xy[1] > ext.bottom) ext.bottom = xy[1];
  }
  const boxes: Rect[] = [];
  for (const m of marks) {
    const xy = project(m.at);
    if (!xy) return null;
    const b = { left: xy[0] + m.box.left, right: xy[0] + m.box.right, top: xy[1] + m.box.top, bottom: xy[1] + m.box.bottom };
    boxes.push(b);
    ext.left = Math.min(ext.left, b.left);
    ext.right = Math.max(ext.right, b.right);
    ext.top = Math.min(ext.top, b.top);
    ext.bottom = Math.max(ext.bottom, b.bottom);
  }
  return { ext, marks: boxes };
}

/**
 * The anchor nearest the middle of the feasible range that keeps the shape inside `area` and every
 * mark box `MARK_CLEAR_PX` away from every obstacle, or null. The anchors a mark/obstacle pair
 * forbids form an open box (their Minkowski difference); a free anchor, if any, lies on the edges
 * of those boxes or the range, so only those coordinates are tried. With `viewport`, the anchor
 * itself stays on screen (MapLibre padding cannot put the centre outside the canvas).
 */
export function placeAnchor(shape: Shape, area: Rect, obstacles: readonly Rect[], viewport?: Viewport): [number, number] | null {
  const x0 = Math.max(area.left - shape.ext.left, viewport ? 1 : -Infinity);
  const x1 = Math.min(area.right - shape.ext.right, viewport ? viewport.width - 1 : Infinity);
  const y0 = Math.max(area.top - shape.ext.top, viewport ? 1 : -Infinity);
  const y1 = Math.min(area.bottom - shape.ext.bottom, viewport ? viewport.height - 1 : Infinity);
  if (x0 > x1 + 1e-6 || y0 > y1 + 1e-6) return null;
  const pref: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const g = MARK_CLEAR_PX;
  const forbidden: Rect[] = [];
  for (const m of shape.marks) {
    for (const o of obstacles) {
      const f = { left: o.left - g - m.right, right: o.right + g - m.left, top: o.top - g - m.bottom, bottom: o.bottom + g - m.top };
      // Open box: an anchor on its edge only touches the clearance band. Skip boxes outside the range.
      if (f.left < x1 && f.right > x0 && f.top < y1 && f.bottom > y0) forbidden.push(f);
    }
  }
  const blocked = (x: number, y: number) => forbidden.some((f) => x > f.left && x < f.right && y > f.top && y < f.bottom);
  if (!blocked(pref[0], pref[1])) return pref;
  const within = (v: number, a: number, b: number) => v >= a - 1e-9 && v <= b + 1e-9;
  const xs = [...new Set([pref[0], x0, x1, ...forbidden.flatMap((f) => [f.left, f.right])])].filter((v) => within(v, x0, x1));
  const ys = [...new Set([pref[1], y0, y1, ...forbidden.flatMap((f) => [f.top, f.bottom])])].filter((v) => within(v, y0, y1));
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const x of xs) {
    const dx = (x - pref[0]) ** 2;
    if (dx >= bestD) continue;
    for (const y of ys) {
      const d = dx + (y - pref[1]) ** 2;
      if (d < bestD && !blocked(x, y)) {
        best = [x, y];
        bestD = d;
      }
    }
  }
  return best;
}

const normLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
const toVec = ([lng, lat]: LngLatTuple): [number, number, number] => [Math.cos(lat * D2R) * Math.cos(lng * D2R), Math.cos(lat * D2R) * Math.sin(lng * D2R), Math.sin(lat * D2R)];

interface Candidate {
  center: LngLatTuple;
  /** Candidates of one latitude-pull level share a group; the first group with a fit wins (globe). */
  group: number;
}

/** Globe centres: along the arc (midpoint first), each pulled toward the equator in steps. */
function globeCandidates(frame: RouteFrame, pts: readonly LngLatTuple[]): Candidate[] {
  const bases: LngLatTuple[] = [];
  if (frame.arc.length > 1) for (let i = 0; i <= 20; i++) bases.push(pointAlong(frame.arc, 0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.025)!);
  else {
    const s = pts.map(toVec).reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]] as [number, number, number], [0, 0, 0]);
    const n = Math.hypot(...s) || 1;
    bases.push([Math.atan2(s[1], s[0]) / D2R, Math.asin(s[2] / n) / D2R]);
  }
  const out: Candidate[] = [];
  const clampLat = (lat: number) => Math.max(-MERC_MAX_LAT, Math.min(MERC_MAX_LAT, lat));
  const SCALES = [1, 0.8, 0.6, 0.4, 0.2, 0];
  // MapLibre clamps a globe centre to ±85.05° (HEL→ANC's midpoint is at 88° N).
  SCALES.forEach((scale, group) => {
    for (const [lng, lat] of bases) out.push({ center: [normLng(lng), clampLat(lat * scale)], group });
  });
  // Seen from a centre on the arc, a great circle is a straight line along its local bearing: a
  // polar route (SIN→JFK over the pole) stands upright and cannot fit a wide, short band (a phone
  // between its view controls and its chip stack). Centres off the arc's plane (rotated about the
  // arc's tangent by θ) show it as an arch whose ends sit side by side.
  if (frame.arc.length > 2) {
    let group = SCALES.length;
    for (const f of [0.5, 0.4, 0.6]) {
      const m = toVec(pointAlong(frame.arc, f)!);
      const a = toVec(pointAlong(frame.arc, Math.max(0, f - 0.02))!);
      const b = toVec(pointAlong(frame.arc, Math.min(1, f + 0.02))!);
      const t: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const nx = m[1] * t[2] - m[2] * t[1];
      const ny = m[2] * t[0] - m[0] * t[2];
      const nz = m[0] * t[1] - m[1] * t[0];
      const nn = Math.hypot(nx, ny, nz);
      if (nn < 1e-12) continue;
      for (const deg of [20, 35, 50, 65]) {
        for (const sign of [1, -1]) {
          const θ = deg * D2R * sign;
          const v = [Math.cos(θ) * m[0] + (Math.sin(θ) * nx) / nn, Math.cos(θ) * m[1] + (Math.sin(θ) * ny) / nn, Math.cos(θ) * m[2] + (Math.sin(θ) * nz) / nn];
          out.push({ center: [normLng(Math.atan2(v[1]!, v[0]!) / D2R), clampLat(Math.asin(Math.max(-1, Math.min(1, v[2]!))) / D2R)], group });
        }
      }
      group++;
    }
  }
  return out;
}

/** Mercator centre: the middle of the route's world box (the shape does not depend on it). */
function mercatorCandidate(pts: readonly LngLatTuple[]): Candidate[] {
  if (!pts.length) return [];
  const world = TILE_PX;
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
  for (const p of pts) {
    const [x, y] = mercWorld(p, world);
    l = Math.min(l, x);
    r = Math.max(r, x);
    t = Math.min(t, y);
    b = Math.max(b, y);
  }
  const cx = (l + r) / 2;
  const cy = (t + b) / 2;
  const lng = (cx / world) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / world))) * 180) / Math.PI;
  return [{ center: [lng, lat], group: 0 }];
}

/**
 * MapLibre's own lower zoom bound for a centre. Globe: the minimum zoom is latitude-adjusted
 * (`minZoom + log2 cos(lat)`), so the globe has the same minimum on-screen size everywhere.
 * Mercator: the world stays at least one viewport tall (the default ±85.05° latRange).
 */
export function zoomFloor(env: Pick<FrameEnv, 'projection' | 'viewport'>, center: LngLatTuple, minZoom: number): number {
  return env.projection === 'globe' ? minZoom + Math.log2(Math.max(0.05, Math.cos(center[1] * D2R))) : Math.max(minZoom, Math.log2(env.viewport.height / TILE_PX));
}

/**
 * MapLibre clamps a mercator centre so that ±H/2 around it (padding ignored) stays inside ±85.05°.
 * Move the centre and its anchor by the same amount instead: the drawing stays where it was solved.
 */
export function mercatorRecentre(center: LngLatTuple, zoom: number, anchor: [number, number], viewportHeight: number): { center: LngLatTuple; anchor: [number, number] } {
  const world = TILE_PX * 2 ** zoom;
  const y = mercWorld(center, world)[1];
  const lo = viewportHeight / 2;
  const hi = Math.max(lo, world - viewportHeight / 2);
  const ty = Math.min(Math.max(y, lo), hi);
  if (Math.abs(ty - y) < 1e-6) return { center, anchor };
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / world))) * 180) / Math.PI;
  const ay = Math.min(viewportHeight - 1, Math.max(1, anchor[1] + (ty - y)));
  return { center: [center[0], lat], anchor: [anchor[0], ay] };
}

/** On-screen size rank: log2 of the globe's px radius (mercator: the zoom). */
const sizeOf = (projection: FrameEnv['projection'], center: LngLatTuple, zoom: number) => (projection === 'globe' ? zoom - Math.log2(Math.max(0.05, Math.cos(center[1] * D2R))) : zoom);

interface Solved {
  center: LngLatTuple;
  zoom: number;
  anchor: [number, number];
  size: number;
}

/**
 * Highest zoom in [minZoom, maxZoom] at which `place` finds an anchor for the centre: a descending
 * scan in 0.5 steps (fitting gets easier as the drawing shrinks, but obstacles make that only
 * nearly monotone), then a bisection between the first fitting step and the one above it.
 */
function bestZoom(place: (zoom: number) => [number, number] | null, minZoom: number, maxZoom: number): { zoom: number; anchor: [number, number] } | null {
  const STEP = 0.5;
  const zs: number[] = [];
  for (let z = maxZoom; z > minZoom + 1e-9; z -= STEP) zs.push(z);
  zs.push(minZoom);
  for (let i = 0; i < zs.length; i++) {
    const a = place(zs[i]!);
    if (!a) continue;
    let lo = zs[i]!;
    let anchor = a;
    if (i > 0) {
      let hi = zs[i - 1]!;
      for (let k = 0; k < 7; k++) {
        const mid = (lo + hi) / 2;
        const m = place(mid);
        if (m) {
          lo = mid;
          anchor = m;
        } else hi = mid;
      }
    }
    return { zoom: lo, anchor };
  }
  return null;
}

function solveLevel(
  candidates: readonly Candidate[],
  env: FrameEnv,
  pts: readonly LngLatTuple[],
  marks: readonly Mark[],
  area: Rect,
  obstacles: readonly Rect[],
  minZoom: number,
  maxZoom: number,
  /** Only the marks for which this is true must clear the obstacles (all of them by default). */
  mustClear?: (m: Mark) => boolean,
): Solved | null {
  const projector = (c: LngLatTuple, z: number) => (env.projection === 'globe' ? globeProjector(c, z, env.viewport.height) : mercatorProjector(c, z));
  let best: Solved | null = null;
  let group = -1;
  for (const cand of candidates) {
    // Globe: the least pulled-toward-the-equator level that fits wins (the route stays centred in view).
    if (best && cand.group !== group) break;
    group = cand.group;
    const floor = zoomFloor(env, cand.center, minZoom);
    const hit = bestZoom(
      (z) => {
        const shape = shapeOf(projector(cand.center, z), pts, marks);
        if (!shape) return null;
        return placeAnchor(mustClear ? { ext: shape.ext, marks: shape.marks.filter((_, i) => mustClear(marks[i]!)) } : shape, area, obstacles, env.viewport);
      },
      floor,
      Math.max(floor, maxZoom),
    );
    if (!hit) continue;
    const size = sizeOf(env.projection, cand.center, hit.zoom);
    // Strictly better only (candidates are ordered midpoint-first).
    if (!best || size > best.size + 0.01) best = { center: cand.center, zoom: hit.zoom, anchor: hit.anchor, size };
  }
  return best;
}

/**
 * The area minus the chrome the whole drawing can avoid cheaply: each obstacle reaching into the
 * area is cut off through the edge that loses the least, unless that would leave under half of
 * the area on that axis (then only the marks avoid it).
 */
export function shrinkArea(area: Rect, obstacles: readonly Rect[], clear = MARK_CLEAR_PX): Rect {
  const a = { ...area };
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const size = (r: Rect) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  for (const o of [...obstacles].sort((p, q) => size(q) - size(p))) {
    if (!intersects(o, a)) continue;
    const cuts: { edge: keyof Rect; value: number; loss: number; ok: boolean }[] = [
      { edge: 'top', value: o.bottom + clear, loss: (o.bottom + clear - a.top) / H, ok: a.bottom - (o.bottom + clear) >= H / 2 },
      { edge: 'bottom', value: o.top - clear, loss: (a.bottom - (o.top - clear)) / H, ok: o.top - clear - a.top >= H / 2 },
      { edge: 'left', value: o.right + clear, loss: (o.right + clear - a.left) / W, ok: a.right - (o.right + clear) >= W / 2 },
      { edge: 'right', value: o.left - clear, loss: (a.right - (o.left - clear)) / W, ok: o.left - clear - a.left >= W / 2 },
    ];
    const ok = cuts.filter((c) => c.ok);
    if (!ok.length) continue;
    const cut = ok.reduce((p, q) => (q.loss < p.loss ? q : p));
    a[cut.edge] = cut.value;
  }
  return a;
}

/** Prefer the fully clear framing unless it costs more than this much size (log2 px) against B. */
const LEVEL_A_SLACK = 0.5;

/** Endpoint codes with a mark box (screen px) overlapping any obstacle, in endpoint order. */
export function hiddenLabels(marks: readonly { label: string; box: Rect }[], obstacles: readonly Rect[]): string[] {
  const out: string[] = [];
  for (const m of marks) if (!out.includes(m.label) && obstacles.some((o) => intersects(m.box, o))) out.push(m.label);
  return out;
}

/**
 * Solve the camera for a route/flight frame (see the module comment). Null when nothing is framed.
 */
export function solveFrame(frame: RouteFrame, env: FrameEnv): FrameFit | null {
  const minZoom = env.minZoom ?? 0;
  const maxZoom = Math.max(minZoom, env.maxZoom ?? 8);
  const pts = solverPoints(frame);
  if (!pts.length) return null;
  const marks = endpointMarks(frame);
  const area = env.area;
  const obstacles = (env.obstacles ?? []).filter((o) => intersects({ left: o.left - MARK_CLEAR_PX, top: o.top - MARK_CLEAR_PX, right: o.right + MARK_CLEAR_PX, bottom: o.bottom + MARK_CLEAR_PX }, area));
  const candidates = env.projection === 'globe' ? globeCandidates(frame, pts) : mercatorCandidate(pts);
  const finish = (center: LngLatTuple, zoom: number, anchor: [number, number], fits: boolean, hidden: string[]): FrameFit => {
    const r = env.projection === 'mercator' ? mercatorRecentre(center, zoom, anchor, env.viewport.height) : { center, anchor };
    return { center: r.center, zoom, anchor: r.anchor, padding: paddingFor(r.anchor, env.viewport), fits, clear: fits && hidden.length === 0, hidden };
  };
  const done = (s: Solved, hidden: string[]): FrameFit => finish(s.center, s.zoom, s.anchor, true, hidden);

  if (obstacles.length) {
    const b = solveLevel(candidates, env, pts, marks, area, obstacles, minZoom, maxZoom);
    const shrunk = shrinkArea(area, obstacles);
    const a = shrunk.right - shrunk.left < area.right - area.left || shrunk.bottom - shrunk.top < area.bottom - area.top ? solveLevel(candidates, env, pts, marks, shrunk, obstacles, minZoom, maxZoom) : null;
    if (a && (!b || a.size >= b.size - LEVEL_A_SLACK)) return done(a, []);
    if (b) return done(b, []);
  }
  // (C) The marks cannot all be kept clear: keep as many endpoints clear as possible (one end
  // clear when only one can be, the larger such framing), else the marks only inside the area; say
  // which endpoints the chrome covers at the chosen camera.
  const hiddenAt = (s: Solved) => {
    const project = env.projection === 'globe' ? globeProjector(s.center, s.zoom, env.viewport.height) : mercatorProjector(s.center, s.zoom);
    const boxes = markBoxes(frame, (p) => {
      const xy = project(p);
      return xy ? [xy[0] + s.anchor[0], xy[1] + s.anchor[1]] : null;
    });
    return hiddenLabels(boxes, obstacles);
  };
  let partial: { s: Solved; hidden: string[] } | null = null;
  if (obstacles.length && frame.endpoints.length > 1) {
    for (const e of frame.endpoints) {
      const s = solveLevel(candidates, env, pts, marks, area, obstacles, minZoom, maxZoom, (m) => m.label === e.label);
      if (!s) continue;
      const hidden = hiddenAt(s);
      if (!partial || hidden.length < partial.hidden.length || (hidden.length === partial.hidden.length && s.size > partial.s.size + 0.01)) partial = { s, hidden };
    }
  }
  if (partial) return done(partial.s, partial.hidden);
  const c = solveLevel(candidates, env, pts, marks, area, [], minZoom, maxZoom);
  if (c) return done(c, hiddenAt(c));

  // (D) Cannot fit at the minimum zoom: keep both ends in front of the horizon, then show as much
  // of the route inside the area as possible, anchored at the area's centre.
  const anchor: [number, number] = [(area.left + area.right) / 2, (area.top + area.bottom) / 2];
  const ends = frame.endpoints.map((e) => e.position);
  const inArea = (xy: [number, number] | null) => xy !== null && xy[0] + anchor[0] >= area.left && xy[0] + anchor[0] <= area.right && xy[1] + anchor[1] >= area.top && xy[1] + anchor[1] <= area.bottom;
  let fallback: { c: LngLatTuple; zoom: number; score: number } | null = null;
  for (const { center } of candidates) {
    const zoom = zoomFloor(env, center, minZoom);
    const project = env.projection === 'globe' ? globeProjector(center, zoom, env.viewport.height) : mercatorProjector(center, zoom);
    const score = ends.filter((p) => project(p) !== null).length * 100_000 + pts.filter((p) => inArea(project(p))).length;
    if (!fallback || score > fallback.score) fallback = { c: center, zoom, score };
  }
  return finish(fallback!.c, fallback!.zoom, anchor, false, []);
}

/** Screen boxes of every mark for a camera (diagnostics and tests): absolute px. */
export function markBoxes(frame: Pick<RouteFrame, 'endpoints'>, project: (p: LngLatTuple) => [number, number] | null): { label: string; kind: Mark['kind']; box: Rect }[] {
  return endpointMarks(frame).flatMap((m) => {
    const xy = project(m.at);
    return xy ? [{ label: m.label, kind: m.kind, box: { left: xy[0] + m.box.left, right: xy[0] + m.box.right, top: xy[1] + m.box.top, bottom: xy[1] + m.box.bottom } }] : [];
  });
}
