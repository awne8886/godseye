/**
 * Which published deck layers are handed to deck.gl, and when (perf B2: shader-program links are
 * synchronous and each one can block the main thread for seconds on software GL).
 *  - A layer that has never been visible (`visible: false` since it was first published) is not
 *    instantiated at all: an instantiated layer links its program even with nothing to draw. Once
 *    it has been visible it stays instantiated (hidden) so toggling does not rebuild attributes.
 *  - Layer classes are admitted one per idle slot: the first layer of a class whose program has not
 *    been linked yet waits until the host admits its class, so several links never land in one
 *    task. Layers of admitted classes pass straight through.
 * Nothing is dropped or invented: a waiting layer is drawn as soon as its class is admitted.
 * Owner: map-engine. Pure and unit-tested.
 */

export interface AdmissionLayer {
  id: string;
  props: { visible?: boolean };
  constructor: unknown;
}

export interface AdmissionState {
  /** Layer ids that have been visible at least once. */
  seenVisible: Set<string>;
  /** Layer classes whose first instance has been handed to deck. */
  admitted: Set<string>;
}

export const createAdmissionState = (): AdmissionState => ({ seenVisible: new Set(), admitted: new Set() });

/** deck's static `layerName` (stable under minification), else the constructor name. */
export function layerClassKey(layer: AdmissionLayer): string {
  const ctor = layer.constructor as { layerName?: unknown; name?: unknown } | null;
  if (ctor && typeof ctor.layerName === 'string' && ctor.layerName) return ctor.layerName;
  return ctor && typeof ctor.name === 'string' && ctor.name ? ctor.name : 'Layer';
}

function isLayer(x: unknown): x is AdmissionLayer {
  return !!x && typeof x === 'object' && 'id' in x && 'props' in x;
}

/** Depth-first flatten of a deck LayersList (nested arrays and falsy entries allowed). */
export function flattenLayers<T>(list: readonly unknown[]): T[] {
  const out: T[] = [];
  const walk = (l: readonly unknown[]) => {
    for (const x of l) {
      if (Array.isArray(x)) walk(x);
      else if (isLayer(x)) out.push(x as T);
    }
  };
  walk(list);
  return out;
}

/**
 * Filter `layers` for deck. Mutates `state.seenVisible` (monotonic). Returns the layers to pass and
 * the classes still waiting for admission (first-seen order, no duplicates).
 */
export function admitLayers<T extends AdmissionLayer>(layers: readonly T[], state: AdmissionState): { pass: T[]; waiting: string[] } {
  const pass: T[] = [];
  const waiting: string[] = [];
  for (const layer of layers) {
    if (layer.props.visible !== false) state.seenVisible.add(layer.id);
    else if (!state.seenVisible.has(layer.id)) continue;
    const key = layerClassKey(layer);
    if (state.admitted.has(key)) pass.push(layer);
    else if (!waiting.includes(key)) waiting.push(key);
  }
  return { pass, waiting };
}

/**
 * Admission order for waiting classes (visual-qa R4-M1): classes needed by the user's own focus
 * layers (module Backgrounds: a planned route, drawn shapes) go before ambient data layers, in the
 * focus layers' own drawing order (`focusClassOrder`: a route's arc PathLayer before its endpoint
 * ScatterplotLayer, even when an ambient scatter layer was seen first); ambient classes keep their
 * first-seen order. Nothing is skipped; only the order changes.
 */
export function focusFirst(waiting: readonly string[], focusOrder: Iterable<string>): string[] {
  const focus = [...new Set(focusOrder)];
  return [...focus.filter((c) => waiting.includes(c)), ...waiting.filter((c) => !focus.includes(c))];
}

/** Same members in the same order. */
export function sameMembers<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Returns the previous array while the members do not change, else a copy of `next`. */
export function createStableArray<T>(): (next: readonly T[]) => T[] {
  let last: T[] = [];
  return (next) => {
    if (!sameMembers(last, next)) last = [...next];
    return last;
  };
}

export interface StableLists<L> {
  /**
   * `pass` with `beforeId` applied (one cached clone per source layer, dropped once that layer
   * leaves the list: deck never re-initialises a finalised layer). Returns the previous array when
   * the members did not change.
   */
  layers(pass: readonly L[], beforeId: string | undefined): L[];
  /** The previous array while the waiting classes do not change. */
  waiting(next: readonly string[]): string[];
  /** The previous array while the focus classes do not change. */
  focus(next: readonly string[]): string[];
}

/**
 * Identity-stable lists for the deck host. Any new layers array makes deck run a layer update and
 * request a map repaint; a module that republishes every frame (the route's comet, 15 Hz) — even
 * while its own class still waits for admission — then kept the globe repainting non-stop, so the
 * GPU never drained and every later admission slot ran into its deadline. Unchanged members now
 * produce the same array, and deck sees nothing new.
 */
export function createStableLists<L extends object>(applyBeforeId: (layer: L, beforeId: string) => L): StableLists<L> {
  const clones = new WeakMap<L, { beforeId: string; layer: L }>();
  let sources: readonly L[] = [];
  const stableLayers = createStableArray<L>();
  return {
    layers(pass, beforeId) {
      const keep = new Set(pass);
      for (const s of sources) if (!keep.has(s)) clones.delete(s);
      sources = [...pass];
      if (!beforeId) return stableLayers(pass);
      return stableLayers(
        pass.map((l) => {
          const c = clones.get(l);
          if (c && c.beforeId === beforeId) return c.layer;
          const layer = applyBeforeId(l, beforeId);
          clones.set(l, { beforeId, layer });
          return layer;
        }),
      );
    },
    waiting: createStableArray<string>(),
    focus: createStableArray<string>(),
  };
}
