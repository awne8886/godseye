'use client';
/**
 * Surveillance map layers: official camera points (deck ScatterplotLayer over columnar rows),
 * on-map preview tiles at zoom ≥ 13 (DOM, `cctv_previews`), and live-news channel dots (native
 * MapLibre circles). Camera points shrink with zoom (a band per ~2 zoom levels, no stroke and lower
 * opacity when zoomed out) so thousands of cameras never merge into solid blobs; positions are
 * never moved or aggregated. Clicks go through the map-engine pick router (registerDeckPick /
 * registerNativePick) — never a private map click handler. Colours come from `--map-cctv` /
 * `--map-news` and are re-read on every theme / Style Studio / Ghost Protocol change (useStyleVersion).
 *
 * Globe (round 5, visual-qa MAJOR-1): the flat points draw with `cullMode: 'none'` +
 * `depthCompare: 'always'` (never half-clipped by the globe surface), so cameras behind the limb
 * are dropped from the layer's data by the far-side filter (./far-side.ts) at most every 100 ms
 * while the map moves and once when it settles; the pick handler re-checks `isFacing`. Live-news
 * dots are native MapLibre circles, which the globe occludes itself. Owner: layers-surveillance.
 */
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Cell } from '@/lib/columnar';
import type { LayerComponentProps } from '@/lib/feature-module';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useLayerStatusStore, useMapInstance, useMapInstanceStore } from '@/lib/layer-host';
import { cameraFromMap, getFarSideCamera } from '@/lib/map/far-side';
import { registerDeckPick, registerNativePick } from '@/lib/map/picking';
import { useUiStore } from '@/lib/store';
import { useStyleVersion } from '@/lib/map/style-version';
import { readCssColor } from '@/lib/tokens';
import type { NewsChannel } from '@/lib/types';
import { zoomBand } from '../shared';
import CctvPreviews from './CctvPreviews';
import { cameraPointsLayer, cameraSelection, CCTV_DECK_ID, colorKeyOf } from './camera-layer';
import { facingRows, unitVectors } from './far-side';
import { IDX } from './rows';
import { useCctv } from './useCctv';
import { useLiveNewsQuery } from './useLiveNewsQuery';

const Z = LAYERS.find((l) => l.id === 'cctv')!.z;
const NEWS_SOURCE = 'surveillance-live-news';
const NEWS_LAYER = 'surveillance-live-news-dots';

