'use client';
/**
 * GPS interference: gpsjam daily H3 r4 cells (and live NACp bins) as an H3HexagonLayer — H3 on the
 * globe, never a deck HexagonLayer. Colour by the share of degraded aircraft (gpsjam thresholds).
 * Owner: layers-hazards.
 */
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { latLngToCell } from 'h3-js';
import { useMemo } from 'react';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers } from '@/lib/layer-host';
import { readCssColor } from '@/lib/tokens';
import type { GpsInterferenceResponse, GpsJamCell } from '@/lib/types';
import { jamLevel } from '../shared';
import { useHitTester } from './hit-test';
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
      }),
    ];
  }, [items]);

  const byCell = useMemo(() => {
    const m = new Map<string, GpsJamCell>();
    // Daily cells first; a live bin for the same cell (newer) replaces it.
    for (const c of items ?? []) if (!m.has(c.h3) || c.basis === 'live-nacp') m.set(c.h3, c);
    return m;
  }, [items]);

  useHitTester('gps_jam', (_map, e) => {
    const c = byCell.get(latLngToCell(e.lngLat.lat, e.lngLat.wrap().lng, 4));
    if (!c) return null;
    // Daily aggregates cover a UTC day: the card names the day; live bins carry the flights snapshot time.
    const observedAt = c.date ? `${c.date}T23:59:59.000Z` : (data?.meta.fetchedAt ?? null);
    return {
      layer: 'gps_jam',
      distancePx: 0,
      open: () => selectEntity('gps_jam_cell', 'gps_jam', { id: c.h3, lat: c.lat, lng: c.lng, source: c.basis === 'live-nacp' ? 'live_nacp' : 'gpsjam', observedAt }, { ...c, suspect: data?.suspect ?? null }),
    };
  });

  useDeckLayers('hazards:gps_jam', layers, Z);
  return null;
}
