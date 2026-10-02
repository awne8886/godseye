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
 * cursor/view/far-side feeds, click/hover pick routing (deck + native via choosePick; hover picks
 * through the hover budget, host-hover.ts), the Region Dossier gestures (double right-click and
 * touch long-press, from native canvas events), and the honest tile-state chips
 * (BASEMAP LOADING from the first frame, basemap and imagery holes/offline). Owner: map-engine.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Map, type MapLayerMouseEvent, type MapRef, type ViewStateChangeEvent } from 'react-map-gl/maplibre';
import { normalizeLng } from '@/lib/geo';
import { useDeckLayerStore, useLayerStatusStore, useMapInstanceStore, useSelectionStore } from '@/lib/layer-host';
import { publishCursor, publishView } from '@/lib/map/cursor';
import { cameraFromMap, isFacing, setFarSideCamera } from '@/lib/map/far-side';
import { createDoubleRightGesture, createLongPress } from '@/lib/map/gestures';
import { createHostHover, type HostHover } from '@/lib/map/host-hover';
import { BLACK_MARBLE_LABEL, ESRI_LABEL, ESRI_SOURCE_ID, GIBS_TRUECOLOR_SOURCE_ID, gibsTrueColorLabel } from '@/lib/map/imagery';
import { geometryClient } from '@/lib/map/geometry-client';
import { installNightProtocol, NIGHT_SOURCE_ID, nightLightsSupported } from '@/lib/map/night-lights';
import { collectCandidates, routePick, setHoverPointer, type PickMap } from '@/lib/map/picking';
import { basemapChipText, type BasemapHealth, imageryChipText, tilesDegraded } from '@/lib/map/basemap-health';
import { type TileWatch, type TileWatchMap, type WatchedSource, watchTileSources } from '@/lib/map/tile-watch';
import { createBasemapStyleLoader, loadBasemapWithRetry } from '@/lib/map/basemap-fetch';
import { dossierDeepLinkCamera, nextCameraRequest } from '@/lib/map/camera';
import { isPrimaryClick, mapToolArmed } from '@/lib/map/deck-events';
import { onceBasemapPainted, onceFirstFrame, onceStyleParsed, type PaintMap, publishMapReady, styleParsed } from '@/lib/map/ready';
import { useStyleVersion } from '@/lib/map/style-version';
import { useSticky } from '@/lib/map/defer';
import { afterQuietSlot, canvasGl } from '@/lib/map/gpu-drain';
import { ADMISSION_MAX_WAIT_MS, createAdmissionScheduler, FOCUS_MAX_WAIT_MS, useAdmissionStore } from '@/lib/map/admission-scheduler';
import { ADMISSION_PRIORITY, hasFocusLayers } from '@/lib/map/focus';
import { installNativeAdmission, type NativeMapLike } from '@/lib/map/native-admission';
import { useAdmission } from '@/lib/map/use-admission';
import { installMissingImageResolver } from '@/lib/map/style-images';
import {
  BASEMAP_ATTRIBUTION,
  BASEMAP_SOURCE_ID,
  IMAGERY_BEFORE_ID,
  firstLabelLayerId,
  paintDiff,
  themedBasemap,
  transformStyle,
} from '@/lib/map/style-transform';
import { attachTerrain, TERRAIN_MAX_PITCH, TERRAIN_STATUS_TEXT, type TerrainStatus } from '@/lib/map/terrain';
import {
  CONTEXT_ATTRIBUTE_LADDER,
  effectiveProjection,
  GLOBE_SKY,
  initialCamera,
  mediaQueryStore,
  minZoomFor,
  normalizeCamera,
  PHONE_LAYOUT_QUERY,
  projectionPitchEase,
} from '@/lib/map/view';
import { useUiStore } from '@/lib/store';
import BasemapPending from './BasemapPending';
import BuildingsLayer from './BuildingsLayer';
import ImageryChips, { type ImageryChip } from './ImageryChips';
import ImageryLayers, { useGibsDate } from './ImageryLayers';
import TerminatorLayer from './TerminatorLayer';
import WebGLFallback from './WebGLFallback';

