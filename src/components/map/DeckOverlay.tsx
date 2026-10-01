'use client';
/**
 * The single interleaved deck.gl overlay (§3). Layers come from feature modules through
 * useDeckLayerStore; every layer without its own beforeId is inserted under the basemap labels.
 * Workarounds: `_reuseDevices` for React StrictMode (#10681), re-apply layers after the first
 * `idle` for the beforeId ordering regression (#10733). Entries are ordered by registry z
 * (`orderedDeckLayers`). The overlay's picking API is published for the click router
 * (src/lib/map/picking.ts).
 *
 * Input (R1-M1): deck's own pointerdown/click/drag picking is detached (`detachDeckPressPicking`);
 * clicks are routed by the map host only (primary button), so right-clicks and drags never run a
 * GPU pick. deck's hover pick (≤ 1 per frame, skipped while a button is held) feeds autoHighlight
 * and is reused by the host's hover cursor instead of a second pick.
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
 * Focus first (visual-qa R4-M1): classes needed by module Backgrounds (the planned route, drawn
 * shapes: what the user asked for) are admitted before ambient data-layer classes, ahead of
 * native layer types too, so a `?route=` deep link draws within a few slots of style parse.
 * Owner: map-engine.
 */
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { Layer, LayersList, PickingInfo } from '@deck.gl/core';
import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { useControl, useMap } from 'react-map-gl/maplibre';
import { orderedDeckLayers, useDeckLayerStore, useMapInstanceStore } from '@/lib/layer-host';
import { FEATURE_MODULES } from '@/features/registry';
import { admitLayers, createAdmissionState, flattenLayers, focusFirst, layerClassKey, type AdmissionLayer } from '@/lib/map/deck-admission';
import { useAdmissionStore } from '@/lib/map/admission-scheduler';
import { type ApplyMap, missingDeckGroups, withParsedStyle } from '@/lib/map/deck-apply';
import { type DeckLike, detachDeckPressPicking, initPendingLayers } from '@/lib/map/deck-events';
import { type DeckPickInfo, hoverCursor, type PickOverlay, setDeckHoverInfo, setPickOverlay } from '@/lib/map/picking';

/** `beforeId` is a MapLibreOverlay-specific layer prop (not in deck's LayerProps typings). */
type WithBeforeId = { beforeId?: string };

function withBeforeId(layers: readonly Layer[], beforeId: string | undefined): LayersList {
  if (!beforeId) return [...layers];
  return layers.map((layer) => ((layer.props as WithBeforeId).beforeId ? layer : layer.clone({ beforeId } as Partial<Layer['props']> & WithBeforeId)));
}

/** Deck entries published by module Backgrounds (keyed by module id): the user's own focus layers. */
const FOCUS_KEYS = new Set(FEATURE_MODULES.filter((m) => m.Background).map((m) => m.id));

function focusClasses(entries: ReturnType<typeof useDeckLayerStore.getState>['entries']): Set<string> {
  const out = new Set<string>();
  for (const [key, e] of Object.entries(entries)) {
    if (!FOCUS_KEYS.has(key)) continue;
    for (const l of flattenLayers<AdmissionLayer>([e.layers] as unknown[])) out.add(layerClassKey(l));
  }
  return out;
}

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
  const [admittedVersion, setAdmittedVersion] = useState(0);

  const { pass, waiting } = useMemo(() => {
    const all = flattenLayers<Layer>(orderedDeckLayers(entries) as unknown[]);
    const r = admitLayers(all, admission);
    return { pass: r.pass, waiting: focusFirst(r.waiting, focusClasses(entries)) };
    // `admittedVersion` re-runs admission when a class was admitted.
  }, [entries, admittedVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const layers = useMemo(() => withBeforeId(pass, beforeId), [pass, beforeId]);
  const { current: mapRef } = useMap();

  const overlay = useControl(() => {
    const box: { overlay?: MapLibreOverlay } = {};
    box.overlay = new MapLibreOverlay({
      interleaved: true,
      layers: [],
      deviceProps: { _reuseDevices: true } as never,
      // deck writes the canvas cursor every frame: follow the host's hover verdict, else MapLibre's.
      getCursor: hoverCursor,
      onHover: (info: PickingInfo) => setDeckHoverInfo(info as unknown as DeckPickInfo),
      // The EventManager exists from onLoad on: detach deck's press/click/drag picking there.
      onLoad: () => detachDeckPressPicking(deckOf(box.overlay)),
    });
    return box.overlay;
  });
  const layersRef = useRef(layers);
  const beforeIdRef = useRef(beforeId);
  /** Hand deck `next` (groups added once the style is parsed) and publish what is still off the map. */
  const healTimer = useRef<{ id: ReturnType<typeof setTimeout> | null; step: number }>({ id: null, step: 0 });
  const applyRef = useRef((next: LayersList) => {
    const map = mapOfOverlay(overlay);
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
      // Diagnostics for e2e: deck layers handed over, and groups still missing from the style.
      el.dataset.deckLayers = String((next as unknown[]).length);
      el.dataset.deckUndrawn = String(missing);
    }
  });
  useEffect(() => {
    layersRef.current = layers;
    beforeIdRef.current = beforeId;
    applyRef.current(layers);
  }, [overlay, layers, beforeId]);
  // Waiting layer classes are admitted one per scheduler slot.
  const scheduler = useAdmissionStore((s) => s.scheduler);
  const waitingRef = useRef<string[]>([]);
  useEffect(() => {
    waitingRef.current = waiting;
    scheduler?.kick();
  }, [waiting, scheduler]);
  useEffect(() => {
    if (!scheduler) return;
    return scheduler.register({
      id: 'deck-classes',
      // Ahead of native layer types while a focus class (route, drawing) is next in line.
      get priority() {
        const next = waitingRef.current[0];
        return next && focusClasses(useDeckLayerStore.getState().entries).has(next) ? 1 : 2;
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
        const now = withBeforeId(admitLayers(all, admission).pass, beforeIdRef.current);
        layersRef.current = now;
        applyRef.current(now);
        initPendingLayers(deckOf(overlay));
        // React catches up in time slices (same layers by id: deck diffs them, nothing re-links).
        startTransition(() => setAdmittedVersion((v) => v + 1));
      },
    });
  }, [scheduler, admission, overlay]);

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
    detachDeckPressPicking(deckOf(overlay));
    setPickOverlay(overlay as unknown as PickOverlay);
    return () => setPickOverlay(null);
  }, [overlay]);
  useEffect(() => {
    if (ready) applyRef.current(layersRef.current); // #10733: re-apply once the style is parsed
  }, [ready, overlay]);
  return null;
}
