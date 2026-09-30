'use client';
/**
 * The one MapLibre map (§3/§4). Worker recipe: the MapLibre 6 module worker and its shared
 * module are vendored to /maplibre/<version>/ by tools/prepare-map-worker.mjs and wired with
 * setWorkerUrl() here. Projection is switched only via {type:'globe'|'mercator'}; the theme never
 * remounts the map. Owner: map-engine.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, type MapRef, type ViewStateChangeEvent } from 'react-map-gl/maplibre';
import { BASEMAP_STYLE_URL, firstLabelLayerId, transformStyle } from '@/lib/map/style-transform';
import { GLOBE_SKY, initialCamera } from '@/lib/map/view';
import { useMapInstanceStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import DeckOverlay from './DeckOverlay';
import FeatureLayers from './FeatureLayers';
import TerminatorLayer from './TerminatorLayer';
import WebGLFallback from './WebGLFallback';

maplibregl.setWorkerUrl(`/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function loadBasemap(signal: AbortSignal): Promise<StyleSpecification> {
  const res = await fetch(BASEMAP_STYLE_URL, { signal, credentials: 'omit' });
  if (!res.ok) throw new Error(`basemap style HTTP ${res.status}`);
  return transformStyle((await res.json()) as StyleSpecification);
}

export default function MapView() {
  const mapRef = useRef<MapRef>(null);
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  // MapView is client-only (ssr:false), so the WebGL2 probe can run in the initializer.
  const [failure, setFailure] = useState<'webgl' | 'style' | null>(() => (hasWebGL2() ? null : 'webgl'));
  const projection = useUiStore((s) => s.projection);
  const dayNight = useUiStore((s) => s.activeLayers.has('day_night'));
  const flyTo = useUiStore((s) => s.flyTo);
  const setCamera = useUiStore((s) => s.setCamera);
  const { setMap, setReady, setProjection } = useMapInstanceStore.getState();

  const webglOk = failure !== 'webgl';
  useEffect(() => {
    if (!webglOk) return;
    const ac = new AbortController();
    let attempt = 0;
    const load = () =>
      loadBasemap(ac.signal)
        .then((s) => {
          setStyle(s);
          setFailure(null);
        })
        .catch(() => {
          if (ac.signal.aborted) return;
          setFailure('style');
          attempt++;
          setTimeout(load, Math.min(60_000, 2000 * 2 ** attempt));
        });
    load();
    return () => ac.abort();
  }, [webglOk]);

  useEffect(() => {
    setProjection(projection);
  }, [projection, setProjection]);

  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    const { lng, lat, zoom, pitch, bearing, durationMs } = flyTo;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    mapRef.current.flyTo({ center: [lng, lat], zoom, pitch, bearing, duration: reduce ? 0 : (durationMs ?? 2000), essential: false });
  }, [flyTo]);

  const labelAnchor = useMemo(() => (style ? firstLabelLayerId(style) : undefined), [style]);
  const hasStyle = style !== null;
  // Computed when the map is about to mount so a camera restored from the URL (?c=) wins.
  const initialView = useMemo(() => {
    const c = useUiStore.getState().camera;
    return c ? { longitude: c.lng, latitude: c.lat, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing } : initialCamera(new Date().getTimezoneOffset());
  }, [hasStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap() ?? null;
    setMap(map);
    map?.once('idle', () => setReady(true));
  }, [setMap, setReady]);

  const onMoveEnd = useCallback(
    (e: ViewStateChangeEvent) => {
      const v = e.viewState;
      setCamera({ lng: v.longitude, lat: v.latitude, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
    },
    [setCamera],
  );

  useEffect(() => () => setMap(null), [setMap]);

  if (failure === 'webgl') return <WebGLFallback reason="webgl" />;
  if (!style) return failure === 'style' ? <WebGLFallback reason="style" /> : null;

  return (
    <Map
      ref={mapRef}
      mapLib={maplibregl}
      mapStyle={style}
      initialViewState={initialView}
      projection={{ type: projection }}
      sky={GLOBE_SKY}
      minZoom={1.2}
      maxZoom={18}
      maxPitch={85}
      attributionControl={{ compact: false }}
      dragRotate
      onLoad={onLoad}
      onMoveEnd={onMoveEnd}
      onError={(e) => {
        if (e.error instanceof maplibregl.GPUInitializationError) setFailure('webgl');
        else if (process.env.NODE_ENV !== 'production') console.warn('[map]', e.error?.message);
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <TerminatorLayer beforeId={labelAnchor} visible={dayNight} />
      <DeckOverlay beforeId={labelAnchor} />
      <FeatureLayers />
    </Map>
  );
}
