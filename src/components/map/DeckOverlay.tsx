'use client';
/**
 * The single interleaved deck.gl overlay (§3). Layers come from feature modules through
 * useDeckLayerStore; every layer without its own beforeId is inserted under the basemap labels.
 * Workarounds: `_reuseDevices` for React StrictMode (#10681), re-apply layers after the first
 * `idle` for the beforeId ordering regression (#10733). Entries are ordered by registry z
 * (`orderedDeckLayers`). The overlay's picking API is published for the click router
 * (src/lib/map/picking.ts). Owner: map-engine.
 */
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { Layer, LayersList } from '@deck.gl/core';
import { useEffect, useMemo, useRef } from 'react';
import { useControl, useMap } from 'react-map-gl/maplibre';
import { orderedDeckLayers, useDeckLayerStore, useMapInstanceStore } from '@/lib/layer-host';
import { type PickOverlay, setPickOverlay } from '@/lib/map/picking';

/** `beforeId` is a MapLibreOverlay-specific layer prop (not in deck's LayerProps typings). */
type WithBeforeId = { beforeId?: string };

function withBeforeId(layers: LayersList, beforeId: string | undefined): LayersList {
  if (!beforeId) return layers;
  return layers.map((l) => {
    if (!l || typeof l !== 'object' || !('props' in l)) return l;
    const layer = l as Layer;
    return (layer.props as WithBeforeId).beforeId ? layer : layer.clone({ beforeId } as Partial<Layer['props']> & WithBeforeId);
  });
}

export default function DeckOverlay({ beforeId }: { beforeId?: string }) {
  const entries = useDeckLayerStore((s) => s.entries);
  const ready = useMapInstanceStore((s) => s.ready);
  const layers = useMemo(() => withBeforeId(orderedDeckLayers(entries), beforeId), [entries, beforeId]);
  const overlay = useControl(
    () =>
      new MapLibreOverlay({
        interleaved: true,
        layers: [],
        deviceProps: { _reuseDevices: true } as never,
      }),
  );
  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
    overlay.setProps({ layers });
  }, [overlay, layers]);
  // After a WebGL context restore MapLibre rebuilds its style; hand deck its layers again.
  const { current } = useMap();
  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    const reapply = () => overlay.setProps({ layers: layersRef.current });
    map.on('webglcontextrestored', reapply);
    return () => {
      map.off('webglcontextrestored', reapply);
    };
  }, [current, overlay]);
  useEffect(() => {
    setPickOverlay(overlay as unknown as PickOverlay);
    return () => setPickOverlay(null);
  }, [overlay]);
  useEffect(() => {
    if (ready) overlay.setProps({ layers }); // #10733: re-apply once the style is idle
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
