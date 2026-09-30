'use client';
/**
 * Air quality points coloured by US AQI category. Zoomed out: the world-city sampling set; at
 * zoom ≥ 5 a grid inside the viewport (bbox rounded to whole degrees so neighbours share the
 * server cache). Owner: layers-hazards.
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
import { selectEntity } from './pick';
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

  const layers = useMemo(() => {
    if (!items) return null;
    return [
      new ScatterplotLayer<AirQuality>({
        id: 'hazards-air-quality',
        data: items,
        getPosition: (a) => [a.lng, a.lat],
        getRadius: 6,
        radiusUnits: 'pixels',
        getFillColor: (a) => readCssColor(aqiCategory(a.usAqi).token, 0.8),
        getLineColor: readCssColor('--map-air-quality', 0.9),
        stroked: true,
        getLineWidth: 1,
        lineWidthUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
      }),
    ];
  }, [items]);

  useDeckLayers('hazards:air_quality', layers, Z);
  useHitTester('air_quality', (m, e) => {
    const hit = items && nearestPoint(m, e, items, (a) => [a.lng, a.lat], () => 6);
    return hit ? { layer: 'air_quality', distancePx: hit.distancePx, open: () => selectEntity('air_quality', 'air_quality', hit.item, hit.item as unknown as Record<string, unknown>) } : null;
  });
  return null;
}
