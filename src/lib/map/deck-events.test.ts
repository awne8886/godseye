import { afterEach, describe, expect, it } from 'vitest';
import {
  DECK_GESTURE_EVENTS,
  type DeckLike,
  detachDeckInput,
  hoverAllowed,
  isPrimaryClick,
  LINK_DRAW_FEATURES,
  primeLinkDrawFeatures,
  runDeckHoverLeave,
  runDeckHoverPick,
} from './deck-events';
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

/**
 * A deck stand-in wired like Deck._createEventManager: every press picks on the GPU, a pointer move
 * queues a hover pick that `_pickAndCallback` (deck's per-frame step) runs.
 */
function fakeDeck() {
  const picks: string[] = [];
  let queued: { type: string; offsetCenter: { x: number; y: number } | null } | null = null;
  const deck = {
    isInitialized: true,
    _onPointerDown: (() => picks.push('pointerdown')) as Handler,
    _onPointerMove: ((e: { type: string; offsetCenter: { x: number; y: number } | null }) => void (queued = e)) as unknown as Handler,
    _onEvent: ((e: { type: string }) => picks.push(e.type)) as unknown as Handler,
    _pickAndCallback: () => {
      if (!queued) return;
      picks.push(queued.type === 'pointerleave' ? 'leave' : `hover@${queued.offsetCenter!.x},${queued.offsetCenter!.y}`);
      queued = null;
    },
    eventManager: null as FakeEventManager | null,
  };
  const createEventManager = () => {
    deck.eventManager = new FakeEventManager({ pointerdown: deck._onPointerDown, pointermove: deck._onPointerMove, pointerleave: deck._onPointerMove });
    for (const t of DECK_GESTURE_EVENTS) deck.eventManager.on(t, deck._onEvent);
  };
  createEventManager();
  /** deck's animation frame. */
  const frame = () => deck._pickAndCallback();
  return { deck, picks, frame, createEventManager };
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
    const { deck, picks, frame } = fakeDeck();
    expect(detachDeckInput(deck)).toBe(true);
    for (const button of [0, 1, 2]) {
      deck.eventManager!.dispatch('pointerdown', { srcEvent: { button } });
      deck.eventManager!.dispatch('click', { type: 'click', srcEvent: { button } });
    }
    for (const t of ['panstart', 'panmove', 'panend', 'dblclick']) deck.eventManager!.dispatch(t, { type: t });
    frame();
    expect(picks).toEqual([]);
  });

  it('is idempotent and waits for the EventManager (called again from onLoad)', () => {
    expect(detachDeckInput({ eventManager: null })).toBe(false);
    expect(detachDeckInput(undefined)).toBe(false);
    const { deck } = fakeDeck();
    expect(detachDeckInput(deck)).toBe(true);
    expect(detachDeckInput(deck)).toBe(true);
  });
});

describe('deck hover picking is the host’s (perf round-5 m-h)', () => {
  it('without the fix every pointer move queues a GPU hover pick for the next frame (the regression this guards)', () => {
    const { deck, picks, frame } = fakeDeck();
    for (let i = 0; i < 5; i++) {
      deck.eventManager!.dispatch('pointermove', { type: 'pointermove', offsetCenter: { x: i, y: i } });
      frame();
    }
    expect(picks.length).toBe(5);
  });

  it('after detaching, pointer moves (and leaves) queue nothing; frames pick nothing', () => {
    const { deck, picks, frame } = fakeDeck();
    detachDeckInput(deck);
    for (let i = 0; i < 5; i++) {
      deck.eventManager!.dispatch('pointermove', { type: 'pointermove', offsetCenter: { x: i, y: i } });
      frame();
    }
    deck.eventManager!.dispatch('pointerleave', { type: 'pointerleave', offsetCenter: null });
    frame();
    expect(picks).toEqual([]);
  });

  it('an EventManager deck re-creates later registers the no-ops (detached before it existed, or re-created)', () => {
    const { deck, picks, frame, createEventManager } = fakeDeck();
    detachDeckInput(deck);
    createEventManager();
    deck.eventManager!.dispatch('pointerdown', { srcEvent: { button: 2 } });
    deck.eventManager!.dispatch('pointermove', { type: 'pointermove', offsetCenter: { x: 1, y: 1 } });
    deck.eventManager!.dispatch('click', { type: 'click' });
    frame();
    expect(picks).toEqual([]);
  });

  it('runDeckHoverPick drives deck’s own hover handler and runs the pick now, timed', () => {
    const { deck, picks, frame } = fakeDeck();
    detachDeckInput(deck);
    expect(runDeckHoverPick(deck, 12, 34)).toBeGreaterThanOrEqual(0);
    expect(picks).toEqual(['hover@12,34']);
    frame(); // deck's next frame finds nothing queued: one pick, not two
    expect(picks).toEqual(['hover@12,34']);
    runDeckHoverLeave(deck);
    expect(picks).toEqual(['hover@12,34', 'leave']);
  });

  it('does nothing before deck is initialised, after a failed pick, or without a deck', () => {
    const { deck, picks } = fakeDeck();
    detachDeckInput(deck);
    deck.isInitialized = false;
    expect(runDeckHoverPick(deck, 1, 1)).toBe(0);
    runDeckHoverLeave(deck);
    expect(picks).toEqual([]);
    expect(runDeckHoverPick(null, 1, 1)).toBe(0);
    const throwing: DeckLike = { isInitialized: true, _onPointerMove: () => undefined, _pickAndCallback: () => { throw new Error('context lost'); } };
    detachDeckInput(throwing);
    expect(() => runDeckHoverPick(throwing, 1, 1)).not.toThrow();
    expect(() => runDeckHoverLeave(throwing)).not.toThrow();
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

describe('device feature priming (CI globe first draw)', () => {
  it('asks the link/draw features once right after device creation, and tolerates a missing or failing device', () => {
    const asked: string[] = [];
    primeLinkDrawFeatures({ features: { has: (f) => (asked.push(f), true) } });
    expect(asked).toEqual([...LINK_DRAW_FEATURES]);
    expect(asked).toEqual(['compilation-status-async-webgl', 'shader-clip-cull-distance-webgl']);
    expect(() => primeLinkDrawFeatures(null)).not.toThrow();
    expect(() => primeLinkDrawFeatures({ features: null })).not.toThrow();
    const lost = {
      has: (): boolean => {
        throw new Error('context lost');
      },
    };
    expect(() => primeLinkDrawFeatures({ features: lost })).not.toThrow();
  });
});
