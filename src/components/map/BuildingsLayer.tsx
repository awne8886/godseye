'use client';
/**
 * 3D buildings (registry `terrain_3d`, REFERENCE): fill-extrusion on the basemap's own
 * `building` source-layer from z 14.5 (`hide_3d != true`, height ramp from the basemap palette).
 * While on, the flat building fill stops at z 14.5 so the two never z-fight. Owner: map-engine.
 */
import { useEffect, useMemo } from 'react';
import { Layer, useMap } from 'react-map-gl/maplibre';
import { BUILDINGS_MIN_ZOOM, buildingExtrusionLayer } from '@/lib/map/style-transform';

const FLAT_BUILDING_LAYER = 'building';

export default function BuildingsLayer({ beforeId, visible }: { beforeId?: string; visible: boolean }) {
  const { current } = useMap();
  const spec = useMemo(() => buildingExtrusionLayer(), []);

  useEffect(() => {
    const map = current?.getMap();
    const flat = map?.getLayer(FLAT_BUILDING_LAYER);
    if (!map || !flat) return;
    const min = flat.minzoom ?? 0;
    const max = flat.maxzoom ?? 24;
    if (visible) {
      map.setLayerZoomRange(FLAT_BUILDING_LAYER, min, BUILDINGS_MIN_ZOOM);
      // Buildings read as 3D only when tilted (OSIRIS eased to 50° under 40°).
      if (map.getZoom() >= BUILDINGS_MIN_ZOOM - 0.5 && map.getPitch() < 40) map.easeTo({ pitch: 50, duration: 1200 });
    }
    return () => {
      if (map.getLayer(FLAT_BUILDING_LAYER)) map.setLayerZoomRange(FLAT_BUILDING_LAYER, min, max);
    };
  }, [current, visible]);

  return <Layer {...spec} beforeId={beforeId} layout={{ visibility: visible ? 'visible' : 'none' }} />;
}
