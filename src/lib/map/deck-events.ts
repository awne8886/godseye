/**
 * deck.gl input gating for the interleaved overlay (R1-M1, perf round-5 m-h). In interleaved mode
 * deck attaches its own mjolnir EventManager to the shared MapLibre canvas:
 *  - its `pointerdown` handler runs a synchronous GPU pick (picking render + readPixels) on EVERY
 *    press — right-clicks, middle-clicks and drag starts included;
 *  - its `pointermove` handler queues a hover pick that deck runs in its next animation frame, so
 *    every frame the pointer moves cost a GPU pick (536 ms each on SwiftShader);
 *  - its click/drag dispatch re-uses or redoes those picks.
 * The map host owns click routing (`collectCandidates` → `routePick`, primary button only) and now
 * hover too: `detachDeckInput` unhooks all of deck's pointer input and neutralises the handlers
 * (an EventManager deck re-creates later registers no-ops), and the host feeds deck's hover through
 * a budget (`hover-pick.ts`) with `runDeckHoverPick`, which keeps `autoHighlight` and deck's
 * `onHover` working. Owner: map-engine. Pure and unit-tested.
 */

/** The part of mjolnir's EventManager this module touches. */
export interface DeckEventManagerLike {
  off: (event: string, handler: (e: never) => void) => void;
}

/** The part of a deck.gl `Deck` instance this module touches (private fields). */
export interface DeckLike {
  eventManager?: DeckEventManagerLike | null;
  /** deck's (protected) LayerManager: `updateLayers()` initialises layers handed over by setProps. */
  layerManager?: { updateLayers?: () => void } | null;
  isInitialized?: boolean;
  _onPointerDown?: (e: never) => void;
  _onPointerMove?: (e: never) => void;
  _onEvent?: (e: never) => void;
  /** Runs the queued hover pick (deck calls it once per animation frame). */
  _pickAndCallback?: () => void;
  /** Builds the options of that pick (`layerIds` there scopes it: deck's `layerManager.getLayers`). */
  _getPointPickOptions?: (...args: never[]) => object;
}

/** deck's EVENT_HANDLERS (click/dblclick/pan*) — all dispatched through `_onEvent`. */
export const DECK_GESTURE_EVENTS = ['click', 'dblclick', 'panstart', 'panmove', 'panend'] as const;

const noop = () => undefined;
/** deck's own hover handler per deck, kept for the host's budgeted hover picks. */
const hoverHandlers = new WeakMap<object, (e: never) => void>();

/**
 * Remove deck's pointer input from its EventManager — press pick, hover pick, click/drag dispatch —
 * and replace the handlers with no-ops. Idempotent. Returns false when the deck has no
 * EventManager yet (the no-ops are in place already; call again from `onLoad`).
 */
export function detachDeckInput(deck: DeckLike | null | undefined): boolean {
  if (!deck) return false;
  if (deck._onPointerMove && deck._onPointerMove !== noop && !hoverHandlers.has(deck)) hoverHandlers.set(deck, deck._onPointerMove);
  const em = deck.eventManager;
  if (em) {
    if (deck._onPointerDown) em.off('pointerdown', deck._onPointerDown);
    if (deck._onPointerMove) {
      em.off('pointermove', deck._onPointerMove);
      em.off('pointerleave', deck._onPointerMove);
    }
    if (deck._onEvent) for (const t of DECK_GESTURE_EVENTS) em.off(t, deck._onEvent);
  }
  deck._onPointerDown = noop;
  deck._onPointerMove = noop;
  deck._onEvent = noop;
  return !!em;
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Hand deck's own hover handler one event; false when deck is not ready for it. */
function hoverEvent(deck: DeckLike, event: object): boolean {
  const handler = hoverHandlers.get(deck);
  if (!handler || !deck.isInitialized) return false;
  handler(event as never);
  return true;
}

/**
 * Scope deck's next point pick to `layerIds` (deck matches them as id prefixes, so sub-layers
 * follow their parent): an own `_getPointPickOptions` that adds them, removed again by the returned
 * function. Unscoped (null) or a deck without the hook: a no-op.
 */
function scopePick(deck: DeckLike, layerIds: readonly string[] | null | undefined): () => void {
  const base = deck._getPointPickOptions;
  if (!layerIds || typeof base !== 'function') return () => undefined;
  const own = Object.prototype.hasOwnProperty.call(deck, '_getPointPickOptions');
  const ids = [...layerIds];
  deck._getPointPickOptions = function (this: unknown, ...args: never[]) {
    return { ...base.apply(this, args), layerIds: ids };
  };
  return () => {
    if (own) deck._getPointPickOptions = base;
    else delete deck._getPointPickOptions;
  };
}

/**
 * One deck hover pick at (x, y), run now (deck's `onHover` and `autoHighlight` follow it). Returns
 * the time it took in ms (0 when deck is not ready). `layerIds` limits the GPU pick to those deck
 * layers (the ones no CPU hit-tester covers: `gpuHoverLayerIds`); an empty list runs no pick at all.
 */
export function runDeckHoverPick(
  deck: DeckLike | null | undefined,
  x: number,
  y: number,
  srcEvent?: unknown,
  layerIds?: readonly string[] | null,
): number {
  if (!deck || (layerIds && layerIds.length === 0)) return 0;
  const t0 = nowMs();
  const unscope = scopePick(deck, layerIds);
  try {
    if (!hoverEvent(deck, { type: 'pointermove', offsetCenter: { x, y }, srcEvent })) return 0;
    // Run it now (timed) instead of in deck's next frame, which then finds nothing queued.
    deck._pickAndCallback?.();
  } catch {
    // A lost context or a deck mid-teardown: no hover this time (the cost still counts).
  } finally {
    unscope();
  }
  return nowMs() - t0;
}

/** The part of a published deck entry `gpuHoverLayerIds` reads. */
export interface HoverScopeEntry {
  layers: unknown;
}

function collectPickable(list: unknown, out: string[], highlightOnly: boolean): void {
  if (Array.isArray(list)) {
    for (const x of list) collectPickable(x, out, highlightOnly);
    return;
  }
  if (!list || typeof list !== 'object' || !('id' in list) || !('props' in list)) return;
  const { id, props } = list as {
    id: unknown;
    props: { pickable?: unknown; visible?: unknown; autoHighlight?: unknown } | null;
  };
  if (typeof id !== 'string' || !props || !props.pickable || props.visible === false) return;
  if (highlightOnly && props.autoHighlight !== true) return;
  out.push(id);
}

/**
 * Deck layers the GPU hover pick still has to cover (perf L96): the visible, pickable layers of
 * every published entry whose module has no CPU hit-tester. An entry key is `<module>` or
 * `<module>:<part>`; a hit-tester registered under `<module>` resolves that module's hover on the
 * CPU (projected positions), so its layers are left out of the picking render — except layers
 * with `autoHighlight: true`: deck highlights only an object its own hover pick found, so those
 * stay in the GPU scope or their highlight would never show.
 */
export function gpuHoverLayerIds(entries: Readonly<Record<string, HoverScopeEntry>>, cpuCovered: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    const covered = cpuCovered.has(key) || cpuCovered.has(key.split(':')[0]!);
    collectPickable(entry.layers, out, covered);
  }
  return out;
}

