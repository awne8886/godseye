'use client';
/**
 * USGS earthquakes: magnitude-scaled deck points plus magnitude rings drawn as geodesic outlines in a
 * native MapLibre line layer (draped on the globe without z-fighting; never a deck "big circle").
 * Significant quakes go to the Intel Feed. On the globe the markers draw without the depth test (the
 * surface clipped them into half-discs) and only on the camera-facing side (globe.tsx).
 * Owner: layers-hazards.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import { useEffect, useMemo } from 'react';
import { geodesicCircle } from '@/lib/geo';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useFeedEventStore } from '@/lib/layer-host';
import { useStyleVersion } from '@/lib/map/style-version';
import { readCssColor, type Rgba } from '@/lib/tokens';
import type { Earthquake, EarthquakesResponse } from '@/lib/types';
import { magnitudeRingKm, quakeEvents, quakeRadiusPx, quakeToken } from '../shared';
import { nearestPoint, useHitTester } from './hit-test';
import { DrawnStatus, GLOBE_POINT_PARAMETERS, useFacing, useFarSideCamera } from './globe';
import { entitySelection } from './pick';
import { useGeoJsonLayers } from '@/lib/map/use-geojson-layers';
import { useHazardData } from './useHazardData';

const Z = LAYERS.find((l) => l.id === 'earthquakes')!.z;
const count = (b: EarthquakesResponse) => b.items.length;

const rgba = ([r, g, b, a]: Rgba) => `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
const RING_LAYERS = [{ id: 'hazards-quake-rings', type: 'line' as const, paint: { 'line-color': ['get', 'color'] as unknown as string, 'line-width': 1.25 } }];

export default function EarthquakeLayer() {
  const data = useHazardData<EarthquakesResponse>('earthquakes', '/api/earthquakes', count);
  const items = data?.items;
  const push = useFeedEventStore((s) => s.push);
  // Style Studio / Ghost Protocol rewrite `--map-*` tokens without a data change.
  const styleVersion = useStyleVersion();

  useEffect(() => {
    if (items) push(quakeEvents(items));
  }, [items, push]);

  // No body (loading, or SOURCE OFFLINE after a 503) → an empty collection, never null:
  // useGeoJsonLayers keeps the previous data on null, which left last-good rings drawn (and
  // unclickable) while the deck points and the rail had already cleared (round 7).
  const rings = useMemo<GeoJSON.FeatureCollection>(() => {
    return {
      type: 'FeatureCollection',
      features: (items ?? [])
        .filter((q) => q.magnitude >= 4.5)
        .map((q) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: geodesicCircle([q.lng, q.lat], magnitudeRingKm(q.magnitude), 96) },
          properties: { id: q.id, color: rgba(readCssColor(quakeToken(q.magnitude), 0.55)) },
        })),
    };
    // Ring colours live in the features: rebuilt (setData) on every style change.
  }, [items, styleVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useGeoJsonLayers('hazards-quake-rings', rings, RING_LAYERS);

  // Largest first so small quakes draw on top and stay clickable.
  const sorted = useMemo(() => (items ? [...items].sort((a, b) => b.magnitude - a.magnitude) : undefined), [items]);
  const camera = useFarSideCamera();
  const points = useFacing(sorted, camera);

  const layers = useMemo(() => {
    if (!points) return null;
    return [
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
        billboard: true,
        parameters: GLOBE_POINT_PARAMETERS,
        pickable: true,
        autoHighlight: true,
        updateTriggers: { getFillColor: styleVersion, getLineColor: styleVersion },
      }),
    ];
  }, [points, styleVersion]);

  useDeckLayers('hazards:earthquakes', layers, Z);
  useHitTester('earthquakes', (map, e) => {
    const hit = items && nearestPoint(map, e, items, (q) => [q.lng, q.lat], (q) => quakeRadiusPx(q.magnitude));
    return hit ? { layer: 'earthquakes', distancePx: hit.distancePx, selection: entitySelection('earthquake', 'earthquakes', hit.item, hit.item as unknown as Record<string, unknown>) } : null;
  });
  return <DrawnStatus layer="earthquakes" drawn={points?.length ?? 0} total={items?.length ?? 0} camera={camera} />;
}
