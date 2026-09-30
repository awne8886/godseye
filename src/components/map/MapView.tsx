'use client';
/**
 * The one MapLibre map (§3/§4). Worker recipe: the MapLibre 6 module worker and its shared
 * module are vendored to /maplibre/<version>/ by tools/prepare-map-worker.mjs and wired with
 * setWorkerUrl() here (version from maplibregl.getVersion()). Projection is switched only via
 * {type:'globe'|'mercator'} and `<Map projection>` receives the *effective* projection (mercator
 * while terrain is engaged). Theme, basemap (MAP|SAT) and imagery toggles never remount the map.
 *
 * Also owned here: the WebGL context fallback ladder (constructor rejection and unrecovered
 * context loss), flyTo requests, the camera → store/URL feed (longitudes wrapped), the zero-render
 * cursor/view/far-side feeds, click/hover pick routing (deck + native via choosePick), and the
 * Region Dossier gestures (double right-click, touch long-press). Owner: map-engine.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, type MapLayerMouseEvent, type MapRef, type ViewStateChangeEvent } from 'react-map-gl/maplibre';
import { normalizeLng } from '@/lib/geo';
import { useDeckLayerStore, useLayerStatusStore, useMapInstanceStore, useSelectionStore } from '@/lib/layer-host';
import { publishCursor, publishView } from '@/lib/map/cursor';
import { cameraFromMap, isFacing, setFarSideCamera } from '@/lib/map/far-side';
import { createDoubleRightClick, createLongPress } from '@/lib/map/gestures';
import { BLACK_MARBLE_LABEL, gibsTrueColorLabel } from '@/lib/map/imagery';
import { installNightProtocol, nightLightsSupported } from '@/lib/map/night-lights';
import {
  candidatesFromDeck,
  candidatesFromNative,
  getPickOverlay,
  nativePickLayerIds,
  routePick,
  type DeckPickInfo,
  type NativeFeature,
} from '@/lib/map/picking';
import { installMissingImageResolver } from '@/lib/map/style-images';
import { BASEMAP_STYLE_URL, IMAGERY_BEFORE_ID, firstLabelLayerId, transformStyle } from '@/lib/map/style-transform';
import { attachTerrain, TERRAIN_MAX_PITCH, TERRAIN_STATUS_TEXT, type TerrainStatus } from '@/lib/map/terrain';
import { CONTEXT_ATTRIBUTE_LADDER, effectiveProjection, GLOBE_SKY, initialCamera, normalizeCamera, projectionPitchEase } from '@/lib/map/view';
import { useUiStore } from '@/lib/store';
import BuildingsLayer from './BuildingsLayer';
import DeckOverlay from './DeckOverlay';
import FeatureLayers from './FeatureLayers';
import ImageryChips, { type ImageryChip } from './ImageryChips';
import ImageryLayers, { useGibsDate } from './ImageryLayers';
import TerminatorLayer from './TerminatorLayer';
import WebGLFallback from './WebGLFallback';

maplibregl.setWorkerUrl(`/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);
installNightProtocol(maplibregl.addProtocol as Parameters<typeof installNightProtocol>[0]);

/** A lost WebGL context that is not restored within this window is rebuilt on the next ladder rung. */
const CONTEXT_RESTORE_MS = 4000;
const DEFAULT_MAX_PITCH = 85;

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

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let mapLoads = 0;

