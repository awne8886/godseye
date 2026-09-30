'use client';
/**
 * Background map overlays for ROUTE, DRAW and ARCGIS (mounted once inside the map provider):
 * publishes deck layers (route casing + line with alternates, stops, drawn shapes and the live
 * sketch, imported ArcGIS layers) and, only while a DRAW tool is active, listens to map pointer
 * events to add vertices (double-click / Enter finishes, Esc cancels). Colours come from
 * `--map-directions*` tokens. Owner: panels-recon.
 */
import { useEffect, useMemo } from 'react';
import { GeoJsonLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { LayersList } from '@deck.gl/core';
import type { MapMouseEvent } from 'maplibre-gl';
import { useDeckLayers, useMapInstance } from '@/lib/layer-host';
import { readCssColor } from '@/lib/tokens';
import { useOverlayStore, nextId } from './overlay-store';
import { circlePolygon, distanceM, type DrawFeature } from '../draw/geometry';

/** Above basemap-ish layers, below live entities. */
const Z = 45;
const GLOBE = { cullMode: 'none' } as const;

function useDrawInteraction() {
  const map = useMapInstance();
  const mode = useOverlayStore((s) => s.drawMode);
  useEffect(() => {
    if (!map || !mode) return;
    const st = useOverlayStore.getState;
    const finish = () => {
      const { sketch, drawMode, features } = st();
      const n = features.length + 1;
      let f: DrawFeature | null = null;
      if (drawMode === 'line' && sketch.length >= 2) f = { type: 'Feature', geometry: { type: 'LineString', coordinates: sketch }, properties: { id: nextId('line'), shape: 'line', name: `Line ${n}` } };
      if (drawMode === 'polygon' && sketch.length >= 3) f = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...sketch, sketch[0]!]] }, properties: { id: nextId('poly'), shape: 'polygon', name: `Polygon ${n}` } };
      if (f) st().addFeatures([f]);
      st().setSketch([]);
    };
    const onClick = (e: MapMouseEvent) => {
      const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const { drawMode, sketch, features } = st();
      const n = features.length + 1;
      if (drawMode === 'point') {
        st().addFeatures([{ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { id: nextId('pt'), shape: 'point', name: `Point ${n}` } }]);
      } else if (drawMode === 'circle') {
        if (!sketch.length) st().setSketch([p]);
        else {
          const c = sketch[0]!;
          const r = distanceM(c, p);
          if (r > 0) st().addFeatures([{ type: 'Feature', geometry: circlePolygon(c, r), properties: { id: nextId('circle'), shape: 'circle', name: `Circle ${n}`, center: c, radiusM: r } }]);
          st().setSketch([]);
        }
      } else {
        const last = sketch.at(-1);
        if (!last || last[0] !== p[0] || last[1] !== p[1]) st().setSketch([...sketch, p]);
      }
    };
    const onDbl = (e: MapMouseEvent) => {
      e.preventDefault();
      finish();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') st().setSketch([]);
      if (e.key === 'Enter') finish();
    };
    const dblZoom = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', onClick);
    map.on('dblclick', onDbl);
    window.addEventListener('keydown', onKey);
    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDbl);
      window.removeEventListener('keydown', onKey);
      map.getCanvas().style.cursor = '';
      if (dblZoom) map.doubleClickZoom.enable();
    };
  }, [map, mode]);
}

export default function ReconOverlays() {
  useDrawInteraction();
  const route = useOverlayStore((s) => s.route);
  const features = useOverlayStore((s) => s.features);
  const sketch = useOverlayStore((s) => s.sketch);
  const mode = useOverlayStore((s) => s.drawMode);
  const arcgis = useOverlayStore((s) => s.arcgis);

  const layers = useMemo<LayersList | null>(() => {
    const out: LayersList = [];
    for (const l of arcgis) {
      if (!l.visible) continue;
      out.push(
        new GeoJsonLayer({
          id: `recon-arcgis-${l.id}`,
          data: l.fc,
          stroked: true,
          filled: true,
          pointType: 'circle',
          getFillColor: readCssColor('--map-route-filed', 0.25),
          getLineColor: readCssColor('--map-route-filed', 0.9),
          getPointRadius: 4,
          pointRadiusUnits: 'pixels',
          pointBillboard: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 1.5,
          parameters: GLOBE,
          pickable: false,
        }),
      );
    }
    if (features.length) {
      out.push(
        new GeoJsonLayer({
          id: 'recon-draw',
          data: { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection,
          stroked: true,
          filled: true,
          pointType: 'circle',
          getFillColor: (f: GeoJSON.Feature) => readCssColor('--map-directions-active', (f.properties as { aoi?: boolean })?.aoi ? 0.28 : 0.14),
          getLineColor: readCssColor('--map-directions-active', 0.95),
          getPointRadius: 5,
          pointRadiusUnits: 'pixels',
          pointBillboard: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          parameters: GLOBE,
          pickable: false,
        }),
      );
    }
    if (mode && sketch.length) {
      const path = mode === 'polygon' && sketch.length > 2 ? [...sketch, sketch[0]!] : sketch;
      out.push(
        new PathLayer<{ path: [number, number][] }>({
          id: 'recon-sketch',
          data: [{ path }],
          getPath: (d) => d.path,
          getColor: readCssColor('--map-directions-active', 0.8),
          getWidth: 2,
          widthUnits: 'pixels',
          parameters: GLOBE,
        }),
        new ScatterplotLayer<[number, number]>({
          id: 'recon-sketch-vertices',
          data: sketch,
          getPosition: (d) => d,
          getRadius: 4,
          radiusUnits: 'pixels',
          billboard: true,
          getFillColor: readCssColor('--map-directions-active', 1),
          parameters: GLOBE,
        }),
      );
    }
    if (route) {
      const paths = route.result.routes.map((r, i) => ({ path: r.geometry.coordinates as [number, number][], i }));
      const alt = paths.filter((p) => p.i !== route.active);
      const act = paths.filter((p) => p.i === route.active);
      out.push(
        new PathLayer<{ path: [number, number][] }>({
          id: 'recon-route-alternates',
          data: alt,
          getPath: (d) => d.path,
          getColor: readCssColor('--map-directions', 0.35),
          getWidth: 4,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          parameters: GLOBE,
        }),
        new PathLayer<{ path: [number, number][] }>({
          id: 'recon-route-casing',
          data: act,
          getPath: (d) => d.path,
          getColor: readCssColor('--map-directions-casing', 0.9),
          getWidth: 8,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          parameters: GLOBE,
        }),
        new PathLayer<{ path: [number, number][] }>({
          id: 'recon-route',
          data: act,
          getPath: (d) => d.path,
          getColor: readCssColor('--map-directions', 1),
          getWidth: 4,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          parameters: GLOBE,
        }),
        new ScatterplotLayer<[number, number]>({
          id: 'recon-route-stops',
          data: route.stops,
          getPosition: (d) => d,
          getRadius: 6,
          radiusUnits: 'pixels',
          billboard: true,
          stroked: true,
          getFillColor: readCssColor('--map-directions-active', 1),
          getLineColor: readCssColor('--map-directions-casing', 1),
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          parameters: GLOBE,
        }),
      );
    }
    return out.length ? out : null;
  }, [route, features, sketch, mode, arcgis]);

  useDeckLayers('panels-recon', layers, Z);
  return null;
}
