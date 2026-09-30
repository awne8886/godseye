'use client';
/**
 * The single interleaved deck.gl overlay (§3). Layers come from feature modules through
 * useDeckLayerStore; every layer without its own beforeId is inserted under the basemap labels.
 * Workarounds: `_reuseDevices` for React StrictMode (#10681), re-apply layers after the first
 * `idle` for the beforeId ordering regression (#10733). Owner: map-engine.
 */
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { Layer, LayersList } from '@deck.gl/core';
import { useEffect, useMemo } from 'react';
import { useControl } from 'react-map-gl/maplibre';
import { orderedDeckLayers, useDeckLayerStore, useMapInstanceStore } from '@/lib/layer-host';

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
  useEffect(() => {
    overlay.setProps({ layers });
  }, [overlay, layers]);
  useEffect(() => {
    if (ready) overlay.setProps({ layers }); // #10733: re-apply once the style is idle
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
