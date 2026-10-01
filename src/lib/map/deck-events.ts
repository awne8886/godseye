/**
 * deck.gl input gating for the interleaved overlay (R1-M1). In interleaved mode deck attaches its
 * own mjolnir EventManager to the shared MapLibre canvas, and its `pointerdown` handler runs a
 * synchronous GPU pick (picking render + readPixels) on EVERY press — right-clicks, middle-clicks
 * and drag starts included. The map host already owns click routing (`collectCandidates` →
 * `routePick`, primary button only), so deck's own press/click/drag picking is pure cost: it is
 * detached here. deck's hover picking (`pointermove`, at most once per animation frame and
 * skipped while a button is held) stays, because layers use `autoHighlight`.
 * Owner: map-engine. Pure and unit-tested.
 */

/** The part of mjolnir's EventManager this module touches. */
export interface DeckEventManagerLike {
  off: (event: string, handler: (e: never) => void) => void;
}

/** The part of a deck.gl `Deck` instance this module touches (private fields, read-only). */
export interface DeckLike {
  eventManager?: DeckEventManagerLike | null;
  /** deck's (protected) LayerManager: `updateLayers()` initialises layers handed over by setProps. */
  layerManager?: { updateLayers?: () => void } | null;
  _onPointerDown?: (e: never) => void;
  _onEvent?: (e: never) => void;
}

/** deck's EVENT_HANDLERS (click/dblclick/pan*) — all dispatched through `_onEvent`. */
export const DECK_GESTURE_EVENTS = ['click', 'dblclick', 'panstart', 'panmove', 'panend'] as const;

/**
 * Remove deck's pointerdown pick and its click/drag dispatch from its EventManager. Idempotent;
 * returns false when the deck has no EventManager yet (call again from `onLoad`).
 */
export function detachDeckPressPicking(deck: DeckLike | null | undefined): boolean {
  const em = deck?.eventManager;
  if (!deck || !em) return false;
  if (deck._onPointerDown) em.off('pointerdown', deck._onPointerDown);
  if (deck._onEvent) for (const t of DECK_GESTURE_EVENTS) em.off(t, deck._onEvent);
  return true;
}

/** Only an unmodified primary-button click (or a tap, which browsers report as button 0) picks. */
export function isPrimaryClick(e: { button?: number } | null | undefined): boolean {
  return !!e && (e.button ?? 0) === 0;
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
