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
 * Owner: map-engine. Pure and unit-tested.
 */
import type { Selection } from '@/lib/layer-host';
import { choosePick, getLayer } from '@/lib/layer-registry';

export interface PickCandidate {
  layer: string;
  selection: Selection;
  /** Screen distance from the pointer in px (CPU hit-tests); breaks ties within one priority. */
  distancePx?: number;
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

/** Deck picks (top-most first, as `pickMultipleObjects` returns them) → candidates. */
export function candidatesFromDeck(infos: readonly DeckPickInfo[]): PickCandidate[] {
  const out: PickCandidate[] = [];
  for (const info of infos) {
    if (info.object === undefined || info.object === null) continue;
    const c = candidate(deckResolver(info)?.(info) ?? null);
    if (c) out.push(c);
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

/**
 * The selection to open: highest registry pickPriority wins (aircraft and cameras beat the
 * satellites drawn above them, points beat polygons); within that priority the nearest hit
 * (`distancePx`, GPU/native picks count as 0), then the first (top-most) candidate.
 */
export function routePick(candidates: readonly PickCandidate[]): Selection | null {
  const top = choosePick(candidates);
  if (!top) return null;
  const prio = getLayer(top.layer)?.pickPriority ?? -1;
  let best = top;
  for (const c of candidates) {
    if ((getLayer(c.layer)?.pickPriority ?? -1) !== prio) continue;
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
  const all = [...candidatesFromDeck(deck), ...candidatesFromNative(native), ...candidatesFromHitTesters(point, map)];
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
