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
 * classes are admitted one per quiet slot (`admitLayers` + `afterQuietSlot`: idle main thread, then
 * a drained GPU queue), so each program link runs alone instead of blocking behind queued map
 * frames. Owner: map-engine.
 */
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { Layer, LayersList, PickingInfo } from '@deck.gl/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useControl, useMap } from 'react-map-gl/maplibre';
import { orderedDeckLayers, useDeckLayerStore, useMapInstanceStore } from '@/lib/layer-host';
import { admitLayers, createAdmissionState, flattenLayers } from '@/lib/map/deck-admission';
import { afterQuietSlot, canvasGl } from '@/lib/map/gpu-drain';
import { type DeckLike, detachDeckPressPicking, initPendingLayers } from '@/lib/map/deck-events';
import { type DeckPickInfo, hoverCursor, type PickOverlay, setDeckHoverInfo, setPickOverlay } from '@/lib/map/picking';

/** `beforeId` is a MapLibreOverlay-specific layer prop (not in deck's LayerProps typings). */
type WithBeforeId = { beforeId?: string };

/** Longest wait (per phase) for a quiet slot before the next layer class is admitted anyway. */
const ADMIT_IDLE_TIMEOUT_MS = 1500;

function withBeforeId(layers: readonly Layer[], beforeId: string | undefined): LayersList {
  if (!beforeId) return [...layers];
  return layers.map((layer) => ((layer.props as WithBeforeId).beforeId ? layer : layer.clone({ beforeId } as Partial<Layer['props']> & WithBeforeId)));
}

/** The overlay's Deck instance (a private field; read-only use). */
const deckOf = (o: MapLibreOverlay | undefined): DeckLike | undefined => (o as unknown as { _deck?: DeckLike } | undefined)?._deck;

export default function DeckOverlay({ beforeId }: { beforeId?: string }) {
  const entries = useDeckLayerStore((s) => s.entries);
  const ready = useMapInstanceStore((s) => s.ready);
  const [admission] = useState(createAdmissionState);
  const [admittedVersion, setAdmittedVersion] = useState(0);

  const { pass, waiting } = useMemo(() => {
    const all = flattenLayers<Layer>(orderedDeckLayers(entries) as unknown[]);
    return admitLayers(all, admission);
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
  useEffect(() => {
    layersRef.current = layers;
    overlay.setProps({ layers });
  }, [overlay, layers]);
  // Admit the next waiting layer class in a quiet slot (one program link per slot, GPU drained).
  const nextClass = waiting[0];
  useEffect(() => {
    if (!nextClass) return;
    return afterQuietSlot(
      () => canvasGl(mapRef?.getMap().getCanvas()),
      () => {
        admission.admitted.add(nextClass);
        // Commit + effects (overlay.setProps) synchronously, then initialise the new layers here:
        // their program link must not wait behind a map frame queued after the drain.
        flushSync(() => setAdmittedVersion((v) => v + 1));
        initPendingLayers(deckOf(overlay));
      },
      ADMIT_IDLE_TIMEOUT_MS,
    );
  }, [nextClass, admittedVersion, admission, mapRef, overlay]);

  // After a WebGL context restore MapLibre rebuilds its style; hand deck its layers again.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const reapply = () => overlay.setProps({ layers: layersRef.current });
    map.on('webglcontextrestored', reapply);
    return () => {
      map.off('webglcontextrestored', reapply);
    };
  }, [mapRef, overlay]);
  useEffect(() => {
    // A deck already initialised (StrictMode re-run, device reuse) has its EventManager now.
    detachDeckPressPicking(deckOf(overlay));
    setPickOverlay(overlay as unknown as PickOverlay);
    return () => setPickOverlay(null);
  }, [overlay]);
  useEffect(() => {
    if (ready) overlay.setProps({ layers: layersRef.current }); // #10733: re-apply once the style is idle
  }, [ready, overlay]);
  return null;
}
