/**
 * Click/hover arbitration between deck.gl layers and native MapLibre layers (§4). Everything
 * under the pointer becomes a candidate; `choosePick()` (registry `pickPriority`, ties → the
 * top-most candidate) picks the one whose card opens via `useSelectionStore.select()`.
 *
 * How feature modules opt in:
 *  - deck layers: pass a `toSelection(info)` prop on the layer, or `registerDeckPick(layerId, fn)`;
 *  - native layers: `registerNativePick(styleLayerId, fn)` (returns an unregister function).
 * A resolver returns a Selection (kind, id, registry layer, source, observedAt, data, lngLat) or
 * null for "not selectable". Owner: map-engine. Pure and unit-tested.
 */
import type { Selection } from '@/lib/layer-host';
import { choosePick } from '@/lib/layer-registry';

export interface PickCandidate {
  layer: string;
  selection: Selection;
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
 * satellites drawn above them, points beat polygons); on a tie the first (top-most) candidate.
 */
export function routePick(candidates: readonly PickCandidate[]): Selection | null {
  return choosePick(candidates)?.selection ?? null;
}

/** The overlay's picking API, published by the deck host (DeckOverlay) for the click router. */
export interface PickOverlay {
  pickMultipleObjects: (opts: { x: number; y: number; radius?: number; depth?: number }) => DeckPickInfo[];
  pickObject: (opts: { x: number; y: number; radius?: number }) => DeckPickInfo | null;
}

let overlay: PickOverlay | null = null;

export function setPickOverlay(o: PickOverlay | null): void {
  overlay = o;
}

export function getPickOverlay(): PickOverlay | null {
  return overlay;
}

/** Test hook: forget every registration. */
export function resetPicking(): void {
  deckResolvers.clear();
  nativeResolvers.clear();
  overlay = null;
}