export default function MapView() {
  const mapRef = useRef<MapRef | null>(null);
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  // MapView is client-only (ssr:false), so the WebGL2 probe can run in the initializer.
  const [failure, setFailure] = useState<'webgl' | 'style' | null>(() => (hasWebGL2() ? null : 'webgl'));
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [terrainEngaged, setTerrainEngaged] = useState(false);
  const [terrainStatus, setTerrainStatus] = useState<TerrainStatus>('idle');

  const projection = useUiStore((s) => s.projection);
  const basemap = useUiStore((s) => s.basemap);
  const active = useUiStore((s) => s.activeLayers);
  const flyTo = useUiStore((s) => s.flyTo);
  const setCamera = useUiStore((s) => s.setCamera);
  const { setMap, setReady, setProjection } = useMapInstanceStore.getState();

  const dayNight = active.has('day_night');
  const buildings = active.has('terrain_3d');
  const terrainOn = active.has('terrain_elevation');
  const trueColor = active.has('gibs_truecolor');
  const satellite = basemap === 'satellite';
  const effective = effectiveProjection(projection, terrainOn && terrainEngaged);
  const projectionSpec = useMemo(() => ({ type: effective }), [effective]);
  const gibsDate = useGibsDate();

  const webglOk = failure !== 'webgl';
  useEffect(() => {
    if (!webglOk) return;
    const ac = new AbortController();
    let attemptNo = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      loadBasemap(ac.signal)
        .then((s) => {
          setStyle(s);
          setFailure(null);
        })
        .catch(() => {
          if (ac.signal.aborted) return;
          setFailure('style');
          attemptNo++;
          timer = setTimeout(load, Math.min(60_000, 2000 * 2 ** attemptNo));
        });
    load();
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [webglOk]);

  // The instance store and every consumer (deck, far-side filter) see the projection actually applied.
  useEffect(() => {
    setProjection(effective);
    const map = mapRef.current?.getMap();
    setFarSideCamera(effective === 'globe' && map ? cameraFromMap(map) : null);
  }, [effective, setProjection]);

  // User projection switch: flatten the pitch into 2D, tilt a flat camera onto the globe.
  const lastProjection = useRef(projection);
  useEffect(() => {
    if (lastProjection.current === projection) return;
    lastProjection.current = projection;
    const map = mapRef.current?.getMap();
    const ease = map ? projectionPitchEase(projection, map.getPitch()) : null;
    if (map && ease) map.easeTo({ pitch: ease.pitch, duration: reducedMotion() ? 0 : ease.duration });
  }, [projection]);

  // Lazy terrain while the layer is on (engages at z ≥ 10 after a 500 ms settle).
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!terrainOn || !loaded || !map) return;
    const detach = attachTerrain(map, { onStatus: setTerrainStatus, onEngagedChange: setTerrainEngaged });
    return () => {
      detach();
      setTerrainEngaged(false);
      setTerrainStatus('idle');
    };
  }, [terrainOn, loaded]);

  useEffect(() => {
    if (!terrainOn) return;
    const state = terrainStatus === 'error' ? 'offline' : terrainStatus === 'loading' ? 'loading' : terrainStatus === 'ready' ? 'reference' : 'idle';
    useLayerStatusStore.getState().update('terrain_elevation', {
      state,
      error: terrainStatus === 'error' ? TERRAIN_STATUS_TEXT.error : undefined,
    });
  }, [terrainOn, terrainStatus]);

  // flyTo requests (ts-stamped so identical targets re-fire); longitudes wrapped first.
  useEffect(() => {
    const map = mapRef.current;
    if (!flyTo || !map || !loaded) return;
    const { lng, lat, zoom, pitch, bearing, durationMs } = flyTo;
    map.flyTo({ center: [normalizeLng(lng), lat], zoom, pitch, bearing, duration: reducedMotion() ? 0 : (durationMs ?? 2000), essential: false });
  }, [flyTo, loaded]);

  const labelAnchor = useMemo(() => (style ? firstLabelLayerId(style) : undefined), [style]);
  const imageryAnchor = useMemo(() => (style?.layers.some((l) => l.id === IMAGERY_BEFORE_ID) ? IMAGERY_BEFORE_ID : labelAnchor), [style, labelAnchor]);
  const hasStyle = style !== null;
  // Computed when the map is about to mount so a camera restored from the URL (?c=) wins.
  const initialView = useMemo(() => {
    const c = useUiStore.getState().camera;
    return c
      ? { longitude: normalizeLng(c.lng), latitude: c.lat, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing }
      : initialCamera(new Date().getTimezoneOffset());
  }, [hasStyle, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Runs as soon as react-map-gl has constructed the map (before any tile asks for sprite images).
  const attachMapRef = useCallback((r: MapRef | null) => {
    mapRef.current = r;
    const map = r?.getMap();
    const el = map?.getContainer();
    if (!map || !el || el.dataset.mapLoads) return;
    mapLoads++;
    el.dataset.mapLoads = String(mapLoads);
    installMissingImageResolver(map);
    // Host features that only need the parsed style (terrain, gestures, flyTo) do not wait for every
    // tile: `style.load` fires first; `load` covers a style that finished before we subscribed.
    const styleReady = () => setLoaded(true);
    map.once('style.load', styleReady);
    map.once('load', styleReady);
  }, []);

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap() ?? null;
    if (!map) return;
    setMap(map);
    setLoaded(true);
    map.once('idle', () => {
      setReady(true);
      map.getContainer().dataset.mapReady = 'true';
    });
  }, [setMap, setReady]);

  // Constructor rejected the context, or it never came back: next rung of the ladder, then give up.
  const attemptRef = useRef(attempt);
  const nextRung = useCallback(() => {
    setLoaded(false);
    setMap(null);
    const next = attemptRef.current + 1;
    if (next < CONTEXT_ATTRIBUTE_LADDER.length) {
      attemptRef.current = next;
      setAttempt(next);
    } else setFailure('webgl');
  }, [setMap]);

  // WebGL context loss: MapLibre restores its own style; deck layers are re-applied on restore.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    const canvas = map.getCanvas();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lost = (e: Event) => {
      e.preventDefault(); // allow the browser to restore it
      setContextLost(true);
      timer = setTimeout(nextRung, CONTEXT_RESTORE_MS);
    };
    const restored = () => {
      clearTimeout(timer);
      setContextLost(false);
      map.triggerRepaint();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      clearTimeout(timer);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, [loaded, nextRung]);

  const onMove = useCallback((e: ViewStateChangeEvent) => {
    const v = e.viewState;
    publishView({ lng: normalizeLng(v.longitude), lat: v.latitude, zoom: v.zoom });
    if (useMapInstanceStore.getState().projection === 'globe') setFarSideCamera(cameraFromMap(e.target));
  }, []);

  const onMoveEnd = useCallback(
    (e: ViewStateChangeEvent) => {
      const cam = normalizeCamera(e.viewState);
      setCamera(cam);
      e.target.getContainer().dataset.camera = `${cam.lat.toFixed(4)},${cam.lng.toFixed(4)},${cam.zoom.toFixed(2)},${cam.pitch.toFixed(1)},${cam.bearing.toFixed(1)}`;
      const far = useMapInstanceStore.getState().projection === 'globe' ? cameraFromMap(e.target) : null;
      e.target.getContainer().dataset.farSide = far ? `${far.lng.toFixed(4)},${far.lat.toFixed(4)},${Math.round(far.altitude)}` : 'none';
    },
    [setCamera],
  );

  // ── Picking ──────────────────────────────────────────────────────────────────
  /** Everything selectable under (x, y); `hover` asks deck for the top object only (cheap). */
  const pickAt = useCallback((map: maplibregl.Map, x: number, y: number, hover = false) => {
    let deck: DeckPickInfo[] = [];
    const overlay = useDeckLayerStore.getState().version > 0 ? getPickOverlay() : null;
    try {
      if (overlay) deck = hover ? [overlay.pickObject({ x, y, radius: 4 })].filter((i): i is DeckPickInfo => !!i) : overlay.pickMultipleObjects({ x, y, radius: 4, depth: 10 });
    } catch {
      deck = []; // deck not initialised yet (first frames, context restore)
    }
    const ids = nativePickLayerIds().filter((id) => map.getLayer(id));
    const native = ids.length ? (map.queryRenderedFeatures([x, y], { layers: ids }) as unknown as NativeFeature[]) : [];
    const far = useMapInstanceStore.getState().projection === 'globe' ? cameraFromMap(map) : null;
    // Billboards behind the globe still pick (§3): drop candidates beyond the horizon.
    return [...candidatesFromDeck(deck), ...candidatesFromNative(native)].filter((c) => !c.selection.lngLat || isFacing(c.selection.lngLat, far));
  }, []);

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const sel = routePick(pickAt(e.target, e.point.x, e.point.y));
      if (sel) useSelectionStore.getState().select(sel);
    },
    [pickAt],
  );

  const hoverFrame = useRef(0);
  const onMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      const { lng, lat } = e.lngLat;
      const map = e.target;
      const { x, y } = e.point;
      cancelAnimationFrame(hoverFrame.current);
      hoverFrame.current = requestAnimationFrame(() => {
        publishCursor({ lng: normalizeLng(lng), lat, zoom: map.getZoom() });
        if (map.isMoving()) return;
        map.getCanvas().style.cursor = pickAt(map, x, y, true).length ? 'pointer' : '';
      });
    },
    [pickAt],
  );
  const onMouseOut = useCallback(() => {
    cancelAnimationFrame(hoverFrame.current);
    publishCursor(null);
  }, []);

  // ── Region Dossier gestures ───────────────────────────────────────────────────
  const doubleRight = useMemo(() => createDoubleRightClick(), []);
  const onContextMenu = useCallback(
    (e: MapLayerMouseEvent) => {
      e.preventDefault();
      if (doubleRight(e.point.x, e.point.y, e.originalEvent.timeStamp)) {
        useUiStore.getState().openDossier({ lat: e.lngLat.lat, lng: normalizeLng(e.lngLat.lng) });
      }
    },
    [doubleRight],
  );

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    const canvas = map.getCanvas();
    const local = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const press = createLongPress((x, y) => {
      const ll = map.unproject([x, y]);
      useUiStore.getState().openDossier({ lat: ll.lat, lng: normalizeLng(ll.lng) });
    });
    const down = (e: PointerEvent) => e.pointerType === 'touch' && press.down(...local(e), e.pointerId);
    const move = (e: PointerEvent) => e.pointerType === 'touch' && press.move(...local(e), e.pointerId);
    const up = (e: PointerEvent) => e.pointerType === 'touch' && press.up();
    const cancel = () => press.cancel();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    map.on('movestart', cancel);
    return () => {
      press.cancel();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      map.off('movestart', cancel);
    };
  }, [loaded]);

  useEffect(
    () => () => {
      setMap(null);
      setFarSideCamera(null);
    },
    [setMap],
  );

  const chips = useMemo(() => {
    const out: ImageryChip[] = [];
    if (dayNight && nightLightsSupported()) out.push({ id: 'night', text: BLACK_MARBLE_LABEL });
    if (trueColor) out.push({ id: 'gibs', text: gibsTrueColorLabel(gibsDate) });
    if (satellite) out.push({ id: 'esri', text: 'ESRI WORLD IMAGERY · REFERENCE' });
    if (terrainOn) out.push({ id: 'terrain', text: TERRAIN_STATUS_TEXT[terrainStatus] });
    return out;
  }, [dayNight, trueColor, satellite, terrainOn, terrainStatus, gibsDate]);

  if (failure === 'webgl') return <WebGLFallback reason="webgl" />;
  if (!style) return failure === 'style' ? <WebGLFallback reason="style" /> : null;

  return (
    <div className="absolute inset-0" data-testid="map-root" data-projection={effective} data-basemap={basemap}>
      <Map
        key={attempt}
        ref={attachMapRef}
        mapLib={maplibregl}
        mapStyle={style}
        initialViewState={initialView}
        projection={projectionSpec}
        sky={GLOBE_SKY}
        minZoom={1.2}
        maxZoom={18}
        maxPitch={terrainOn ? TERRAIN_MAX_PITCH : DEFAULT_MAX_PITCH}
        canvasContextAttributes={CONTEXT_ATTRIBUTE_LADDER[attempt]}
        attributionControl={{ compact: false }}
        dragRotate
        onLoad={onLoad}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        onClick={onClick}
        onMouseMove={onMouseMove}
        onMouseOut={onMouseOut}
        onContextMenu={onContextMenu}
        onError={(e) => {
          if (e.error instanceof maplibregl.GPUInitializationError || (!loaded && /webgl/i.test(e.error?.message ?? ''))) nextRung();
          else if (process.env.NODE_ENV !== 'production') console.warn('[map]', e.error?.message);
        }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <ImageryLayers beforeId={imageryAnchor} satellite={satellite} trueColor={trueColor} gibsDate={gibsDate} />
        <BuildingsLayer beforeId={labelAnchor} visible={buildings} />
        <TerminatorLayer beforeId={labelAnchor} visible={dayNight} />
        <DeckOverlay beforeId={labelAnchor} />
        <FeatureLayers />
        <ImageryChips chips={chips} />
      </Map>
      {contextLost && (
        <div role="status" className="hud-micro pointer-events-none absolute inset-x-0 top-1/2 text-center text-[var(--alert-orange)]">
          GPU CONTEXT LOST · RESTORING
        </div>
      )}
    </div>
  );
}
