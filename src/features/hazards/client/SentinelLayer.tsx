'use client';
/**
 * Sentinel-2 scene footprints around the map centre (CDSE STAC via /api/sentinel), as native
 * MapLibre outlines. Queried only from zoom 6 (a scene is ~110 km wide), after the camera settles.
 * Owner: layers-hazards.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMapInstanceStore } from '@/lib/layer-host';
import { readCssColor } from '@/lib/tokens';
import type { SentinelResponse, SentinelScene } from '@/lib/types';
import { useHitTester } from './hit-test';
import { selectEntity } from './pick';
import { renderedFeatureId, useGeoJsonLayers } from './useGeoJsonLayers';
import { useHazardData } from './useHazardData';

const count = (b: SentinelResponse) => b.items.length;
const MIN_ZOOM = 6;

export default function SentinelLayer() {
  // Camera events only need the loaded map (not the first `idle`).
  const map = useMapInstanceStore((s) => s.map);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!map) return;
    const onMove = () => {
      if (map.getZoom() < MIN_ZOOM) return setUrl(null);
      const c = map.getCenter();
      setUrl(`/api/sentinel?lat=${c.lat.toFixed(2)}&lng=${c.wrap().lng.toFixed(2)}`);
    };
    onMove();
    map.on('moveend', onMove);
    return () => {
      map.off('moveend', onMove);
    };
  }, [map]);

  const data = useHazardData<SentinelResponse>('sentinel', url, count);
  const items = url ? data?.items : undefined;
  const byId = useRef(new Map<string, SentinelScene>());
  useEffect(() => {
    byId.current = new Map((items ?? []).map((s) => [s.id, s]));
  }, [items]);

  const fc = useMemo<GeoJSON.FeatureCollection>(
    () => ({ type: 'FeatureCollection', features: (items ?? []).map((s) => ({ type: 'Feature', geometry: s.footprint, properties: { id: s.id } })) }),
    [items],
  );
  const layers = useMemo(() => {
    const [r, g, b] = readCssColor('--map-directions');
    return [
      { id: 'hazards-sentinel-fill', type: 'fill' as const, paint: { 'fill-color': `rgb(${r},${g},${b})`, 'fill-opacity': 0.04 } },
      { id: 'hazards-sentinel-line', type: 'line' as const, paint: { 'line-color': `rgb(${r},${g},${b})`, 'line-width': 1, 'line-opacity': 0.6, 'line-dasharray': [2, 2] } },
    ];
  }, []);

  useGeoJsonLayers('hazards-sentinel', fc, layers);
  useHitTester('sentinel', (map, e) => {
    const s = byId.current.get(renderedFeatureId(map, e.point, ['hazards-sentinel-fill']) ?? '');
    if (!s) return null;
    const ring = s.footprint.type === 'Polygon' ? s.footprint.coordinates[0] : s.footprint.coordinates[0]?.[0];
    const lng = ring?.length ? ring.reduce((a, p) => a + (p[0] ?? 0), 0) / ring.length : 0;
    const lat = ring?.length ? ring.reduce((a, p) => a + (p[1] ?? 0), 0) / ring.length : 0;
    return { layer: 'sentinel', distancePx: 0, open: () => selectEntity('sentinel_scene', 'sentinel', { id: s.id, lat, lng, source: 'cdse_stac', observedAt: s.datetime }, s as unknown as Record<string, unknown>) };
  });
  return null;
}