/** The pointer left the map: clear deck's hover (and highlight) state. */
export function runDeckHoverLeave(deck: DeckLike | null | undefined): void {
  if (!deck) return;
  try {
    if (hoverEvent(deck, { type: 'pointerleave', offsetCenter: null })) deck._pickAndCallback?.();
  } catch {
    // Context lost or deck finalised: nothing to clear.
  }
}

/** Only an unmodified primary-button click (or a tap, which browsers report as button 0) picks. */
export function isPrimaryClick(e: { button?: number } | null | undefined): boolean {
  return !!e && (e.button ?? 0) === 0;
}

/**
 * A map tool (DRAW, measure…) is armed: it marks the map container with `data-map-tool` while it
 * owns the pointer (src/components/panels/draw/map-capture.ts). Hover picks and selections yield.
 */
export function mapToolArmed(container: { dataset: DOMStringMap } | null | undefined): boolean {
  return !!container?.dataset.mapTool;
}

/** Hover picking is skipped while any button is held (drag, rotate, right-press). */
export function hoverAllowed(e: { buttons?: number } | null | undefined): boolean {
  return !e || !e.buttons;
}

/**
 * Initialise the layers just handed to deck (`setProps`) now instead of in deck's next animation
 * frame, so the program links they need run inside the current (GPU-drained) task rather than
 * behind the map frame queued meanwhile. A no-op before deck has initialised.
 */
export function initPendingLayers(deck: DeckLike | null | undefined): void {
  deck?.layerManager?.updateLayers?.();
}

/**
 * WebGL features luma tests on every program link (`compilation-status-async-webgl`) and every
 * draw (`shader-clip-cull-distance-webgl`, in its parameter setter). The overlay's device tests
 * features lazily (`_initializeFeatures: false`, instead of ~20 extension queries at attach); left
 * lazy, these two were first asked at the route's first draw — a synchronous round trip behind the
 * queued globe frames, 0.5–1.4 s on SwiftShader, on the critical path.
 */
export const LINK_DRAW_FEATURES = ['compilation-status-async-webgl', 'shader-clip-cull-distance-webgl'] as const;

/** The part of a luma `Device` this module touches. */
export interface FeatureDevice {
  features?: { has(feature: string): boolean } | null;
}

/**
 * Ask for LINK_DRAW_FEATURES once, right after the device was created (deck's
 * `onDeviceInitialized`): the device's own set-up queries have just let the GPU process catch up, so
 * each answer is immediate, and luma caches it for every later link and draw.
 */
export function primeLinkDrawFeatures(device: FeatureDevice | null | undefined): void {
  const features = device?.features;
  if (!features || typeof features.has !== 'function') return;
  for (const name of LINK_DRAW_FEATURES) {
    try {
      features.has(name);
    } catch {
      // A lost context answers on first use instead; nothing to prime.
    }
  }
}
