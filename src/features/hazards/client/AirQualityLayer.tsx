'use client';
/**
 * Air quality points coloured by US AQI category. Zoomed out: the world-city sampling set; at
 * zoom ≥ 5 a grid inside the viewport (bbox rounded to whole degrees so neighbours share the
 * server cache). On the globe the points draw without the depth test (the surface clipped them) and
 * only on the camera-facing side (globe.tsx). Owner: layers-hazards.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo, useState } from 'react';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useMapInstanceStore } from '@/lib/layer-host';
import { readCssColor } from '@/lib/tokens';
import type { AirQuality, AirQualityResponse } from '@/lib/types';
import { aqiCategory } from '../shared';
import { nearestPoint, useHitTester } from './hit-test';
import { DrawnStatus, GLOBE_POINT_PARAMETERS, useFacing, useFarSideCamera } from './globe';
import { entitySelection } from './pick';
import { useHazardData } from './useHazardData';

const Z = LAYERS.find((l) => l.id === 'air_quality')!.z;
const count = (b: AirQualityResponse) => b.items.length;

function viewportUrl(map: MapLibreMap | null): string {
  if (!map || map.getZoom() < 5) return '/api/air-quality';
  const b = map.getBounds();
  const w = Math.max(-180, Math.floor(b.getWest()));
  const e = Math.min(180, Math.ceil(b.getEast()));
  const s = Math.max(-90, Math.floor(b.getSouth()));
  const n = Math.min(90, Math.ceil(b.getNorth()));
  if (e - w > 60 || n - s > 40) return '/api/air-quality';
  return `/api/air-quality?bbox=${w},${s},${e},${n}`;
}

export default function AirQualityLayer() {
  // Camera events only need the loaded map (not the first `idle`).
  const map = useMapInstanceStore((s) => s.map);
  const [url, setUrl] = useState('/api/air-quality');
  useEffect(() => {
    if (!map) return;
    const onMove = () => setUrl(viewportUrl(map));
    onMove();
    map.on('moveend', onMove);
    return () => {
      map.off('moveend', onMove);
    };
  }, [map]);

  const data = useHazardData<AirQualityResponse>('air_quality', url, count);
  const items = data?.items;

  const camera = useFarSideCamera();
  const points = useFacing(items, camera);

  const layers = useMemo(() => {
    if (!points) return null;
    return [
      new ScatterplotLayer<AirQuality>({
        id: 'hazards-air-quality',
        data: points,
        getPosition: (a) => [a.lng, a.lat],
        getRadius: 6,
        radiusUnits: 'pixels',
        getFillColor: (a) => readCssColor(aqiCategory(a.usAqi).token, 0.8),
        getLineColor: readCssColor('--map-air-quality', 0.9),
        stroked: true,
        getLineWidth: 1,
        lineWidthUnits: 'pixels',
        billboard: true,
        parameters: GLOBE_POINT_PARAMETERS,
        pickable: true,
        autoHighlight: true,
      }),
    ];
  }, [points]);

  useDeckLayers('hazards:air_quality', layers, Z);
  useHitTester('air_quality', (m, e) => {
    const hit = items && nearestPoint(m, e, items, (a) => [a.lng, a.lat], () => 6);
    return hit ? { layer: 'air_quality', distancePx: hit.distancePx, selection: entitySelection('air_quality', 'air_quality', hit.item, hit.item as unknown as Record<string, unknown>) } : null;
  });
  return <DrawnStatus layer="air_quality" drawn={points?.length ?? 0} total={items?.length ?? 0} camera={camera} />;
}
