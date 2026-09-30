'use client';
/**
 * Surveillance map layers: official camera points (deck ScatterplotLayer over columnar rows),
 * on-map preview tiles at zoom ≥ 13 (DOM, `cctv_previews`), and live-news channel dots (native
 * MapLibre circles). Clicks go through the map-engine pick router (registerDeckPick /
 * registerNativePick) — never a private map click handler. Colours come from `--map-cctv` /
 * `--map-news` and are re-read when the theme changes. Owner: layers-surveillance.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo } from 'react';
import type { Cell } from '@/lib/columnar';
import type { LayerComponentProps } from '@/lib/feature-module';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useLayerStatusStore, useMapInstance } from '@/lib/layer-host';
import { registerDeckPick, registerNativePick } from '@/lib/map/picking';
import { useUiStore } from '@/lib/store';
import { readCssColor } from '@/lib/tokens';
import type { NewsChannel } from '@/lib/types';
import CctvPreviews from './CctvPreviews';
import { IDX, rowToCamera } from './rows';
import { useCctv } from './useCctv';
import { useLiveNewsQuery } from './useLiveNewsQuery';

const Z = LAYERS.find((l) => l.id === 'cctv')!.z;
const DECK_ID = 'surveillance-cctv';
const NEWS_SOURCE = 'surveillance-live-news';
const NEWS_LAYER = 'surveillance-live-news-dots';

const rgba = ([r, g, b, a]: [number, number, number, number]) => `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;

function useCameraPoints(fetchOn: boolean, active: boolean) {
  const data = useCctv(fetchOn);
  const theme = useUiStore((s) => s.theme);
  const layers = useMemo(() => {
    if (!active || !data) return null;
    const live = readCssColor('--map-cctv', 0.95);
    const still = readCssColor('--map-cctv', 0.75);
    const link = readCssColor('--map-cctv', 0.3);
    return [
      new ScatterplotLayer<Cell[]>({
        id: DECK_ID,
        data: data.rows,
        getPosition: (r) => [r[IDX.lng] as number, r[IDX.lat] as number],
        getRadius: (r) => (r[IDX.streamType] === 'hls' || r[IDX.streamType] === 'mp4' ? 4 : 3),
        radiusUnits: 'pixels',
        radiusMinPixels: 2,
        getFillColor: (r) => (r[IDX.streamType] === 'link' ? link : r[IDX.streamType] === 'hls' || r[IDX.streamType] === 'mp4' ? live : still),
        stroked: true,
        getLineColor: (r) => (r[IDX.streamType] === 'link' ? still : live),
        lineWidthUnits: 'pixels',
        getLineWidth: 0.75,
        pickable: true,
        autoHighlight: true,
        updateTriggers: { getFillColor: theme, getLineColor: theme },
      }),
    ];
  }, [active, data, theme]);
  useDeckLayers('surveillance:cctv', layers, Z);
  useEffect(
    () =>
      registerDeckPick(DECK_ID, (info) => {
        const row = info.object as Cell[] | undefined;
        if (!Array.isArray(row)) return null;
        const c = rowToCamera(row);
        return { kind: 'camera', id: c.id, layer: 'cctv', source: c.source, observedAt: c.observedAt, data: c as unknown as Record<string, unknown>, lngLat: [c.lng, c.lat] };
      }),
    [],
  );
  return data;
}

function ensureNewsLayer(map: MapLibreMap, fc: GeoJSON.FeatureCollection) {
  if (!map.getStyle()) return;
  const src = map.getSource(NEWS_SOURCE) as GeoJSONSource | undefined;
  if (src) src.setData(fc);
  else map.addSource(NEWS_SOURCE, { type: 'geojson', data: fc });
  if (!map.getLayer(NEWS_LAYER)) {
    const before = map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
    map.addLayer(
      {
        id: NEWS_LAYER,
        type: 'circle',
        source: NEWS_SOURCE,
        paint: {
          'circle-radius': 6,
          'circle-color': rgba(readCssColor('--map-news', 0.9)),
          'circle-stroke-color': rgba(readCssColor('--map-news', 1)),
          'circle-stroke-width': ['case', ['==', ['get', 'live'], true], 3, 1],
          'circle-stroke-opacity': 0.6,
          'circle-pitch-alignment': 'map',
        },
      },
      before,
    );
  }
}

function useLiveNews(active: boolean) {
  const map = useMapInstance();
  const update = useLayerStatusStore((s) => s.update);
  const theme = useUiStore((s) => s.theme);
  const q = useLiveNewsQuery(active);
  const items = q.data?.ok ? q.data.body.items : null;

  useEffect(() => {
    if (!active) return;
    if (q.isPending) update('live_news', { state: 'loading' });
    else if (q.data?.ok) {
      const b = q.data.body;
      update('live_news', { state: b.meta.state, count: b.items.length, fetchedAt: b.meta.fetchedAt, observedAt: b.meta.observedAt, lastGoodAt: b.meta.lastGoodAt, providers: b.providers, attribution: b.meta.attribution, error: undefined });
    } else if (q.data || q.isError) update('live_news', { state: 'offline', count: null, lastGoodAt: q.data?.body.meta?.lastGoodAt ?? null, error: 'source_offline', providers: q.data?.body.providers });
  }, [active, q.data, q.isPending, q.isError, update]);

  const fc = useMemo<GeoJSON.FeatureCollection | null>(
    () =>
      items && {
        type: 'FeatureCollection',
        features: items.map((c) => ({ type: 'Feature', id: c.id, geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { id: c.id, name: c.name, live: c.live } })),
      },
    [items],
  );

  useEffect(() => {
    if (!map || !active || !fc) return;
    const apply = () => ensureNewsLayer(map, fc);
    apply();
    map.on('styledata', apply);
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    map.on('mouseenter', NEWS_LAYER, enter);
    map.on('mouseleave', NEWS_LAYER, leave);
    return () => {
      map.off('styledata', apply);
      map.off('mouseenter', NEWS_LAYER, enter);
      map.off('mouseleave', NEWS_LAYER, leave);
      try {
        if (map.getStyle() && map.getLayer(NEWS_LAYER)) map.removeLayer(NEWS_LAYER);
        if (map.getStyle() && map.getSource(NEWS_SOURCE)) map.removeSource(NEWS_SOURCE);
      } catch {
        // map torn down
      }
    };
  }, [map, active, fc]);

  // Theme recolour in place.
  useEffect(() => {
    if (!map || !map.getLayer(NEWS_LAYER)) return;
    map.setPaintProperty(NEWS_LAYER, 'circle-color', rgba(readCssColor('--map-news', 0.9)));
    map.setPaintProperty(NEWS_LAYER, 'circle-stroke-color', rgba(readCssColor('--map-news', 1)));
  }, [map, theme]);

  useEffect(() => {
    if (!items) return;
    const byId = new Map(items.map((c) => [c.id, c]));
    return registerNativePick(NEWS_LAYER, (f) => {
      const c: NewsChannel | undefined = byId.get(String(f.properties?.id ?? ''));
      return c ? { kind: 'news_channel', id: c.id, layer: 'live_news', source: c.source, observedAt: c.observedAt, data: c as unknown as Record<string, unknown>, lngLat: [c.lng, c.lat] } : null;
    });
  }, [items]);
}

export default function SurveillanceLayer({ active }: LayerComponentProps) {
  const cctvOn = active.has('cctv') || active.has('cctv_previews');
  const data = useCameraPoints(cctvOn, active.has('cctv'));
  useLiveNews(active.has('live_news'));
  return active.has('cctv_previews') && data ? <CctvPreviews rows={data.rows} /> : null;
}
