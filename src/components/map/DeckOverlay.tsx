'use client';
/**
 * The single interleaved deck.gl overlay (§3). Layers come from feature modules through
 * useDeckLayerStore; every layer without its own beforeId is inserted under the basemap labels.
 * Workarounds: `_reuseDevices` for React StrictMode (#10681), re-apply layers after the first
 * `idle` for the beforeId ordering regression (#10733). Entries are ordered by registry z
 * (`orderedDeckLayers`). The overlay's picking API is published for the click router
 * (src/lib/map/picking.ts).
 *
 * Input (R1-M1, perf round-5 m-h): deck's own pointer input (press pick, per-frame hover pick,
 * click/drag dispatch) is detached (`detachDeckInput`); clicks are routed by the map host only
 * (primary button), so right-clicks and drags never run a GPU pick. Hover picks are requested here
 * through a budget (`createHoverPickGate`: none while a button is held or the camera moves, ≤ 10 Hz
 * and ≤ 25 % of the main thread while the pointer moves, one more where it comes to rest); their
 * result feeds autoHighlight and is reused by the host's hover cursor instead of a second pick.
 *
 * Startup cost (perf B2): layers that were never visible are not instantiated and new layer
 * classes are admitted one per slot of the map's admission scheduler (`admitLayers` +
 * `admission-scheduler.ts`: idle main thread, then a drained GPU queue, at most
 * ADMISSION_MAX_WAIT_MS apart), so each program link runs alone. The admission is a transition
 * render (time-sliced), never `flushSync`.
 *
 * Layer groups (R3-M2): every `setProps` runs under `withParsedStyle`, so deck's layer groups enter
 * the style as soon as it is parsed instead of waiting for `isStyleLoaded()` (false while any tile
 * loads; a hung tile kept every deck layer off the globe). Groups still missing are re-applied on
 * the next style/source/idle event and on a short backoff timer (`idle` may never come while tiles
 * keep retrying), and published as undrawn, so the header never counts them.
 *
 * Focus first (visual-qa R4-M1, CI globe first draw): classes needed by module Backgrounds (the
 * planned route or tracked flight's arc, drawn shapes: what the user asked for) are admitted before ambient data-layer
 * classes, in the focus layers' own drawing order (the route's arc first), the first of them ahead
 * of the data-module mount, each with a short wait for a quiet slot (`focus.ts`).
 *
 * Stable lists: the arrays handed to deck keep their identity while their members do not change
 * (`createStableLists`), so a module republishing every frame (the route comet) does not make deck
 * update and repaint the globe while its own class still waits — that kept a software GPU busy
 * non-stop and every admission slot ran into its deadline.
 *
 * Device: `_initializeFeatures: false` makes luma test WebGL features on first use instead of
 * querying ~20 extensions at attach, each a synchronous round trip (1.5–3.4 s in total at the
 * device attach measured on SwiftShader under load); the two it asks on every link/draw are primed
 * at `onDeviceInitialized` (`primeLinkDrawFeatures`). Owner: map-engine.
 */
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { Layer, LayersList, PickingInfo } from '@deck.gl/core';
import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { useControl, useMap } from 'react-map-gl/maplibre';
import { orderedDeckLayers, useDeckLayerStore, useMapInstanceStore } from '@/lib/layer-host';
import { FEATURE_MODULES } from '@/features/registry';
import { admitLayers, createAdmissionState, createStableLists, flattenLayers, focusFirst } from '@/lib/map/deck-admission';
import { useAdmissionStore } from '@/lib/map/admission-scheduler';
import { type ApplyMap, missingDeckGroups, withParsedStyle } from '@/lib/map/deck-apply';
import {
  type DeckLike,
  detachDeckInput,
  type FeatureDevice,
  hoverAllowed,
  initPendingLayers,
  primeLinkDrawFeatures,
  runDeckHoverLeave,
  runDeckHoverPick,
} from '@/lib/map/deck-events';
import { deckClassMaxWait, deckClassPriority, focusClassOrder, focusKeysOf, registerFocusKeys } from '@/lib/map/focus';
import { createHoverPickGate } from '@/lib/map/hover-pick';
import { type DeckPickInfo, hoverCursor, type PickOverlay, setDeckHoverInfo, setPickOverlay } from '@/lib/map/picking';

/** `beforeId` is a MapLibreOverlay-specific layer prop (not in deck's LayerProps typings). */
type WithBeforeId = { beforeId?: string };

const applyBeforeId = (layer: Layer, beforeId: string): Layer =>
  (layer.props as WithBeforeId).beforeId ? layer : layer.clone({ beforeId } as Partial<Layer['props']> & WithBeforeId);

// Deck entries published by module Backgrounds (keyed by module id; flight-paths, panels-recon): the focus layers.
registerFocusKeys(focusKeysOf(FEATURE_MODULES));

