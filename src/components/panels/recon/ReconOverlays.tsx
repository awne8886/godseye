'use client';
/**
 * Background map overlays for ROUTE, DRAW and ARCGIS (mounted once inside the map provider):
 * publishes deck layers (route casing + line with alternates, stops, drawn shapes and the live
 * sketch, imported ArcGIS layers) and, only while a DRAW tool is active, takes the canvas clicks
 * to add vertices — entity selection is suppressed meanwhile (draw/map-capture.ts); FINISH,
 * double-click or Enter finishes, CANCEL or Esc cancels. Colours come from `--map-directions*`
 * tokens. Owner: panels-recon.
 */
import { useEffect, useMemo, useState } from 'react';
import { GeoJsonLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { LayersList } from '@deck.gl/core';
import { useDeckLayers, useMapInstance } from '@/lib/layer-host';
import { getFarSideCamera, isFacing, type FarSideCamera } from '@/lib/map/far-side';
import { readCssColor } from '@/lib/tokens';
import { addDrawPoint, useOverlayStore } from './overlay-store';
import { captureMapClicks, isRepeatClick, keyForSketch, type LastClick } from '../draw/map-capture';

/** Above basemap-ish layers, below live entities. */
const Z = 45;
const GLOBE = { cullMode: 'none' } as const;
/** Billboard points: never half-hidden by the globe's depth; the far-side filter hides the back side. */
const POINTS = { cullMode: 'none', depthCompare: 'always' } as const;
const facing = (pts: readonly [number, number][], cam: FarSideCamera | null) => pts.filter((p) => isFacing(p, cam));

/**
 * While a tool is armed, canvas clicks/taps go to DRAW only (captureMapClicks: entity selection is
 * suppressed), double-click or Enter finishes, Esc cancels. Touch users finish with the panel's
 * FINISH button (browsers do not report a double tap as dblclick).
 */
function useDrawInteraction() {
  const map = useMapInstance();
  const mode = useOverlayStore((s) => s.drawMode);
  useEffect(() => {
    if (!map || !mode) return;
    const st = useOverlayStore.getState;
    // A double-click must not add the same vertex (or Point) twice: isRepeatClick.
    let last: LastClick | null = null;
    const release = captureMapClicks(map, {
      onPoint: (p, px) => {
        const at = performance.now();
        const repeat = isRepeatClick(last, px, at, st().sketch.length, mode === 'point');
        last = { px, at };
        if (!repeat) addDrawPoint(p);
      },
      onDouble: () => {
        last = null;
        st().finishSketch();
      },
    });
    const onKey = (e: KeyboardEvent) => {
      const k = keyForSketch(e);
      if (k === 'finish') st().finishSketch();
      if (k === 'cancel') st().cancelSketch();
      if (k) last = null;
    };
    const dblZoom = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable();
    window.addEventListener('keydown', onKey);
    return () => {
      release();
      window.removeEventListener('keydown', onKey);
      if (dblZoom) map.doubleClickZoom.enable();
    };
  }, [map, mode]);
}

/** Re-evaluates the far-side filter after each camera move. */
function useMoveEndTick(): number {
  const map = useMapInstance();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!map) return;
    const on = () => setTick((t) => t + 1);
    map.on('moveend', on);
    return () => {
      map.off('moveend', on);
    };
  }, [map]);
  return tick;
}

export default function ReconOverlays() {
  useDrawInteraction();
  const tick = useMoveEndTick();
  const route = useOverlayStore((s) => s.route);
  const features = useOverlayStore((s) => s.features);
  const sketch = useOverlayStore((s) => s.sketch);
  const mode = useOverlayStore((s) => s.drawMode);
  const arcgis = useOverlayStore((s) => s.arcgis);

  const layers = useMemo<LayersList | null>(() => {
    // The camera as of the last moveend (`tick`), for the far-side filter on billboard points.
    const cam = tick >= 0 ? getFarSideCamera() : null;
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
          data: facing(sketch, cam),
          getPosition: (d) => d,
          getRadius: 4,
          radiusUnits: 'pixels',
          billboard: true,
          getFillColor: readCssColor('--map-directions-active', 1),
          parameters: POINTS,
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
          data: facing(route.stops, cam),
          getPosition: (d) => d,
          getRadius: 6,
          radiusUnits: 'pixels',
          billboard: true,
          stroked: true,
          getFillColor: readCssColor('--map-directions-active', 1),
          getLineColor: readCssColor('--map-directions-casing', 1),
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          parameters: POINTS,
        }),
      );
    }
    return out.length ? out : null;
  }, [route, features, sketch, mode, arcgis, tick]);

  useDeckLayers('panels-recon', layers, Z);
  return null;
}