// deck.gl/luma and every feature module are split out of the map chunk (§11 TBT budget). DeckOverlay
// loads once its device is admitted; the data modules mount once the first style is parsed, so their
// default-on fetches overlap the style download and GL start-up; their GPU work waits in the
// admission queue (perf m-l).
const DeckOverlay = dynamic(() => import('./DeckOverlay'), { ssr: false });
const FeatureLayers = dynamic(() => import('./FeatureLayers'), { ssr: false });
// Module Backgrounds (route planner, DRAW/ROUTE overlays) are the user's own tools: they mount as
// soon as the map is usable, so a click on the map right after picking "Line" is never lost
// (R1r4: DRAW e2e).
const FeatureBackgrounds = dynamic(() => import('./FeatureLayers').then((m) => m.FeatureBackgrounds), { ssr: false });

maplibregl.setWorkerUrl(`/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);
// Night-lights tiles are fetched, clipped and encoded in the geometry worker when it can start.
installNightProtocol(
  maplibregl.addProtocol as Parameters<typeof installNightProtocol>[0],
  geometryClient().hasWorker() ? (url, signal) => geometryClient().nightTile(url, signal) : undefined,
);

/** A lost WebGL context that is not restored within this window is rebuilt on the next ladder rung. */
const CONTEXT_RESTORE_MS = 4000;
/** Longest wait per quiet-slot phase (idle, then GPU drain); the scheduler caps the total. */
const QUIET_SLOT_PHASE_MS = 1500;
/** Feature start-up waits for the basemap's first painted frame, at most this long after style.load. */
const BASEMAP_PAINT_CAP_MS = 4000;
/** Focus layers (the user's route) wait for the globe's first frame, at most this long. */
const FIRST_FRAME_CAP_MS = 1000;
/** Admitted units kept in `data-admission-log` (diagnostics for e2e samples). */
const ADMISSION_LOG_MAX = 24;
const DEFAULT_MAX_PITCH = 85;

/**
 * Tile sources whose state is reported on the map: the basemap (LOADING until its first painted
 * frame, stalls, holes, offline) and the imagery overlays (holes and offline, visual-qa m10).
 */
const WATCHED_TILE_SOURCES: readonly WatchedSource[] = [
  { id: BASEMAP_SOURCE_ID, stall: true, firstPaint: true, retry: true },
  { id: ESRI_SOURCE_ID, retry: false },
  { id: GIBS_TRUECOLOR_SOURCE_ID, retry: false },
  { id: NIGHT_SOURCE_ID, retry: false },
];
/** The basemap before its first painted frame (and before the map even exists). */
const LOADING: BasemapHealth = { state: 'loading', lastGoodAt: null, retryInMs: null, missing: 0 };

/**
 * API presence only. Creating a throw-away WebGL2 context to probe costs a synchronous GPU
 * round-trip (seconds under SwiftShader, the Lighthouse/CI renderer); a browser that has the API
 * but cannot give MapLibre a context is caught by the constructor and the context ladder below.
 */
function hasWebGL2(): boolean {
  return typeof window !== 'undefined' && typeof window.WebGL2RenderingContext === 'function';
}

const cssVar = (name: string) => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name));

/**
 * Style and vector TileJSON (inlined, so a TileJSON failure is retried like the style: no blank
 * globe). One loader per retry loop: a document that already arrived is not fetched again (R1r5-m2).
 */
function basemapLoader(): (signal: AbortSignal) => Promise<StyleSpecification> {
  const load = createBasemapStyleLoader();
  return async (signal) => {
    const raw = await load(signal);
    rawBasemap = raw;
    return transformStyle(raw, themedBasemap(cssVar));
  };
}

/** The upstream style as fetched, for recolouring in place on theme changes. */
let rawBasemap: StyleSpecification | null = null;

const phoneLayout = mediaQueryStore(PHONE_LAYOUT_QUERY);

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let mapLoads = 0;

export default function MapView() {
  const mapRef = useRef<MapRef | null>(null);
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  // MapView is client-only (ssr:false), so the WebGL2 probe can run in the initializer.
  const [failure, setFailure] = useState<'webgl' | 'style' | null>(() => (hasWebGL2() ? null : 'webgl'));
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  /** The data modules are mounted: set with the first parsed style, never cleared (a retry keeps them). */
  const [featuresOn, setFeaturesOn] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [terrainEngaged, setTerrainEngaged] = useState(false);
  const [terrainStatus, setTerrainStatus] = useState<TerrainStatus>('idle');

  const projection = useUiStore((s) => s.projection);
  const basemap = useUiStore((s) => s.basemap);
  const active = useUiStore((s) => s.activeLayers);
  const flyTo = useUiStore((s) => s.flyTo);
  const setCamera = useUiStore((s) => s.setCamera);
  const { setMap, setProjection } = useMapInstanceStore.getState();

  const dayNight = active.has('day_night');
  const buildings = active.has('terrain_3d');
  const terrainOn = active.has('terrain_elevation');
  const trueColor = active.has('gibs_truecolor');
  const satellite = basemap === 'satellite';
  const effective = effectiveProjection(projection, terrainOn && terrainEngaged);
  const projectionSpec = useMemo(() => ({ type: effective }), [effective]);
  const gibsDate = useGibsDate();

  const webglOk = failure !== 'webgl';
  // Style + TileJSON with a per-request deadline: a failed or hung request shows BASEMAP
  // UNAVAILABLE and is retried after 2, 4, 8, 16, then every 30 s (R1r4-m1).
  useEffect(() => {
    if (!webglOk) return;
    return loadBasemapWithRetry(basemapLoader(), {
      onLoaded: (s) => {
        setStyle(s);
        setFailure(null);
      },
      onFailed: () => setFailure('style'),
    });
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

  // Phones can zoom further out so long polar routes (SIN–JFK, HEL–ANC) fit above the sheet. Follows
  // the HUD's phone-layout query (landscape phones included) and updates on resize/rotation.
  const phone = useSyncExternalStore(phoneLayout.subscribe, phoneLayout.get, () => false);
  const minZoom = minZoomFor(phone);
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

  // Publish the map to feature modules once its style is parsed — not on `load`, which waits for every
  // initial tile, so one hung basemap tile would hold back native layers, cards and the compass.
  // `data-map-ready="true"` means exactly this: style parsed, map usable (sources/layers can be
  // added, clicks and camera requests are served). It does NOT mean tiles are in or the camera is
  // still: `data-camera-idle` reports that (see e2e/map-engine/helpers.ts).
  const published = useRef<object | null>(null);
  const publishMap = useCallback(() => {
    const map = mapRef.current?.getMap() ?? null;
    if (!map || published.current === map) return; // once per map instance (a WebGL retry remounts it)
    published.current = map;
    setMap(map);
    // `ready` follows in the admission effect below, right after the queue that holds the native
    // layers' first draws is installed (the data modules are mounted already and add layers as
    // soon as the map is ready).
    setLoaded(true);
    setFeaturesOn(true);
  }, [setMap]);
  const onLoad = publishMap;

  // Runs as soon as react-map-gl has constructed the map (before any tile asks for sprite images).
  const attachMapRef = useCallback((r: MapRef | null) => {
    mapRef.current = r;
    const map = r?.getMap();
    const el = map?.getContainer();
    if (!map || !el || el.dataset.mapLoads) return;
    mapLoads++;
    el.dataset.mapLoads = String(mapLoads);
    // Nothing painted yet: the tile watcher (from style parse on) takes it from here.
    el.dataset.basemapState = 'loading';
    installMissingImageResolver(map);
    // Host features that only need the parsed style (terrain, gestures, flyTo) do not wait for every
    // tile: `style.load` fires first; `load` covers a style that finished before we subscribed.
    const styleReady = () => {
      el.dataset.styleReady = 'true';
      setLoaded(true);
      publishMap();
    };
    // `data-camera-idle`: "true" once the camera has stopped (no fly/ease/drag in progress). Tests
    // that click a precise map position wait for it; `data-map-ready` does not imply it.
    el.dataset.cameraIdle = map.isMoving() ? 'false' : 'true';
    map.on('movestart', () => void (el.dataset.cameraIdle = 'false'));
    map.on('moveend', () => void (el.dataset.cameraIdle = map.isMoving() ? 'false' : 'true'));
    // `style.load` may already have fired before React handed us the map; never waits for tiles.
    onceStyleParsed(map, styleReady);
  }, [publishMap]);


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
    return collectCandidates(map as unknown as PickMap, { x, y }, { hover, facing: far ? (p, altM) => isFacing(p, far, altM) : undefined });
  }, []);

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // Primary button only: right/middle clicks never run a (GPU) pick.
      if (!isPrimaryClick(e.originalEvent)) return;
      // A map tool (DRAW) owns the canvas: no entity pick (panels-recon sets data-map-tool).
      if (mapToolArmed(e.target.getContainer())) return;
      const sel = routePick(pickAt(e.target, e.point.x, e.point.y));
      if (sel) useSelectionStore.getState().select(sel);
    },
    [pickAt],
  );

  // Pointer moves: the cursor readout every animation frame; the hover pick (deck's hover result,
  // native features and every CPU hit-tester) through the hover budget — ≤ 10 Hz while the pointer
  // moves, one trailing pick where it rests (host-hover.ts; round 8: the hit-testers cost 33 ms a
  // frame on the default globe).
  const hover = useRef<HostHover | null>(null);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    const canvas = map.getCanvas();
    const el = map.getContainer();
    /** Diagnostics for e2e (`data-hover-picks`): host hover picks run on this map. */
    let picks = 0;
    const h = createHostHover({
      frames: { request: (cb) => requestAnimationFrame(cb), cancel: (id) => cancelAnimationFrame(id as number) },
      timers: {
        setTimeout: (cb, ms) => setTimeout(cb, ms),
        clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
        now: () => performance.now(),
      },
      cursor: publishCursor,
      zoom: () => map.getZoom(),
      pick: (x, y) => {
        el.dataset.hoverPicks = String(++picks);
        return pickAt(map, x, y, true).length > 0;
      },
      pointer: (hit) => {
        setHoverPointer(hit);
        // Only undo our own pointer: a tool's cursor (DRAW's crosshair) stays while nothing is hovered.
        if (hit) canvas.style.cursor = 'pointer';
        else if (canvas.style.cursor === 'pointer') canvas.style.cursor = '';
      },
      moving: () => map.isMoving(),
      // A map tool (DRAW; panels-recon sets data-map-tool) owns the pointer: no hover pick.
      suspended: () => mapToolArmed(el),
    });
    hover.current = h;
    const press = () => h.press();
    const moveStart = () => h.cameraMoveStart();
    map.on('mousedown', press);
    map.on('mouseup', press);
    map.on('movestart', moveStart);
    return () => {
      map.off('mousedown', press);
      map.off('mouseup', press);
      map.off('movestart', moveStart);
      h.dispose();
      if (hover.current === h) hover.current = null;
    };
  }, [loaded, pickAt]);
  const onMouseMove = useCallback((e: MapLayerMouseEvent) => {
    hover.current?.move({ x: e.point.x, y: e.point.y, lng: e.lngLat.lng, lat: e.lngLat.lat, buttons: e.originalEvent?.buttons ?? 0 });
  }, []);
  const onMouseOut = useCallback(() => {
    if (hover.current) hover.current.leave();
    else {
      setHoverPointer(false);
      publishCursor(null);
    }
  }, []);

  // ── Region Dossier gestures ───────────────────────────────────────────────────
  // Native canvas events only: MapLibre's map `contextmenu` is held from the press to the release
  // and dropped by any camera call in between (HandlerManager.reset), and is also fired for every
  // touch long-press (round 8: 2 of 7 pairs lost after disarming DRAW with fires on).
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    const canvas = map.getCanvas();
    const local = (e: MouseEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    // A map tool (DRAW; panels-recon sets data-map-tool on the container) owns the canvas: no dossier.
    const toolArmed = () => mapToolArmed(map.getContainer());
    const openAt = (x: number, y: number) => {
      if (toolArmed()) return;
      const ll = map.unproject([x, y]);
      useUiStore.getState().openDossier({ lat: ll.lat, lng: normalizeLng(ll.lng) });
    };
    const press = createLongPress(openAt);
    const doubleRight = createDoubleRightGesture(openAt);
    /** Touch pointers on the canvas: a native `contextmenu` they raise is the long-press's, not a right-click. */
    const touches = new Set<number>();
    const down = (e: PointerEvent) => {
      // A mouse press means no finger is down (a lost touch release never disables right-clicks).
      if (e.pointerType === 'mouse') touches.clear();
      if (e.pointerType !== 'touch') return;
      touches.add(e.pointerId);
      if (!toolArmed()) press.down(...local(e), e.pointerId);
    };
    const move = (e: PointerEvent) => e.pointerType === 'touch' && press.move(...local(e), e.pointerId);
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.delete(e.pointerId);
      press.up();
    };
    const cancel = (e?: PointerEvent) => {
      if (e?.pointerType === 'touch') touches.delete(e.pointerId);
      press.cancel();
    };
    const moveStart = () => press.cancel();
    const mouseDown = (e: MouseEvent) => doubleRight.down(...local(e), e.button);
    const mouseMove = (e: MouseEvent) => doubleRight.move(...local(e));
    const mouseUp = (e: MouseEvent) => doubleRight.up(e.button);
    const contextMenu = (e: MouseEvent) => {
      // The map has no browser context menu (right-drag rotates; a double right-click opens the dossier).
      e.preventDefault();
      if (touches.size > 0 || (e as PointerEvent).pointerType === 'touch') return;
      // An armed tool: no dossier, and its right-clicks never pair with one after it is disarmed.
      if (toolArmed()) return doubleRight.reset();
      doubleRight.contextmenu(...local(e), e.timeStamp);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('mousedown', mouseDown);
    canvas.addEventListener('contextmenu', contextMenu);
    // A right-drag may leave the canvas: its moves and release are followed on the window.
    window.addEventListener('mousemove', mouseMove, true);
    window.addEventListener('mouseup', mouseUp, true);
    map.on('movestart', moveStart);
    return () => {
      press.cancel();
      doubleRight.reset();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('mousedown', mouseDown);
      canvas.removeEventListener('contextmenu', contextMenu);
      window.removeEventListener('mousemove', mouseMove, true);
      window.removeEventListener('mouseup', mouseUp, true);
      map.off('movestart', moveStart);
    };
  }, [loaded]);

  useEffect(
    () => () => {
      setMap(null);
      setFarSideCamera(null);
    },
    [setMap],
  );

  // Start-up GPU work goes through one admission queue (one unit per quiet slot — idle main thread,
  // drained GPU — and at least one unit every ADMISSION_MAX_WAIT_MS however busy the thread/GPU):
  // the deck device, each new deck layer class and the first draw of each native layer type the
  // features add. The data modules themselves are NOT queued (perf m-l): they mount as soon as the
  // style is parsed and this queue exists, so their /api requests overlap the GL start-up; what they
  // publish waits here (`ready`) for the basemap's first painted frame (visual-qa R2-M6) and is
  // counted as pending meanwhile, so the header says RECEIVED + DRAWING, never drawn. The user's own
  // focus layers (route, flight, drawing) are served first with a short wait (focus.ts).
  const getGl = useCallback(() => canvasGl(mapRef.current?.getMap().getCanvas()), []);
  /** GPU start-up of the data layers may begin (the basemap's first painted frame, capped). */
  const gpuOpen = useRef(false);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    const store = useAdmissionStore.getState();
    const el = map.getContainer();
    const log: string[] = [];
    const scheduler = createAdmissionScheduler({
      slot: (cb) => afterQuietSlot(getGl, cb, QUIET_SLOT_PHASE_MS),
      maxWaitMs: ADMISSION_MAX_WAIT_MS,
      timers: {
        setTimeout: (cb, ms) => setTimeout(cb, ms),
        clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
        now: () => performance.now(),
      },
      onPending: (n) => {
        store.setPending(n);
        el.dataset.admissionPending = String(n);
      },
      // Diagnostics for e2e samples: which unit was admitted when (ms since navigation start).
      onAdmit: (id) => {
        log.push(`${id}@${Math.round(performance.now())}`);
        if (log.length > ADMISSION_LOG_MAX) log.shift();
        el.dataset.admissionLog = log.join(' ');
      },
    });
    const native = installNativeAdmission(map as unknown as NativeMapLike, () => scheduler.kick());
    const unregister = scheduler.register({
      id: 'native-types',
      priority: ADMISSION_PRIORITY.ambient,
      pending: () => native.pendingTypes().length,
      // Held hidden (and counted) until the basemap has painted: a program link must not delay it.
      ready: () => gpuOpen.current,
      admitOne: () => void native.admitNext(),
    });
    store.setScheduler(scheduler);
    // Ready as soon as the style is parsed (`isStyleLoaded()` stays false while any visible tile is
    // loading, so one hung tile would keep every native layer out and the header counting undrawn
    // entities) AND the admission queue is in place: every native layer a module adds from now on
    // goes through it.
    publishMapReady(useMapInstanceStore.getState(), map, el);
    return () => {
      unregister();
      native.uninstall();
      scheduler.dispose();
      if (useAdmissionStore.getState().scheduler === scheduler) store.setScheduler(null);
    };
  }, [loaded, getGl]);
  // The data layers' GPU set-up starts after the basemap's first painted frame (capped): it must
  // not starve the globe's first frame (visual-qa R2-M6). Their fetches do not wait for it.
  const [basemapPainted, setBasemapPainted] = useState(false);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    return onceBasemapPainted(map as unknown as PaintMap, BASEMAP_SOURCE_ID, () => setBasemapPainted(true), BASEMAP_PAINT_CAP_MS);
  }, [loaded]);
  useEffect(() => {
    gpuOpen.current = basemapPainted;
    if (basemapPainted) useAdmissionStore.getState().scheduler?.kick();
  }, [basemapPainted]);
  // Data modules mount once the first style is parsed (and stay mounted across a WebGL retry). Mounting
  // them with the map host's first render (perf L96) put their chunk loads and feed parsing on the
  // main thread while the HUD and splash paint: the software-GL Lighthouse gate measured LCP 2.88 s
  // on CI against the 2.5 s contract value. They see no map until it is `ready` (style parsed +
  // admission queue installed), so every native layer still goes through the queue, and their deck
  // layers wait for the deck device's admission.
  // The globe's first frame (no tiles needed): the earliest point for the user's own focus work.
  const [firstFrame, setFirstFrame] = useState(false);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    return onceFirstFrame(map as unknown as PaintMap, () => setFirstFrame(true), FIRST_FRAME_CAP_MS);
  }, [loaded]);
  // Created with the first published deck layer, then kept (no deck teardown on layer toggles).
  const hasDeckLayers = useSticky(useDeckLayerStore((s) => Object.keys(s.entries).length > 0));
  // Focus layers (module Backgrounds: a `?route=` deep link or a `?flight=` tracked flight's planned
  // arc, drawn shapes — what the user asked for) get the deck device first, once the globe has drawn
  // its first frame, without waiting for basemap tiles or a quiet GPU (focus.ts). Ambient data
  // layers wait for the first painted basemap frame (visual-qa R2-M6): the device is wanted (and
  // counted pending) as soon as a deck layer exists, and admitted once that frame is in.
  const focusDeck = useDeckLayerStore((s) => hasFocusLayers(s.entries));
  const deckReady = basemapPainted || (focusDeck && firstFrame);
  const deckPriority = focusDeck ? ADMISSION_PRIORITY.focusFirst : ADMISSION_PRIORITY.deckDevice;
  const deckSlot = useAdmission(loaded && hasDeckLayers, 'deck-device', deckPriority, focusDeck ? FOCUS_MAX_WAIT_MS : undefined, deckReady);
  // Between the device's admission and DeckOverlay's mount (lazy chunk + first commit) nothing is
  // drawn yet and 'deck-device' no longer counts as pending: keep the header on DRAWING until the
  // overlay has mounted and handed its layers over (round-5 perf m-l follow-up).
  const [deckMounted, setDeckMounted] = useState(false);
  const deckMountPending = loaded && hasDeckLayers && !deckMounted;
  useEffect(() => {
    useAdmissionStore.getState().setUndrawn('deck-mount', deckMountPending ? 1 : 0);
  }, [deckMountPending]);
  useEffect(() => () => useAdmissionStore.getState().setUndrawn('deck-mount', 0), []);

  // Honest tile state (basemap + imagery overlays): BASEMAP LOADING until the first painted frame,
  // repeated failures → OFFLINE with the last observed tile, holes → N TILES MISSING, each retried
  // by tile id with backoff (tile-watch.ts).
  const [tileHealth, setTileHealth] = useState<Readonly<Record<string, BasemapHealth>>>({});
  const tileWatch = useRef<TileWatch | null>(null);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    const el = map.getContainer();
    const watch = watchTileSources(map as unknown as TileWatchMap, WATCHED_TILE_SOURCES, (id, h) => {
      if (id === BASEMAP_SOURCE_ID) el.dataset.basemapState = h.state;
      setTileHealth((prev) => ({ ...prev, [id]: h }));
    });
    tileWatch.current = watch;
    return () => {
      watch.dispose();
      if (tileWatch.current === watch) tileWatch.current = null;
    };
  }, [loaded]);
  // An overlay switched off shows none of its holes: forget them (a fresh count when it returns).
  useEffect(() => {
    if (!satellite) tileWatch.current?.reset(ESRI_SOURCE_ID);
  }, [satellite]);
  useEffect(() => {
    if (!trueColor) tileWatch.current?.reset(GIBS_TRUECOLOR_SOURCE_ID);
  }, [trueColor]);
  useEffect(() => {
    if (!dayNight) tileWatch.current?.reset(NIGHT_SOURCE_ID);
  }, [dayNight]);

  const chips = useMemo(() => {
    const out: ImageryChip[] = [];
    const base = tileHealth[BASEMAP_SOURCE_ID];
    // Until the style is parsed <BasemapPending/> shows BASEMAP LOADING over the map (one chip, no
    // gap while MapLibre is constructed); after it, the watcher's state until the first painted frame.
    if (loaded && (!base || base.state === 'loading')) out.push({ id: 'basemap-loading', text: basemapChipText(LOADING)!, tone: 'reference' });
    else if (loaded && base) {
      const basemapText = basemapChipText(base);
      if (basemapText) out.push({ id: 'basemap', text: basemapText });
    }
    const imagery = (id: string, sourceId: string, label: string) => {
      const h = tileHealth[sourceId];
      out.push({ id, text: imageryChipText(label, h), tone: tilesDegraded(h) ? 'offline' : undefined });
    };
    if (dayNight && nightLightsSupported()) imagery('night', NIGHT_SOURCE_ID, BLACK_MARBLE_LABEL);
    if (trueColor) imagery('gibs', GIBS_TRUECOLOR_SOURCE_ID, gibsTrueColorLabel(gibsDate));
    if (satellite) imagery('esri', ESRI_SOURCE_ID, ESRI_LABEL);
    if (terrainOn) out.push({ id: 'terrain', text: TERRAIN_STATUS_TEXT[terrainStatus] });
    return out;
  }, [loaded, tileHealth, dayNight, trueColor, satellite, terrainOn, terrainStatus, gibsDate]);

  if (failure === 'webgl') return <WebGLFallback reason="webgl" />;
  if (failure === 'style' && !style) return <WebGLFallback reason="style" />;
  // The map container is up but the style is still on its way: say so from the first frame.
  // The data modules (outside the map, so they keep their state across a WebGL retry) mount once the
  // first style is parsed: see `featuresOn`.
  if (!style)
    return (
      <>
        <BasemapPending phone={phone} />
      </>
    );

  return (
    <>
      <div className="absolute inset-0" data-testid="map-root" data-projection={effective} data-basemap={basemap}>
        <Map
          key={attempt}
          ref={attachMapRef}
          mapLib={maplibregl}
          mapStyle={style}
          initialViewState={initialView}
          projection={projectionSpec}
          sky={GLOBE_SKY}
          minZoom={minZoom}
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
          {deckSlot && <DeckOverlay beforeId={labelAnchor} gpuOpen={basemapPainted} onMounted={setDeckMounted} />}
          {loaded && <FeatureBackgrounds />}
          <ImageryChips chips={chips} collapse={phone} />
        </Map>
        {/* Same chip, same place, from the style's arrival until the map's own stack takes over at
            load (visual-qa round-5 m3: no chip-less gap while MapLibre is constructed). */}
        {!loaded && <BasemapPending phone={phone} />}
        {contextLost && (
          <div role="status" className="hud-micro pointer-events-none absolute inset-x-0 top-1/2 text-center text-[var(--alert-orange)]">
            GPU CONTEXT LOST · RESTORING
          </div>
        )}
      </div>
      {featuresOn && <FeatureLayers />}
    </>
  );
}
