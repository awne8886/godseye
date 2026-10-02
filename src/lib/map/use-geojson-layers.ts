'use client';
/**
 * Shared native MapLibre GeoJSON source + layers for feature modules (NWS alert areas, NHC cones,
 * Sentinel scenes, quake rings, alert pins): inserted under the basemap labels, updated with
 * setData, re-added after a style reload, repainted in place when the paint props change (theme
 * recolour, no remount), removed on unmount. Clicks and the hover cursor come from the map's
 * single router via hit-test.ts (queryRenderedFeatures on these layers). Owner: map-engine
 * (moved from features/hazards/client/useGeoJsonLayers.ts; the paint effect is the threats
 * `useNativeLayers` one).
 */
import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useMapInstance } from '@/lib/layer-host';

export type GeoJsonLayerSpec = Omit<
  Exclude<LayerSpecification, { type: 'background' | 'raster' | 'hillshade' | 'color-relief' }>,
  'source'
>;

function firstSymbolId(map: MapLibreMap): string | undefined {
  return map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
}

/** Apply every paint property of `layers` to the live map in place (layers not yet added are skipped). */
export function repaintLayers(map: MapLibreMap, layers: readonly GeoJsonLayerSpec[]): void {
  for (const l of layers) {
    if (!map.getLayer(l.id) || !('paint' in l) || !l.paint) continue;
    for (const [k, v] of Object.entries(l.paint)) {
      map.setPaintProperty(l.id, k as Parameters<MapLibreMap['setPaintProperty']>[1], v);
    }
  }
}

export function useGeoJsonLayers(
  sourceId: string,
  data: GeoJSON.FeatureCollection | null,
  layers: GeoJsonLayerSpec[],
): void {
  const map = useMapInstance();
  const dataRef = useRef(data);
  const layersRef = useRef(layers);
  useEffect(() => {
    dataRef.current = data;
    layersRef.current = layers;
  });

  // Add (or re-add after a style reload) the source and layers.
  useEffect(() => {
    if (!map) return;
    const ensure = () => {
      try {
        if (!map.getStyle()) return;
        const fc = dataRef.current ?? { type: 'FeatureCollection', features: [] };
        if (!map.getSource(sourceId)) map.addSource(sourceId, { type: 'geojson', data: fc, promoteId: 'id' });
        const before = firstSymbolId(map);
        for (const l of layersRef.current) {
          if (!map.getLayer(l.id)) map.addLayer({ ...l, source: sourceId } as LayerSpecification, before);
        }
      } catch {
        // The style is mid-(re)load: retried on the next styledata event.
      }
    };
    ensure();
    map.on('styledata', ensure);
    return () => {
      map.off('styledata', ensure);
      try {
        if (!map.getStyle()) return;
        for (const l of layersRef.current) if (map.getLayer(l.id)) map.removeLayer(l.id);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // The map is being torn down.
      }
    };
  }, [map, sourceId]);

  // Push new data.
  useEffect(() => {
    if (!map || !data) return;
    const src = map.getSource(sourceId) as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined;
    src?.setData?.(data);
  }, [map, sourceId, data]);

  // Repaint in place when the paint props change (theme recolour).
  useEffect(() => {
    if (!map) return;
    repaintLayers(map, layers);
  }, [map, layers]);
}

/** The `id` property of the topmost rendered feature of `layerIds` under the click, if any. */
export function renderedFeatureId(map: MapLibreMap, point: { x: number; y: number }, layerIds: string[]): string | null {
  const present = layerIds.filter((id) => map.getLayer(id));
  if (!present.length) return null;
  const id = map.queryRenderedFeatures([point.x, point.y], { layers: present })[0]?.properties?.id;
  return typeof id === 'string' ? id : null;
}
