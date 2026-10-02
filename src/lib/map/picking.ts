/**
 * Click/hover arbitration between deck.gl layers and native MapLibre layers (§4). Everything
 * under the pointer becomes a candidate; `choosePick()` (registry `pickPriority`, ties → the
 * top-most candidate) picks the one whose card opens via `useSelectionStore.select()`.
 *
 * How feature modules opt in (each returns an unregister function):
 *  - deck layers: pass a `toSelection(info)` prop on the layer, or `registerDeckPick(layerId, fn)`;
 *  - native layers: `registerNativePick(styleLayerId, fn)`;
 *  - CPU hit-tests (projected positions, H3 lookups, rendered-feature queries — works where GPU
 *    picking does not, e.g. SwiftShader or the interleaved overlay): `registerHitTester(id, fn)`.
 * A resolver returns a Selection (kind, id, registry layer, source, observedAt, data, lngLat) or
 * null for "not selectable". The map host is the ONLY click listener: it gathers every candidate
 * with `collectCandidates()`, drops those behind the globe and selects `routePick()`'s winner, so
 * one click opens exactly one card. Modules never listen to `click` themselves.
 *
 * Drawn marks (round 8): a point layer drawn ON TOP of the layers it overlaps may declare the
 * radius of each drawn mark — a `pickMarkPx` prop on the deck layer (centre = its `getPosition`), or
 * `markRadiusPx` on a hit-tester's candidate. A declared mark that contains the pointer wins the
 * click outright (the nearest such mark), so a small dot under the pointer is never lost to a
 * higher-priority mark that is only within the pick tolerance (the route's LHR dot vs the matched
 * aircraft ring drawn next to it). Everything else keeps the priority order.
 * Owner: map-engine. Pure and unit-tested.
 */
import type { Selection } from '@/lib/layer-host';
import { choosePick, getLayer } from '@/lib/layer-registry';

export interface PickCandidate {
  layer: string;
  selection: Selection;
  /** Screen distance (px) from the pointer to the mark's centre (CPU hit-tests, declared deck marks); breaks ties within one priority. */
  distancePx?: number;
  /**
   * Radius (px) of the mark as drawn around that centre. With `distancePx` ≤ this the mark covers
   * the pointer and wins the click (`routePick`). Declare it only for marks drawn above the layers
   * they overlap.
   */
  markRadiusPx?: number;
  /** Height (m) the marker is drawn at; the far-side test lifts the point by it (satellites). Default 0. */
  altitudeM?: number;
}

/** CPU hit-test: every selectable entity of this module near the point (any order). */
export type HitTester = (point: { x: number; y: number }, map: HitTestMap) => PickCandidate[];

/** The map surface a hit-tester may use (a real MapLibre map satisfies it). */
export interface HitTestMap {
  project: (lngLat: [number, number]) => { x: number; y: number };
  unproject: (point: [number, number]) => { lng: number; lat: number; wrap: () => { lng: number; lat: number } };
  getZoom: () => number;
  getCenter: () => { lng: number; lat: number };
  getLayer: (id: string) => unknown;
  queryRenderedFeatures: (point: [number, number], options?: { layers?: string[] }) => unknown[];
}

/** The part of a deck.gl PickingInfo this module reads. */
export interface DeckPickInfo {
  object?: unknown;
  index?: number;
  coordinate?: number[] | null;
  layer?: { id: string; props: Record<string, unknown> } | null;
}

export type DeckPickResolver = (info: DeckPickInfo) => Selection | null;

/** The part of a MapLibre query-rendered feature this module reads. */
export interface NativeFeature {
  layer: { id: string };
  properties?: Record<string, unknown> | null;
  geometry?: unknown;
}

export type NativePickResolver = (feature: NativeFeature) => Selection | null;

const deckResolvers = new Map<string, DeckPickResolver>();
const nativeResolvers = new Map<string, NativePickResolver>();
const hitTesters = new Map<string, HitTester>();

/** Register a module's CPU hit-test (latest registration per id wins). */
export function registerHitTester(id: string, tester: HitTester): () => void {
  hitTesters.set(id, tester);
  return () => {
    if (hitTesters.get(id) === tester) hitTesters.delete(id);
  };
}

/** Ids of the registered CPU hit-testers (module ids): their deck layers need no GPU hover pick. */
export function hitTesterIds(): Set<string> {
  return new Set(hitTesters.keys());
}

/** Candidates from every registered hit-tester; a tester that throws (mid-update) simply misses. */
export function candidatesFromHitTesters(point: { x: number; y: number }, map: HitTestMap): PickCandidate[] {
  const out: PickCandidate[] = [];
  for (const t of hitTesters.values()) {
    try {
      out.push(...t(point, map));
    } catch {
      /* a layer mid-update is simply not hit this time */
    }
  }
  return out;
}

