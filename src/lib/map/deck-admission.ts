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
