import { afterEach, describe, expect, it } from 'vitest';
import { DECK_GESTURE_EVENTS, detachDeckPressPicking, hoverAllowed, isPrimaryClick } from './deck-events';
import { collectCandidates, resetPicking, setDeckHoverInfo, setPickOverlay, type PickMap } from './picking';

type Handler = (e: never) => void;

/** mjolnir-like registry: `events` from the constructor plus on/off, dispatch by type. */
class FakeEventManager {
  handlers = new Map<string, Set<Handler>>();
  constructor(events: Record<string, Handler>) {
    for (const [t, h] of Object.entries(events)) this.on(t, h);
  }
  on(t: string, h: Handler) {
    if (!this.handlers.has(t)) this.handlers.set(t, new Set());
    this.handlers.get(t)!.add(h);
  }
  off(t: string, h: Handler) {
    this.handlers.get(t)?.delete(h);
  }
  dispatch(t: string, e: object) {
    for (const h of this.handlers.get(t) ?? []) (h as (e: object) => void)(e);
  }
}

/** A deck stand-in wired like Deck._createEventManager: every press and click picks on the GPU. */
function fakeDeck() {
  const picks: string[] = [];
  const deck = {
    _onPointerDown: (() => picks.push('pointerdown')) as Handler,
    _onPointerMove: (() => picks.push('hover')) as Handler,
    _onEvent: ((e: { type: string }) => picks.push(e.type)) as unknown as Handler,
    eventManager: null as FakeEventManager | null,
  };
  deck.eventManager = new FakeEventManager({ pointerdown: deck._onPointerDown, pointermove: deck._onPointerMove, pointerleave: deck._onPointerMove });
  for (const t of DECK_GESTURE_EVENTS) deck.eventManager.on(t, deck._onEvent);
  return { deck, picks };
}

const MAP: PickMap = {
  project: () => ({ x: 0, y: 0 }),
  unproject: () => ({ lng: 0, lat: 0, wrap: () => ({ lng: 0, lat: 0 }) }),
  getZoom: () => 3,
  getCenter: () => ({ lng: 0, lat: 0 }),
  getLayer: () => undefined,
  queryRenderedFeatures: () => [],
};

afterEach(() => resetPicking());

describe('deck press picking (R1-M1)', () => {
  it('without the fix every right-click runs a deck pick (the regression this guards)', () => {
    const { deck, picks } = fakeDeck();
    deck.eventManager!.dispatch('pointerdown', { srcEvent: { button: 2 } });
    expect(picks).toEqual(['pointerdown']);
  });

  it('after detaching, right-clicks, middle-clicks, presses and drags produce zero deck picks', () => {
    const { deck, picks } = fakeDeck();
    expect(detachDeckPressPicking(deck)).toBe(true);
    for (const button of [0, 1, 2]) {
      deck.eventManager!.dispatch('pointerdown', { srcEvent: { button } });
      deck.eventManager!.dispatch('click', { type: 'click', srcEvent: { button } });
    }
    for (const t of ['panstart', 'panmove', 'panend', 'dblclick']) deck.eventManager!.dispatch(t, { type: t });
    expect(picks).toEqual([]);
  });

  it('keeps deck hover (autoHighlight) wired', () => {
    const { deck, picks } = fakeDeck();
    detachDeckPressPicking(deck);
    deck.eventManager!.dispatch('pointermove', {});
    expect(picks).toEqual(['hover']);
  });

  it('is idempotent and waits for the EventManager (called again from onLoad)', () => {
    expect(detachDeckPressPicking({ eventManager: null })).toBe(false);
    expect(detachDeckPressPicking(undefined)).toBe(false);
    const { deck } = fakeDeck();
    expect(detachDeckPressPicking(deck)).toBe(true);
    expect(detachDeckPressPicking(deck)).toBe(true);
  });
});

describe('host click gating', () => {
  it('only the primary button routes a pick', () => {
    expect(isPrimaryClick({ button: 0 })).toBe(true);
    expect(isPrimaryClick({})).toBe(true);
    expect(isPrimaryClick({ button: 1 })).toBe(false);
    expect(isPrimaryClick({ button: 2 })).toBe(false);
    expect(isPrimaryClick(null)).toBe(false);
  });

  it('a right-click pair through the host router picks nothing on the GPU', () => {
    let gpu = 0;
    setPickOverlay({
      pickMultipleObjects: () => {
        gpu++;
        return [];
      },
      pickObject: () => {
        gpu++;
        return null;
      },
    });
    const route = (e: { button: number }) => (isPrimaryClick(e) ? collectCandidates(MAP, { x: 1, y: 1 }) : null);
    route({ button: 2 });
    route({ button: 2 });
    expect(gpu).toBe(0);
    route({ button: 0 });
    expect(gpu).toBe(1);
  });

  it('hover reuses deck’s own hover pick instead of a second GPU pick, and never runs while a button is held', () => {
    let gpu = 0;
    setPickOverlay({
      pickMultipleObjects: () => [],
      pickObject: () => {
        gpu++;
        return null;
      },
    });
    collectCandidates(MAP, { x: 1, y: 1 }, { hover: true });
    expect(gpu).toBe(1);
    setDeckHoverInfo(null);
    collectCandidates(MAP, { x: 1, y: 1 }, { hover: true });
    expect(gpu).toBe(1);
    expect(hoverAllowed({ buttons: 0 })).toBe(true);
    expect(hoverAllowed({ buttons: 2 })).toBe(false);
  });
});
