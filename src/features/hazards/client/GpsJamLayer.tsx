'use client';
/**
 * GPS interference: gpsjam daily H3 r4 cells (and live NACp bins) as an H3HexagonLayer — H3 on the
 * globe, never a deck HexagonLayer. Colour by the share of degraded aircraft (gpsjam thresholds).
 * On the globe the cells draw without the depth test (they z-fought the globe mesh into hatched
 * hexes, visual-qa round 5) and only on the camera-facing side (globe.tsx). Owner: layers-hazards.
 */
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { latLngToCell } from 'h3-js';
import { useEffect, useMemo, useState } from 'react';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useMapInstanceStore } from '@/lib/layer-host';
import { isFacing } from '@/lib/map/far-side';
import { readCssColor } from '@/lib/tokens';
import type { GpsInterferenceResponse, GpsJamCell } from '@/lib/types';
import { jamLevel } from '../shared';
import { DrawnStatus, GLOBE_POINT_PARAMETERS, useFacing, useFarSideCamera } from './globe';
import { hitCamera, useHitTester } from './hit-test';
import { entitySelection } from './pick';
import { useHazardData } from './useHazardData';

const Z = LAYERS.find((l) => l.id === 'gps_jam')!.z;
const count = (b: GpsInterferenceResponse) => b.items.length;

/** Cell outlines only from this zoom: at globe scale they merge into an opaque mesh over the aircraft. */
const OUTLINE_MIN_ZOOM = 6;

/** True while the map zoom is ≥ `min` (updated on zoomend only, never per frame). */
function useZoomAtLeast(min: number): boolean {
  const map = useMapInstanceStore((s) => s.map);
  const [atLeast, setAtLeast] = useState(false);
  useEffect(() => {
    if (!map) return;
    const on = () => setAtLeast(map.getZoom() >= min);
    on();
    map.on('zoomend', on);
    return () => {
      map.off('zoomend', on);
    };
  }, [map, min]);
  return atLeast;
}

export default function GpsJamLayer() {
  const data = useHazardData<GpsInterferenceResponse>('gps_jam', '/api/gps-interference', count);
  const items = data?.items;
  const outlined = useZoomAtLeast(OUTLINE_MIN_ZOOM);
  const camera = useFarSideCamera();
  const cells = useFacing(items, camera);

  // Visual-qa M11: translucent fills (jamLevel alphas ≤ .35), registry z 20 keeps the cells under
  // every aircraft layer (z ≥ 80), and 1 px outlines only once zoomed in.
  const layers = useMemo(() => {
    if (!cells) return null;
    return [
      new H3HexagonLayer<GpsJamCell>({
        id: 'hazards-gps-jam',
        data: cells,
        getHexagon: (c) => c.h3,
        getFillColor: (c) => {
          const l = jamLevel(c);
          return readCssColor(l.token, l.alpha);
        },
        getLineColor: (c) => readCssColor(jamLevel(c).token, 0.7),
        stroked: outlined,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        extruded: false,
        coverage: 0.94,
        parameters: GLOBE_POINT_PARAMETERS,
        pickable: true,
        autoHighlight: true,
      }),
    ];
  }, [cells, outlined]);

  const byCell = useMemo(() => {
    const m = new Map<string, GpsJamCell>();
    // Daily cells first; a live bin for the same cell (newer) replaces it.
    for (const c of items ?? []) if (!m.has(c.h3) || c.basis === 'live-nacp') m.set(c.h3, c);
    return m;
  }, [items]);

  useHitTester('gps_jam', (map, e) => {
    const c = byCell.get(latLngToCell(e.lngLat.lat, e.lngLat.wrap().lng, 4));
    // A cell is hit only where it is drawn: its centre on the camera-facing side.
    const cam = hitCamera(map);
    if (!c || (cam && !isFacing([c.lng, c.lat], cam))) return null;
    // Daily aggregates cover a UTC day: the card names the day; live bins carry the newest position
    // time of a degraded aircraft in the cell (an observation, never the fetch time).
    const observedAt = c.date ? `${c.date}T23:59:59.000Z` : (c.observedAt ?? null);
    return {
      layer: 'gps_jam',
      distancePx: 0,
      selection: entitySelection('gps_jam_cell', 'gps_jam', { id: c.h3, lat: c.lat, lng: c.lng, source: c.basis === 'live-nacp' ? 'live_nacp' : 'gpsjam', observedAt }, { ...c, suspect: data?.suspect ?? null }),
    };
  });

  useDeckLayers('hazards:gps_jam', layers, Z);
  return <DrawnStatus layer="gps_jam" drawn={cells?.length ?? 0} total={items?.length ?? 0} camera={camera} />;
}