const createLists = () => createStableLists<Layer>(applyBeforeId);

/** Re-apply delays while deck groups are still missing from the style (ms after each apply). */
const HEAL_BACKOFF_MS = [50, 100, 200, 400, 800, 1600, 3200];

/** The overlay's Deck instance (a private field; read-only use). */
const deckOf = (o: MapLibreOverlay | undefined): DeckLike | undefined => (o as unknown as { _deck?: DeckLike } | undefined)?._deck;

/** The map the overlay was added to (a private field, set in `onAdd`; read-only use). */
const mapOfOverlay = (o: MapLibreOverlay): ApplyMap | null => (o as unknown as { _map?: ApplyMap })._map ?? null;

export default function DeckOverlay({ beforeId }: { beforeId?: string }) {
  const entries = useDeckLayerStore((s) => s.entries);
  const ready = useMapInstanceStore((s) => s.ready);
  const [admission] = useState(createAdmissionState);
  const [lists] = useState(createLists);
  const [admittedVersion, setAdmittedVersion] = useState(0);

  const { layers, waiting, focus } = useMemo(() => {
    const all = flattenLayers<Layer>(orderedDeckLayers(entries) as unknown[]);
    const r = admitLayers(all, admission);
    const focus = lists.focus(focusClassOrder(entries));
    return { layers: lists.layers(r.pass, beforeId), waiting: lists.waiting(focusFirst(r.waiting, focus)), focus };
    // `admittedVersion` re-runs admission when a class was admitted.
  }, [entries, admittedVersion, beforeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const { current: mapRef } = useMap();
  /** The last hover pick found something (its highlight must be cleared when the pointer leaves). */
  const hoverHit = useRef(false);

  const overlay = useControl(() => {
    const box: { overlay?: MapLibreOverlay } = {};
    box.overlay = new MapLibreOverlay({
      interleaved: true,
      layers: [],
      deviceProps: { _reuseDevices: true, _initializeFeatures: false } as never,
      // The two features luma asks on every link/draw: answered now, not at the route's first draw.
      onDeviceInitialized: (device) => primeLinkDrawFeatures(device as unknown as FeatureDevice),
      // deck writes the canvas cursor every frame: follow the host's hover verdict, else MapLibre's.
      getCursor: hoverCursor,
      onHover: (info: PickingInfo) => {
        hoverHit.current = info.object !== undefined && info.object !== null;
        setDeckHoverInfo(info as unknown as DeckPickInfo);
      },
      // The EventManager exists from onLoad on: detach deck's own pointer input there (again).
      onLoad: () => detachDeckInput(deckOf(box.overlay)),
    });
    return box.overlay;
  });
  const layersRef = useRef<LayersList>(layers);
  const beforeIdRef = useRef(beforeId);
  /** The list last handed to deck (an identical list needs no new `setProps`). */
  const appliedRef = useRef<LayersList | null>(null);
  /** Hand deck `next` (groups added once the style is parsed) and publish what is still off the map. */
  const healTimer = useRef<{ id: ReturnType<typeof setTimeout> | null; step: number }>({ id: null, step: 0 });
  const applyRef = useRef((next: LayersList) => {
    const map = mapOfOverlay(overlay);
    appliedRef.current = next;
    withParsedStyle(map, () => overlay.setProps({ layers: next }));
    const missing = missingDeckGroups(map, flattenLayers<Layer>(next as unknown[])).length;
    useAdmissionStore.getState().setUndrawn('deck', missing);
    // Groups still missing (style not parsed yet, or a style swap): try again shortly, with backoff,
    // instead of waiting for an `idle` that failing tile retries can postpone indefinitely.
    const h = healTimer.current;
    if (h.id !== null) clearTimeout(h.id);
    h.id = null;
    if (!missing) h.step = 0;
    else if (h.step < HEAL_BACKOFF_MS.length) {
      h.id = setTimeout(() => {
        h.id = null;
        applyRef.current(layersRef.current);
      }, HEAL_BACKOFF_MS[h.step++]);
    }
    const el = (map as { getContainer?: () => HTMLElement } | null)?.getContainer?.();
    if (el) {
      // Diagnostics for e2e: deck layers handed over, groups still missing from the style, and the
      // layer classes admitted so far (in admission order).
      el.dataset.deckLayers = String((next as unknown[]).length);
      el.dataset.deckUndrawn = String(missing);
      el.dataset.deckClasses = [...admission.admitted].join(',');
    }
  });
  useEffect(() => {
    layersRef.current = layers;
    beforeIdRef.current = beforeId;
    // Already handed over (by the admission slot): nothing new for deck.
    if (layers !== appliedRef.current) applyRef.current(layers);
  }, [overlay, layers, beforeId]);
  // Waiting layer classes are admitted one per scheduler slot.
  const scheduler = useAdmissionStore((s) => s.scheduler);
  const waitingRef = useRef<string[]>([]);
  const focusRef = useRef<string[]>([]);
  useEffect(() => {
    waitingRef.current = waiting;
    focusRef.current = focus;
    scheduler?.kick();
  }, [waiting, focus, scheduler]);
  useEffect(() => {
    if (!scheduler) return;
    return scheduler.register({
      id: 'deck-classes',
      // The first focus class (the route's arc) before the data modules mount, further focus
      // classes before ambient classes and native types, each with a short wait (focus.ts).
      get priority() {
        return deckClassPriority(waitingRef.current[0], focusRef.current);
      },
      get maxWaitMs() {
        return deckClassMaxWait(waitingRef.current[0], focusRef.current);
      },
      pending: () => waitingRef.current.length,
      admitOne: () => {
        const next = waitingRef.current[0];
        if (!next) return;
        admission.admitted.add(next);
        waitingRef.current = waitingRef.current.slice(1);
        // Hand deck the new class and initialise it here, inside the drained slot: only deck's own
        // work for this one class (one program link) runs in this task — no React commit. A map
        // frame queued before the link would make it wait for that frame on the GPU.
        const all = flattenLayers<Layer>(orderedDeckLayers(useDeckLayerStore.getState().entries) as unknown[]);
        const now = lists.layers(admitLayers(all, admission).pass, beforeIdRef.current);
        layersRef.current = now;
        applyRef.current(now);
        initPendingLayers(deckOf(overlay));
        // React catches up in time slices (same list, same layers: deck sees nothing new).
        startTransition(() => setAdmittedVersion((v) => v + 1));
      },
    });
  }, [scheduler, admission, lists, overlay]);

  // After a WebGL context restore MapLibre rebuilds its style; hand deck its layers again.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const heal0 = healTimer.current; // a stable object (mutated, never replaced)
    const reapply = () => applyRef.current(layersRef.current);
    // A style change (deck's own retry needs isStyleLoaded) or a group still missing: apply again.
    const heal = () => {
      if (missingDeckGroups(map as unknown as ApplyMap, flattenLayers<Layer>(layersRef.current as unknown[])).length) reapply();
    };
    map.on('webglcontextrestored', reapply);
    map.on('styledata', heal);
    map.on('sourcedata', heal);
    map.on('idle', heal);
    return () => {
      map.off('webglcontextrestored', reapply);
      map.off('styledata', heal);
      map.off('sourcedata', heal);
      map.off('idle', heal);
      if (heal0.id !== null) clearTimeout(heal0.id);
      heal0.id = null;
      useAdmissionStore.getState().setUndrawn('deck', 0);
    };
  }, [mapRef, overlay]);
  useEffect(() => {
    // A deck already initialised (StrictMode re-run, device reuse) has its EventManager now.
    detachDeckInput(deckOf(overlay));
    setPickOverlay(overlay as unknown as PickOverlay);
    // The hover feed is ours from now on: the host's per-frame hover reuses its result and never
    // runs a GPU pick of its own, even before the first budgeted pick.
    setDeckHoverInfo(null);
    return () => setPickOverlay(null);
  }, [overlay]);
  // Budgeted hover picks (perf round-5 m-h) from the map's pointer events.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const gate = createHoverPickGate({
      pick: (x, y) => runDeckHoverPick(deckOf(overlay), x, y),
      leave: () => {
        if (!hoverHit.current) return; // nothing highlighted: no pick needed to clear it
        runDeckHoverLeave(deckOf(overlay));
      },
      timers: {
        setTimeout: (cb, ms) => setTimeout(cb, ms),
        clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
        now: () => performance.now(),
      },
    });
    const move = (e: { point: { x: number; y: number }; originalEvent?: MouseEvent }) =>
      gate.move(e.point.x, e.point.y, !hoverAllowed(e.originalEvent) || map.isMoving());
    const leave = () => gate.leave();
    // Hover yields to clicks: no pick lands between the two clicks of a double (right-)click.
    const press = () => gate.press();
    // A drag or camera move starting under a resting pointer: no trailing pick at the old position.
    const blocked = () => gate.move(Number.NaN, Number.NaN, true);
    map.on('mousemove', move);
    map.on('mouseout', leave);
    map.on('mousedown', press);
    map.on('mouseup', press);
    map.on('contextmenu', press);
    map.on('movestart', blocked);
    return () => {
      gate.dispose();
      map.off('mousemove', move);
      map.off('mouseout', leave);
      map.off('mousedown', press);
      map.off('mouseup', press);
      map.off('contextmenu', press);
      map.off('movestart', blocked);
    };
  }, [mapRef, overlay]);
  useEffect(() => {
    if (ready) applyRef.current(layersRef.current); // #10733: re-apply once the style is parsed
  }, [ready, overlay]);
  return null;
}
