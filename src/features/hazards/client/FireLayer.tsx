'use client';
/**
 * NASA FIRMS fires: up to 30 000 FRP-ranked pixels drawn from FIRE_FIELDS columnar rows through
 * binary attributes (typed arrays, no per-row objects), radius by FRP and opacity by confidence;
 * EONET open wildfire events as ringed markers. Owner: layers-hazards.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import { useEffect, useMemo } from 'react';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useFeedEventStore } from '@/lib/layer-host';
import { readCssColor } from '@/lib/tokens';
import type { FiresResponse, WeatherEvent } from '@/lib/types';
import { FIRE_CONFIDENCE_ALPHA, FIRE_IDX as IDX, fireEvents, fireRadiusPx, fireRowObject } from '../shared';
import { selectEntity } from './pick';
import { useHazardData } from './useHazardData';

const Z = LAYERS.find((l) => l.id === 'fires')!.z;
const count = (b: FiresResponse) => b.rows.length;

export default function FireLayer() {
  const data = useHazardData<FiresResponse>('fires', '/api/fires', count);
  const push = useFeedEventStore((s) => s.push);

  useEffect(() => {
    if (!data) return;
    push(fireEvents(data.rows.slice(0, 50).map(fireRowObject)));
  }, [data, push]);

  const layers = useMemo(() => {
    if (!data) return null;
    const rows = data.rows;
    const n = rows.length;
    const positions = new Float32Array(n * 2);
    const radii = new Float32Array(n);
    const colors = new Uint8Array(n * 4);
    const [r, g, b] = readCssColor('--map-fire');
    for (let i = 0; i < n; i++) {
      const row = rows[i]!;
      positions[i * 2] = row[IDX.lng] as number;
      positions[i * 2 + 1] = row[IDX.lat] as number;
      radii[i] = fireRadiusPx(row[IDX.frpMw] as number | null);
      colors[i * 4] = r;
      colors[i * 4 + 1] = g;
      colors[i * 4 + 2] = b;
      colors[i * 4 + 3] = Math.round(255 * FIRE_CONFIDENCE_ALPHA[row[IDX.confidence] as keyof typeof FIRE_CONFIDENCE_ALPHA]);
    }
    const wildfires = data.wildfireEvents ?? [];
    return [
      new ScatterplotLayer({
        id: 'hazards-fires',
        data: { length: n, attributes: { getPosition: { value: positions, size: 2 }, getRadius: { value: radii, size: 1 }, getFillColor: { value: colors, size: 4, normalized: true } } },
        radiusUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        onClick: ({ index }) => {
          const row = rows[index];
          if (!row) return false;
          const o = fireRowObject(row);
          selectEntity('fire', 'fires', o, o);
          return true;
        },
      }),
      new ScatterplotLayer<WeatherEvent>({
        id: 'hazards-wildfire-events',
        data: wildfires,
        getPosition: (e) => [e.lng, e.lat],
        getRadius: 9,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: readCssColor('--map-volcano', 0.9),
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        pickable: true,
        onClick: ({ object }) => {
          if (!object) return false;
          selectEntity('weather_event', 'fires', object, object as unknown as Record<string, unknown>);
          return true;
        },
      }),
    ];
  }, [data]);

  useDeckLayers('hazards:fires', layers, Z);
  return null;
}
