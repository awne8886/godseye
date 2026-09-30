'use client';
/**
 * Native MapLibre GeoJSON source + layers for polygon footprints (NWS alert areas, NHC cones,
 * Sentinel scenes): inserted under the basemap labels, updated with setData, re-added after a
 * style reload, removed on unmount. Clicks resolve the feature's `id` property. Owner: layers-hazards.
 */
import type { LayerSpecification, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useMapInstance } from '@/lib/layer-host';

type Spec = Exclude<LayerSpecification, { type: 'background' | 'raster' | 'hillshade' | 'color-relief' }>;

function firstSymbolId(map: MapLibreMap): string | undefined {
  return map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
}

export function useGeoJsonLayers(
  sourceId: string,
  data: GeoJSON.FeatureCollection | null,
  layers: Omit<Spec, 'source'>[],
  onClick?: (id: string) => void,
): void {
  const map = useMapInstance();
  const dataRef = useRef(data);
  const layersRef = useRef(layers);
  const clickRef = useRef(onClick);
  useEffect(() => {
    dataRef.current = data;
    layersRef.current = layers;
    clickRef.current = onClick;
  });

  // Add (or re-add after a style reload) the source and layers.
  useEffect(() => {
    if (!map) return;
    const ensure = () => {
      if (!map.getStyle()) return;
      const fc = dataRef.current ?? { type: 'FeatureCollection', features: [] };
      if (!map.getSource(sourceId)) map.addSource(sourceId, { type: 'geojson', data: fc, promoteId: 'id' });
      const before = firstSymbolId(map);
      for (const l of layersRef.current) {
        if (!map.getLayer(l.id)) map.addLayer({ ...l, source: sourceId } as LayerSpecification, before);
      }
    };
    ensure();
    const handlers = layersRef.current.map((l) => {
      const click = (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === 'string') clickRef.current?.(id);
      };
      const enter = () => (map.getCanvas().style.cursor = 'pointer');
      const leave = () => (map.getCanvas().style.cursor = '');
      map.on('click', l.id, click);
      map.on('mouseenter', l.id, enter);
      map.on('mouseleave', l.id, leave);
      return { id: l.id, click, enter, leave };
    });
    map.on('styledata', ensure);
    return () => {
      map.off('styledata', ensure);
      for (const h of handlers) {
        map.off('click', h.id, h.click);
        map.off('mouseenter', h.id, h.enter);
        map.off('mouseleave', h.id, h.leave);
      }
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
    for (const l of layers) {
      if (!map.getLayer(l.id) || !('paint' in l) || !l.paint) continue;
      for (const [k, v] of Object.entries(l.paint)) map.setPaintProperty(l.id, k as Parameters<MapLibreMap['setPaintProperty']>[1], v);
    }
  }, [map, layers]);
}
