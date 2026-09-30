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
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, type MapLayerMouseEvent, type MapRef, type ViewStateChangeEvent } from 'react-map-gl/maplibre';
import { normalizeLng } from '@/lib/geo';
import { useDeckLayerStore, useLayerStatusStore, useMapInstanceStore, useSelectionStore } from '@/lib/layer-host';
import { publishCursor, publishView } from '@/lib/map/cursor';
import { cameraFromMap, isFacing, setFarSideCamera } from '@/lib/map/far-side';
import { createDoubleRightClick, createLongPress } from '@/lib/map/gestures';
import { BLACK_MARBLE_LABEL, ESRI_LABEL, gibsTrueColorLabel } from '@/lib/map/imagery';
import { geometryClient } from '@/lib/map/geometry-client';
import { installNightProtocol, nightLightsSupported } from '@/lib/map/night-lights';
import { collectCandidates, routePick, setHoverPointer, type PickMap } from '@/lib/map/picking';
import { basemapChipText, createBasemapHealth, type BasemapHealth } from '@/lib/map/basemap-health';
import { dossierDeepLinkCamera, nextCameraRequest } from '@/lib/map/camera';
import { hoverAllowed, isPrimaryClick } from '@/lib/map/deck-events';
import { onceStyleLoaded, styleParsed } from '@/lib/map/ready';
import { useStyleVersion } from '@/lib/map/style-version';
import { useAfterIdle, useSticky } from '@/lib/map/defer';
import { installMissingImageResolver } from '@/lib/map/style-images';
import {
  BASEMAP_ATTRIBUTION,
  BASEMAP_SOURCE_ID,
  BASEMAP_STYLE_URL,
  IMAGERY_BEFORE_ID,
  firstLabelLayerId,
  inlineTileJson,
  paintDiff,
  parseTileJson,
  themedBasemap,
  tileJsonUrl,
  transformStyle,
} from '@/lib/map/style-transform';
import { attachTerrain, TERRAIN_MAX_PITCH, TERRAIN_STATUS_TEXT, type TerrainStatus } from '@/lib/map/terrain';
import { CONTEXT_ATTRIBUTE_LADDER, effectiveProjection, GLOBE_SKY, initialCamera, normalizeCamera, projectionPitchEase } from '@/lib/map/view';
import { useUiStore } from '@/lib/store';
import BuildingsLayer from './BuildingsLayer';
import ImageryChips, { type ImageryChip } from './ImageryChips';
import ImageryLayers, { useGibsDate } from './ImageryLayers';
import TerminatorLayer from './TerminatorLayer';
import WebGLFallback from './WebGLFallback';

// deck.gl/luma and every feature module are split out of the map chunk and only load once the
// basemap has loaded and the browser is idle (§11 TBT budget); the globe paints first.
const DeckOverlay = dynamic(() => import('./DeckOverlay'), { ssr: false });
const FeatureLayers = dynamic(() => import('./FeatureLayers'), { ssr: false });