export function registerDeckPick(deckLayerId: string, resolver: DeckPickResolver): () => void {
  deckResolvers.set(deckLayerId, resolver);
  return () => {
    if (deckResolvers.get(deckLayerId) === resolver) deckResolvers.delete(deckLayerId);
  };
}

export function registerNativePick(styleLayerId: string, resolver: NativePickResolver): () => void {
  nativeResolvers.set(styleLayerId, resolver);
  return () => {
    if (nativeResolvers.get(styleLayerId) === resolver) nativeResolvers.delete(styleLayerId);
  };
}

/** Style layer ids with a native pick resolver (to scope `queryRenderedFeatures`). */
export function nativePickLayerIds(): string[] {
  return [...nativeResolvers.keys()];
}

function deckResolver(info: DeckPickInfo): DeckPickResolver | undefined {
  const layer = info.layer;
  if (!layer) return undefined;
  const own = layer.props.toSelection;
  if (typeof own === 'function') return own as DeckPickResolver;
  // Sub-layers of composite layers carry ids like `parent-icons`; fall back to the parent id.
  return deckResolvers.get(layer.id) ?? deckResolvers.get(layer.id.split('-')[0]!);
}

const candidate = (s: Selection | null): PickCandidate | null => (s ? { layer: s.layer ?? '', selection: s } : null);

/** Where the pointer is, and how the map projects a drawn position (for declared deck marks). */
export interface PointerAt {
  point: { x: number; y: number };
  project: HitTestMap['project'];
}

type PositionAccessor = (object: unknown, ctx: { index: number; data: unknown; target: number[] }) => unknown;

/**
 * A deck layer's declared mark (`pickMarkPx`, see the module doc) around the picked object's drawn
 * position (`getPosition`, the same accessor deck draws with, so an unwrapped antimeridian frame
 * projects to the copy on screen): distance from the pointer to its centre + its radius.
 */
function declaredMark(info: DeckPickInfo, at: PointerAt | undefined): Pick<PickCandidate, 'distancePx' | 'markRadiusPx'> | null {
  const props = info.layer?.props;
  const radius = props?.pickMarkPx;
  if (!at || !props || typeof radius !== 'number' || !(radius > 0)) return null;
  const get = props.getPosition;
  let pos: unknown;
  try {
    pos = typeof get === 'function' ? (get as PositionAccessor)(info.object, { index: info.index ?? -1, data: props.data, target: [] }) : get;
  } catch {
    return null;
  }
  if (!Array.isArray(pos) || typeof pos[0] !== 'number' || typeof pos[1] !== 'number') return null;
  const p = at.project([pos[0], pos[1]]);
  const d = Math.hypot(p.x - at.point.x, p.y - at.point.y);
  return Number.isFinite(d) ? { distancePx: d, markRadiusPx: radius } : null;
}

/**
 * Deck picks (top-most first, as `pickMultipleObjects` returns them) → candidates. With `at`, a
 * layer's declared mark (`pickMarkPx`) adds the pointer's distance to it and its radius.
 */
export function candidatesFromDeck(infos: readonly DeckPickInfo[], at?: PointerAt): PickCandidate[] {
  const out: PickCandidate[] = [];
  for (const info of infos) {
    if (info.object === undefined || info.object === null) continue;
    const c = candidate(deckResolver(info)?.(info) ?? null);
    if (!c) continue;
    const mark = declaredMark(info, at);
    out.push(mark ? { ...c, ...mark } : c);
  }
  return out;
}

/** Native features (top-most first, as `queryRenderedFeatures` returns them) → candidates. */
export function candidatesFromNative(features: readonly NativeFeature[]): PickCandidate[] {
  const out: PickCandidate[] = [];
  for (const f of features) {
    const c = candidate(nativeResolvers.get(f.layer.id)?.(f) ?? null);
    if (c) out.push(c);
  }
  return out;
}

/** The candidate's declared drawn mark covers the pointer (`distancePx` ≤ `markRadiusPx`). */
export function markContainsPointer(c: PickCandidate): boolean {
  return c.markRadiusPx !== undefined && c.distancePx !== undefined && c.distancePx <= c.markRadiusPx;
}

const priorityOf = (c: PickCandidate) => getLayer(c.layer)?.pickPriority ?? -1;

/**
 * The selection to open. A declared mark that covers the pointer wins first (the nearest such
 * mark, then the higher priority, then the top-most): round 8, the route's LHR dot under the
 * pointer lost to a matched aircraft ring drawn next to it (priority 100 against the airport's −1).
 * Otherwise the highest registry pickPriority wins (aircraft and cameras beat the satellites drawn
 * above them, points beat polygons); within that priority the nearest hit (`distancePx`,
 * GPU/native picks count as 0), then the first (top-most) candidate.
 */
