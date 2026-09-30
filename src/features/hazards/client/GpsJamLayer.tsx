'use client';
/**
 * GPS interference: gpsjam daily H3 r4 cells (and live NACp bins) as an H3HexagonLayer — H3 on the
 * globe, never a deck HexagonLayer. Colour by the share of degraded aircraft (gpsjam thresholds).
 * Owner: layers-hazards.
 */
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { useMemo } from 'react';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers } from '@/lib/layer-host';
import { readCssColor } from '@/lib/tokens';
import type { GpsInterferenceResponse, GpsJamCell } from '@/lib/types';
import { jamLevel } from '../shared';
import { selectEntity } from './pick';
import { useHazardData } from './useHazardData';

const Z = LAYERS.find((l) => l.id === 'gps_jam')!.z;
const count = (b: GpsInterferenceResponse) => b.items.length;

export default function GpsJamLayer() {
  const data = useHazardData<GpsInterferenceResponse>('gps_jam', '/api/gps-interference', count);
  const items = data?.items;

  const layers = useMemo(() => {
    if (!items) return null;
    return [
      new H3HexagonLayer<GpsJamCell>({
        id: 'hazards-gps-jam',
        data: items,
        getHexagon: (c) => c.h3,
        getFillColor: (c) => {
          const l = jamLevel(c);
          return readCssColor(l.token, l.alpha);
        },
        getLineColor: (c) => readCssColor(jamLevel(c).token, 0.8),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 0.5,
        extruded: false,
        coverage: 0.94,
        pickable: true,
        autoHighlight: true,
        onClick: ({ object }) => {
          if (!object) return false;
          const c = object;
          const observedAt = c.date ? `${c.date}T23:59:59.000Z` : (data?.meta.fetchedAt ?? null);
          selectEntity('gps_jam_cell', 'gps_jam', { id: c.h3, lat: c.lat, lng: c.lng, source: c.basis === 'live-nacp' ? 'live_nacp' : 'gpsjam', observedAt }, { ...c, suspect: data?.suspect ?? null });
          return true;
        },
      }),
    ];
  }, [items, data]);

  useDeckLayers('hazards:gps_jam', layers, Z);
  return null;
}
