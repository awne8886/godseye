'use client';
/**
 * USGS earthquakes: magnitude-scaled points plus magnitude rings drawn as geodesic outlines
 * (PathLayer, never a deck "big circle" on the globe). Significant quakes go to the Intel Feed.
 * Owner: layers-hazards.
 */
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { useEffect, useMemo } from 'react';
import { geodesicCircle, type LngLatTuple } from '@/lib/geo';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useFeedEventStore } from '@/lib/layer-host';
import { readCssColor } from '@/lib/tokens';
import type { Earthquake, EarthquakesResponse } from '@/lib/types';
import { magnitudeRingKm, quakeEvents, quakeRadiusPx, quakeToken } from '../shared';
import { selectEntity } from './pick';
import { useHazardData } from './useHazardData';

const Z = LAYERS.find((l) => l.id === 'earthquakes')!.z;
const count = (b: EarthquakesResponse) => b.items.length;

interface Ring {
  id: string;
  path: LngLatTuple[];
  magnitude: number;
}

export default function EarthquakeLayer() {
  const data = useHazardData<EarthquakesResponse>('earthquakes', '/api/earthquakes', count);
  const items = data?.items;
  const push = useFeedEventStore((s) => s.push);

  useEffect(() => {
    if (items) push(quakeEvents(items));
  }, [items, push]);

  const layers = useMemo(() => {
    if (!items) return null;
    const rings: Ring[] = items
      .filter((q) => q.magnitude >= 4.5)
      .map((q) => ({ id: q.id, magnitude: q.magnitude, path: geodesicCircle([q.lng, q.lat], magnitudeRingKm(q.magnitude), 96) }));
    // Largest first so small quakes draw on top and stay clickable.
    const points = [...items].sort((a, b) => b.magnitude - a.magnitude);
    return [
      new PathLayer<Ring>({
        id: 'hazards-quake-rings',
        data: rings,
        getPath: (r) => r.path,
        getColor: (r) => readCssColor(quakeToken(r.magnitude), 0.55),
        getWidth: 1.25,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        pickable: false,
        antialiasing: true,
        parameters: { cullMode: 'none' },
      }),
      new ScatterplotLayer<Earthquake>({
        id: 'hazards-quakes',
        data: points,
        getPosition: (q) => [q.lng, q.lat],
        getRadius: (q) => quakeRadiusPx(q.magnitude),
        radiusUnits: 'pixels',
        getFillColor: (q) => readCssColor(quakeToken(q.magnitude), 0.75),
        getLineColor: (q) => readCssColor(quakeToken(q.magnitude), 1),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        pickable: true,
        autoHighlight: true,
        onClick: ({ object }) => {
          if (!object) return false;
          selectEntity('earthquake', 'earthquakes', object, object as unknown as Record<string, unknown>);
          return true;
        },
      }),
    ];
  }, [items]);

  useDeckLayers('hazards:earthquakes', layers, Z);
  return null;
}