const rgba = ([r, g, b, a]: [number, number, number, number]) => `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;

/** Far-side refilter cadence while the camera moves (plus once on `moveend`), as aviation does. */
const FAR_SIDE_REFILTER_MS = 100;

interface FacingState {
  /** The catalogue these rows were filtered from (a stale state is never returned for new rows). */
  source: readonly Cell[][];
  rows: readonly Cell[][];
  /** Camera (ground lng, lat, altitude m) the rows were filtered with; '' in mercator (e2e/QA). */
  camera: string;
}

/**
 * The catalogue rows on the camera-facing side of the globe (all rows in mercator), refiltered at
 * most every FAR_SIDE_REFILTER_MS while the map moves and once when it settles. The returned array
 * keeps its identity while the visible set is unchanged, so deck re-uploads nothing.
 */
function useFacingRows(rows: Cell[][] | null): FacingState | null {
  const map = useMapInstanceStore((s) => s.map);
  const projection = useMapInstanceStore((s) => s.projection);
  const units = useMemo(() => (rows ? unitVectors(rows, IDX.lng, IDX.lat) : null), [rows]);
  const [state, setState] = useState<FacingState | null>(null);
  const last = useRef<FacingState | null>(null);
  useEffect(() => {
    if (!rows || !units) {
      last.current = null;
      return;
    }
    /** `move`: React hears only of a changed visible set; `settle`: also of the camera it used. */
    const refilter = (kind: 'move' | 'settle') => {
      // The camera's ground point and altitude (pitch-aware), the value the host publishes for isFacing().
      const camera = projection === 'globe' ? (map ? cameraFromMap(map) : getFarSideCamera()) : null;
      const next = facingRows(rows, units, camera, last.current?.rows ?? null) as Cell[][];
      const key = camera ? `${camera.lng.toFixed(3)},${camera.lat.toFixed(3)},${Math.round(camera.altitude)}` : '';
      if (last.current?.source === rows && next === last.current.rows && (kind === 'move' || key === last.current.camera)) return;
      last.current = { source: rows, rows: next, camera: key };
      setState(last.current);
    };
    refilter('settle');
    if (!map) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let lastAt = 0;
    const run = (kind: 'move' | 'settle') => {
      lastAt = Date.now();
      refilter(kind);
    };
    const onMove = () => {
      if (pending) return;
      pending = setTimeout(
        () => {
          pending = undefined;
          run('move');
        },
        Math.max(0, FAR_SIDE_REFILTER_MS - (Date.now() - lastAt)),
      );
    };
    const onEnd = () => {
      if (pending) clearTimeout(pending);
      pending = undefined;
      run('settle');
    };
    map.on('move', onMove);
    map.on('moveend', onEnd);
    return () => {
      map.off('move', onMove);
      map.off('moveend', onEnd);
      if (pending) clearTimeout(pending);
    };
  }, [map, projection, rows, units]);
  return rows && state?.source === rows ? state : null;
}

/** Re-renders only when the zoom crosses a band edge (not on every frame). */
function useZoomBand(): number {
  const map = useMapInstanceStore((s) => s.map);
  const [band, setBand] = useState(() => zoomBand(map?.getZoom() ?? 2));
  useEffect(() => {
    if (!map) return;
    const onZoom = () => setBand(zoomBand(map.getZoom()));
    onZoom();
    map.on('zoom', onZoom);
    return () => {
      map.off('zoom', onZoom);
    };
  }, [map]);
  return band;
}

function useCameraPoints(fetchOn: boolean, active: boolean) {
  const data = useCctv(fetchOn);
  const facing = useFacingRows(active && data ? data.rows : null);
  const theme = useUiStore((s) => s.theme);
  // Ghost Protocol / Style Studio rewrite `--map-cctv` without changing `theme`.
  const styleVersion = useStyleVersion();
  const colorKey = colorKeyOf(theme, styleVersion);
  const band = useZoomBand();
  const visible = facing?.rows ?? null;
  const layers = useMemo(() => {
    if (!active || !visible) return null;
    const colors = { live: readCssColor('--map-cctv', 0.95), still: readCssColor('--map-cctv', 0.75), link: readCssColor('--map-cctv', 0.3) };
    return [cameraPointsLayer(visible, colors, band, colorKey)];
  }, [active, visible, colorKey, band]);
  useDeckLayers('surveillance:cctv', layers, Z);
  // Between two refilters a point can have rotated past the limb: the mapping re-checks isFacing().
  useEffect(() => registerDeckPick(CCTV_DECK_ID, (info) => cameraSelection(info.object, getFarSideCamera())), []);
  return { data, facing };
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
  const styleVersion = useStyleVersion();
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

  // Theme / Style Studio / Ghost Protocol recolour in place.
  useEffect(() => {
    if (!map || !map.getLayer(NEWS_LAYER)) return;
    map.setPaintProperty(NEWS_LAYER, 'circle-color', rgba(readCssColor('--map-news', 0.9)));
    map.setPaintProperty(NEWS_LAYER, 'circle-stroke-color', rgba(readCssColor('--map-news', 1)));
  }, [map, theme, styleVersion]);

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
  const { data, facing } = useCameraPoints(cctvOn, active.has('cctv'));
  useLiveNews(active.has('live_news'));
  return (
    <>
      {/* Drawn vs catalogued cameras and the far-side camera they were filtered with (e2e/QA). */}
      {active.has('cctv') && facing && data && <span hidden data-testid="cctv-far-side" data-drawn={facing.rows.length} data-total={data.rows.length} data-camera={facing.camera} />}
      {active.has('cctv_previews') && data ? <CctvPreviews rows={data.rows} /> : null}
    </>
  );
}
