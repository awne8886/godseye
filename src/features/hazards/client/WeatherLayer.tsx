'use client';
/**
 * Severe weather: every event as a deck point (EONET, NWS, GDACS, NHC, GVP) plus native MapLibre
 * fill/line footprints for NWS alert areas and NHC forecast cones. High-severity events go to the
 * Intel Feed. Owner: layers-hazards.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import { useEffect, useMemo, useRef } from 'react';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useFeedEventStore } from '@/lib/layer-host';
import { readCssColor, type Rgba } from '@/lib/tokens';
import type { WeatherEvent, WeatherResponse } from '@/lib/types';
import { SEVERITY_RADIUS_PX, weatherEvents, weatherToken } from '../shared';
import { nearestPoint, useHitTester } from './hit-test';
import { selectEntity } from './pick';
import { renderedFeatureId, useGeoJsonLayers } from './useGeoJsonLayers';
import { useHazardData } from './useHazardData';

const Z = LAYERS.find((l) => l.id === 'weather')!.z;
const count = (b: WeatherResponse) => b.items.length;
const css = ([r, g, b, a]: Rgba) => `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;

export default function WeatherLayer() {
  const data = useHazardData<WeatherResponse>('weather', '/api/weather', count);
  const items = data?.items;
  const push = useFeedEventStore((s) => s.push);
  const byId = useRef(new Map<string, WeatherEvent>());

  useEffect(() => {
    if (!items) return;
    byId.current = new Map(items.map((e) => [e.id, e]));
    push(weatherEvents(items));
  }, [items, push]);

  const areas = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!items) return null;
    return {
      type: 'FeatureCollection',
      features: items
        .filter((e) => e.geometry)
        .map((e) => ({ type: 'Feature', geometry: e.geometry!, properties: { id: e.id, severity: e.severity, provider: e.provider } })),
    };
  }, [items]);

  const nativeLayers = useMemo(() => {
    const weather = css(readCssColor('--map-weather', 1));
    const high = css(readCssColor('--map-seismic-high', 1));
    const cyclone = css(readCssColor('--map-seismic-low', 1));
    const color = ['case', ['==', ['get', 'provider'], 'NHC'], cyclone, ['==', ['get', 'severity'], 'high'], high, weather] as const;
    return [
      { id: 'hazards-weather-fill', type: 'fill' as const, paint: { 'fill-color': color as unknown as string, 'fill-opacity': 0.12 } },
      { id: 'hazards-weather-line', type: 'line' as const, paint: { 'line-color': color as unknown as string, 'line-width': 1, 'line-opacity': 0.7 } },
    ];
  }, []);

  useGeoJsonLayers('hazards-weather-areas', areas, nativeLayers);

  const layers = useMemo(() => {
    if (!items) return null;
    return [
      new ScatterplotLayer<WeatherEvent>({
        id: 'hazards-weather-points',
        data: items,
        getPosition: (e) => [e.lng, e.lat],
        getRadius: (e) => SEVERITY_RADIUS_PX[e.severity],
        radiusUnits: 'pixels',
        getFillColor: (e) => readCssColor(weatherToken(e), e.severity === 'high' ? 0.85 : 0.6),
        getLineColor: (e) => readCssColor(weatherToken(e), 1),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        pickable: true,
        autoHighlight: true,
      }),
    ];
  }, [items]);

  useDeckLayers('hazards:weather', layers, Z);
  useHitTester('weather', (map, e) => {
    if (!items) return null;
    const pt = nearestPoint(map, e, items, (w) => [w.lng, w.lat], (w) => SEVERITY_RADIUS_PX[w.severity]);
    // A marker beats the footprint it sits in; an area hit counts as far as the slack radius.
    const ev = pt?.item ?? byId.current.get(renderedFeatureId(map, e.point, ['hazards-weather-fill']) ?? '');
    if (!ev) return null;
    return { layer: 'weather', distancePx: pt?.distancePx ?? 12, open: () => selectEntity('weather_event', 'weather', ev, ev as unknown as Record<string, unknown>) };
  });
  return null;
}