maplibregl.setWorkerUrl(`/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);
// Night-lights tiles are fetched, clipped and encoded in the geometry worker when it can start.
installNightProtocol(
  maplibregl.addProtocol as Parameters<typeof installNightProtocol>[0],
  geometryClient().hasWorker() ? (url, signal) => geometryClient().nightTile(url, signal) : undefined,
);

/** A lost WebGL context that is not restored within this window is rebuilt on the next ladder rung. */
const CONTEXT_RESTORE_MS = 4000;
const DEFAULT_MAX_PITCH = 85;

/**
 * API presence only. Creating a throw-away WebGL2 context to probe costs a synchronous GPU
 * round-trip (seconds under SwiftShader, the Lighthouse/CI renderer); a browser that has the API
 * but cannot give MapLibre a context is caught by the constructor and the context ladder below.
 */
function hasWebGL2(): boolean {
  return typeof window !== 'undefined' && typeof window.WebGL2RenderingContext === 'function';
}

const cssVar = (name: string) => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name));

async function loadBasemap(signal: AbortSignal): Promise<StyleSpecification> {
  const res = await fetch(BASEMAP_STYLE_URL, { signal, credentials: 'omit' });
  if (!res.ok) throw new Error(`basemap style HTTP ${res.status}`);
  let raw = (await res.json()) as StyleSpecification;
  // Inline the vector TileJSON so its failure is retried with the style (no blank globe).
  const tj = tileJsonUrl(raw);
  if (tj) {
    const r = await fetch(tj, { signal, credentials: 'omit' });
    if (!r.ok) throw new Error(`basemap TileJSON HTTP ${r.status}`);
    raw = inlineTileJson(raw, parseTileJson(await r.json(), tj));
  }
  rawBasemap = raw;
  return transformStyle(raw, themedBasemap(cssVar));
}

/** The upstream style as fetched, for recolouring in place on theme changes. */
let rawBasemap: StyleSpecification | null = null;

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

  // flyTo requests (ts-stamped so identical targets re-fire, each served once — a map rebuilt by
  // the context ladder does not re-fly to an old target); longitudes wrapped first.
  // Applied once the style is parsed (`style.load`), never waiting for tiles; a request issued
  // earlier stays pending in the store; the boot intro never overrides an explicit request.
  const servedFly = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    const req = nextCameraRequest(flyTo, loaded && !!map, servedFly.current);
    if (!req || !map) return;
    servedFly.current = req.ts;
    const { lng, lat, zoom, pitch, bearing, durationMs } = req;
    map.flyTo({ center: [normalizeLng(lng), lat], zoom, pitch, bearing, duration: reducedMotion() ? 0 : (durationMs ?? 2000), essential: false });
  }, [flyTo, loaded]);

  // `?dossier=lat,lng` deep link without `?c=`: frame the dossier target once the style is parsed.
  const framedDossier = useRef(false);
  useEffect(() => {
    if (!loaded || framedDossier.current) return;
    framedDossier.current = true;
    const ui = useUiStore.getState();
    const cam = dossierDeepLinkCamera(ui);
    if (cam) ui.requestFlyTo(cam);
  }, [loaded]);

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
    const styleReady = () => {
      el.dataset.styleReady = 'true';
      setLoaded(true);
    };
    // `style.load` may already have fired before React handed us the map.
    if (styleParsed(map)) styleReady();
    map.once('style.load', styleReady);
    map.once('load', styleReady);
  }, []);

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap() ?? null;
    if (!map) return;
    setMap(map);
    setLoaded(true);
    // Not the first `idle`: a permanently failing tile or a 1 Hz animated layer can postpone it forever.
    onceStyleLoaded(map, () => {
      setReady(true);
      map.getContainer().dataset.mapReady = 'true';
    });
  }, [setMap, setReady]);

  // Style Studio / Ghost Protocol: recolour the basemap in place from the live CSS tokens.
  const styleVersion = useStyleVersion();
  const shownStyle = useRef<StyleSpecification | null>(null);
  useEffect(() => {
    if (style && !shownStyle.current) shownStyle.current = style;
  }, [style]);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    const prev = shownStyle.current;
    if (!styleVersion || !map || !prev || !rawBasemap || !styleParsed(map)) return;
    const next = transformStyle(rawBasemap, themedBasemap(cssVar));
    for (const { id, prop, value } of paintDiff(prev, next)) {
      if (map.getLayer(id)) (map.setPaintProperty as (l: string, p: string, v: unknown) => void).call(map, id, prop, value);
    }
    shownStyle.current = next;
  }, [styleVersion]);

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

  // ── Picking: the one click router (deck + native + CPU hit-testers, far-side filtered) ──────
  const pickAt = useCallback((map: maplibregl.Map, x: number, y: number, hover = false) => {
    const far = useMapInstanceStore.getState().projection === 'globe' ? cameraFromMap(map) : null;
    return collectCandidates(map as unknown as PickMap, { x, y }, { hover, facing: far ? (p) => isFacing(p, far) : undefined });
  }, []);

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // Primary button only: right/middle clicks never run a (GPU) pick.
      if (!isPrimaryClick(e.originalEvent)) return;
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
      const idle = hoverAllowed(e.originalEvent);
      cancelAnimationFrame(hoverFrame.current);
      hoverFrame.current = requestAnimationFrame(() => {
        publishCursor({ lng: normalizeLng(lng), lat, zoom: map.getZoom() });
        // No hover pick while a button is held (drag/rotate/right-press) or the camera moves.
        if (!idle || map.isMoving()) return;
        const hit = pickAt(map, x, y, true).length > 0;
        setHoverPointer(hit);
        map.getCanvas().style.cursor = hit ? 'pointer' : '';
      });
    },
    [pickAt],
  );
  const onMouseOut = useCallback(() => {
    cancelAnimationFrame(hoverFrame.current);
    setHoverPointer(false);
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

  // Feature modules (and their first fetches) and the deck overlay start once the style is parsed
  // (the globe's first paint) and the main thread is idle, so the first paint never waits for them
  // and a slow tile host (which delays `load`) never delays the data layers.
  const deferred = useAfterIdle(loaded, 1500);
  // Created with the first published deck layer, then kept (no deck teardown on layer toggles).
  const hasDeckLayers = useSticky(useDeckLayerStore((s) => Object.keys(s.entries).length > 0));

  // Honest basemap state: repeated tile failures → BASEMAP OFFLINE (last observed tile) + backoff retry.
  const [basemapHealth, setBasemapHealth] = useState<BasemapHealth | null>(null);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    const el = map.getContainer();
    const health = createBasemapHealth();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown: BasemapHealth['state'] = 'ok';
    el.dataset.basemapState = 'ok';
    const publish = (h: BasemapHealth) => {
      if (h.state === shown) return;
      shown = h.state;
      el.dataset.basemapState = h.state;
      setBasemapHealth(h.state === 'offline' ? h : null);
    };
    const onError = (e: maplibregl.ErrorEvent) => {
      if ((e as { sourceId?: string }).sourceId !== BASEMAP_SOURCE_ID) return;
      const h = health.tileError();
      publish(h);
      if (h.retryInMs === null || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        health.retried();
        if (map.getSource(BASEMAP_SOURCE_ID)) map.refreshTiles(BASEMAP_SOURCE_ID);
      }, h.retryInMs);
    };
    const onData = (e: maplibregl.MapSourceDataEvent) => {
      if (e.sourceId !== BASEMAP_SOURCE_ID || !e.tile) return;
      clearTimeout(timer);
      timer = undefined;
      publish(health.tileLoaded(Date.now()));
    };
    map.on('error', onError);
    map.on('sourcedata', onData);
    return () => {
      clearTimeout(timer);
      map.off('error', onError);
      map.off('sourcedata', onData);
    };
  }, [loaded]);

  const chips = useMemo(() => {
    const out: ImageryChip[] = [];
    const basemapText = basemapHealth ? basemapChipText(basemapHealth) : null;
    if (basemapText) out.push({ id: 'basemap', text: basemapText });
    if (dayNight && nightLightsSupported()) out.push({ id: 'night', text: BLACK_MARBLE_LABEL });
    if (trueColor) out.push({ id: 'gibs', text: gibsTrueColorLabel(gibsDate) });
    if (satellite) out.push({ id: 'esri', text: ESRI_LABEL });
    if (terrainOn) out.push({ id: 'terrain', text: TERRAIN_STATUS_TEXT[terrainStatus] });
    return out;
  }, [basemapHealth, dayNight, trueColor, satellite, terrainOn, terrainStatus, gibsDate]);

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
        maxPitch={terrainOn && terrainEngaged ? TERRAIN_MAX_PITCH : DEFAULT_MAX_PITCH}
        canvasContextAttributes={CONTEXT_ATTRIBUTE_LADDER[attempt]}
        attributionControl={{ compact: false, customAttribution: BASEMAP_ATTRIBUTION }}
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
        {/* Mounted from the start (hidden layers draw nothing and link no program) so they stay
            under the deck layers inserted later at the same label anchor. */}
        <BuildingsLayer beforeId={labelAnchor} visible={buildings} />
        <TerminatorLayer beforeId={labelAnchor} visible={dayNight} />
        {deferred && hasDeckLayers && <DeckOverlay beforeId={labelAnchor} />}
        {deferred && <FeatureLayers />}
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
