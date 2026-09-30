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