export function routePick(candidates: readonly PickCandidate[]): Selection | null {
  let under: PickCandidate | null = null;
  for (const c of candidates) {
    if (!markContainsPointer(c)) continue;
    if (!under || c.distancePx! < under.distancePx! || (c.distancePx === under.distancePx && priorityOf(c) > priorityOf(under))) under = c;
  }
  if (under) return under.selection;
  const top = choosePick(candidates);
  if (!top) return null;
  const prio = priorityOf(top);
  let best = top;
  for (const c of candidates) {
    if (priorityOf(c) !== prio) continue;
    if ((c.distancePx ?? 0) < (best.distancePx ?? 0)) best = c;
  }
  return best.selection;
}

/** The map surface the host passes to `collectCandidates` (a MapLibre map satisfies it). */
export type PickMap = HitTestMap;

export interface CollectOptions {
  /** Hover: ask deck for the top object only (cheap); click: up to 10 stacked objects. */
  hover?: boolean;
  /** Far-side test (globe): candidates whose lngLat, lifted by their altitudeM, faces away from the camera are dropped. */
  facing?: (lngLat: [number, number], altitudeM: number) => boolean;
  radiusPx?: number;
}

/**
 * Everything selectable under the pointer: deck GPU picks, native rendered features and CPU
 * hit-tests, far-side filtered. Deck errors (overlay not initialised, context restoring) are
 * treated as "no deck hit".
 */
export function collectCandidates(map: PickMap, point: { x: number; y: number }, opts: CollectOptions = {}): PickCandidate[] {
  const radius = opts.radiusPx ?? 4;
  let deck: DeckPickInfo[] = [];
  if (opts.hover && hoverFeed) {
    // deck already ran its once-per-frame hover pick (autoHighlight): reuse it, no second GPU pick.
    deck = hoverInfo ? [hoverInfo] : [];
  } else if (overlay) {
    try {
      deck = opts.hover
        ? [overlay.pickObject({ x: point.x, y: point.y, radius })].filter((i): i is DeckPickInfo => !!i)
        : overlay.pickMultipleObjects({ x: point.x, y: point.y, radius, depth: 10 });
    } catch {
      deck = [];
    }
  }
  const ids = nativePickLayerIds().filter((id) => map.getLayer(id));
  let native: NativeFeature[] = [];
  if (ids.length) {
    try {
      native = map.queryRenderedFeatures([point.x, point.y], { layers: ids }) as NativeFeature[];
    } catch {
      native = [];
    }
  }
  const all = [...candidatesFromDeck(deck, { point, project: (ll) => map.project(ll) }), ...candidatesFromNative(native), ...candidatesFromHitTesters(point, map)];
  const facing = opts.facing;
  return facing ? all.filter((c) => !c.selection.lngLat || facing(c.selection.lngLat, c.altitudeM ?? 0)) : all;
}

/** The overlay's picking API, published by the deck host (DeckOverlay) for the click router. */
export interface PickOverlay {
  pickMultipleObjects: (opts: { x: number; y: number; radius?: number; depth?: number }) => DeckPickInfo[];
  pickObject: (opts: { x: number; y: number; radius?: number }) => DeckPickInfo | null;
}

let overlay: PickOverlay | null = null;

export function setPickOverlay(o: PickOverlay | null): void {
  overlay = o;
  if (!o) {
    hoverFeed = false;
    hoverInfo = null;
  }
}

let hoverFeed = false;
let hoverInfo: DeckPickInfo | null = null;

/**
 * deck's own hover result (its `onHover`), published by the deck host. While a feed is active the
 * hover path of `collectCandidates` reuses it instead of running a second GPU pick per frame.
 */
export function setDeckHoverInfo(info: DeckPickInfo | null): void {
  hoverFeed = true;
  hoverInfo = info && info.object !== undefined && info.object !== null ? info : null;
}

export function getPickOverlay(): PickOverlay | null {
  return overlay;
}

/** Test hook: forget every registration. */
export function resetPicking(): void {
  deckResolvers.clear();
  nativeResolvers.clear();
  hitTesters.clear();
  overlay = null;
  hoverFeed = false;
  hoverInfo = null;
  hoverPointer = false;
}

let hoverPointer = false;

/** The host's hover verdict ("something selectable under the pointer"), read by deck's getCursor. */
export function setHoverPointer(on: boolean): void {
  hoverPointer = on;
}

/** Cursor for the shared canvas: `pointer` over a selectable entity, else MapLibre's own (grab). */
export function hoverCursor(): string {
  return hoverPointer ? 'pointer' : '';
}
