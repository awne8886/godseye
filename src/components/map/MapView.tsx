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
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { BASEMAP_STALL_MS, basemapChipText, createBasemapHealth, heldTileKeys, retryTargets, type BasemapHealth } from '@/lib/map/basemap-health';
import { fetchBasemapStyle, loadBasemapWithRetry } from '@/lib/map/basemap-fetch';
import { dossierDeepLinkCamera, nextCameraRequest } from '@/lib/map/camera';
import { hoverAllowed, isPrimaryClick } from '@/lib/map/deck-events';
import { onceBasemapPainted, onceStyleParsed, type PaintMap, styleParsed } from '@/lib/map/ready';
import { useStyleVersion } from '@/lib/map/style-version';
import { useSticky } from '@/lib/map/defer';
import { afterQuietSlot, canvasGl } from '@/lib/map/gpu-drain';
import { ADMISSION_MAX_WAIT_MS, createAdmissionScheduler, useAdmissionStore } from '@/lib/map/admission-scheduler';
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
import BuildingsLayer from './BuildingsLayer';
import ImageryChips, { type ImageryChip } from './ImageryChips';
import ImageryLayers, { useGibsDate } from './ImageryLayers';
import TerminatorLayer from './TerminatorLayer';
import WebGLFallback from './WebGLFallback';

// deck.gl/luma and every feature module are split out of the map chunk and only load once the
// basemap has loaded and the browser is idle (§11 TBT budget); the globe paints first.
const DeckOverlay = dynamic(() => import('./DeckOverlay'), { ssr: false });
const FeatureLayers = dynamic(() => import('./FeatureLayers'), { ssr: false });
// Module Backgrounds (route planner, DRAW/ROUTE overlays) are the user's own tools: they mount as
// soon as the map is usable, not behind the data layers' start-up queue, so a click on the map
// right after picking "Line" is never lost (R1r4: DRAW e2e).
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
  // Style and vector TileJSON (inlined, so its failure is retried with the style: no blank globe).
  const raw = await fetchBasemapStyle(signal);
  rawBasemap = raw;
  return transformStyle(raw, themedBasemap(cssVar));
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
  // Style + TileJSON with a per-request deadline: a failed or hung request shows BASEMAP
  // UNAVAILABLE and is retried after 2, 4, 8, 16, then every 30 s (R1r4-m1).
  useEffect(() => {
    if (!webglOk) return;
    return loadBasemapWithRetry(loadBasemap, {
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
  const minZoom = minZoomFor(useSyncExternalStore(phoneLayout.subscribe, phoneLayout.get, () => false));
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
    setLoaded(true);
    // Ready as soon as the style is parsed: `isStyleLoaded()` stays false while any visible tile is
    // loading, so one hung tile would keep every native layer out and the header counting undrawn
    // entities.
    setReady(true);
    map.getContainer().dataset.mapReady = 'true';
  }, [setMap, setReady]);
  const onLoad = publishMap;

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
        // Only undo our own pointer: a tool's cursor (DRAW's crosshair) stays while nothing is hovered.
        const canvas = map.getCanvas();
        if (hit) canvas.style.cursor = 'pointer';
        else if (canvas.style.cursor === 'pointer') canvas.style.cursor = '';
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

  // Feature modules (and their first fetches) start once the style is parsed (the globe's first
  // paint) in a quiet slot (idle main thread, drained GPU), so the first paint never waits for them
  // and a slow tile host (which delays `load`) never delays the data layers. The deck overlay
  // (whose device set-up queries the GPU synchronously) gets its own quiet slot once a layer exists.
  // All of that start-up work goes through one admission queue (one unit per quiet slot, at least
  // one unit every ADMISSION_MAX_WAIT_MS however busy the thread/GPU): feature mount, deck device,
  // each new deck layer class and the first draw of each native layer type features add.
  const getGl = useCallback(() => canvasGl(mapRef.current?.getMap().getCanvas()), []);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    const store = useAdmissionStore.getState();
    const scheduler = createAdmissionScheduler({
      slot: (cb) => afterQuietSlot(getGl, cb, QUIET_SLOT_PHASE_MS),
      maxWaitMs: ADMISSION_MAX_WAIT_MS,
      timers: { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) },
      onPending: (n) => {
        store.setPending(n);
        map.getContainer().dataset.admissionPending = String(n);
      },
    });
    const native = installNativeAdmission(map as unknown as NativeMapLike, () => scheduler.kick());
    const unregister = scheduler.register({ id: 'native-types', priority: 2, pending: () => native.pendingTypes().length, admitOne: () => void native.admitNext() });
    store.setScheduler(scheduler);
    return () => {
      unregister();
      native.uninstall();
      scheduler.dispose();
      if (useAdmissionStore.getState().scheduler === scheduler) store.setScheduler(null);
    };
  }, [loaded, getGl]);
  // Features start after the basemap's first painted frame (capped): their fetch/parse/GPU set-up
  // must not starve the globe's first frame (visual-qa R2-M6).
  const [basemapPainted, setBasemapPainted] = useState(false);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    return onceBasemapPainted(map as unknown as PaintMap, BASEMAP_SOURCE_ID, () => setBasemapPainted(true), BASEMAP_PAINT_CAP_MS);
  }, [loaded]);
  const deferred = useAdmission(loaded && basemapPainted, 'features', 0);
  // Created with the first published deck layer, then kept (no deck teardown on layer toggles).
  const hasDeckLayers = useSticky(useDeckLayerStore((s) => Object.keys(s.entries).length > 0));
  // The deck device does not wait for the data modules to mount: deck layers published before they
  // mount can only come from module Backgrounds (a `?route=` deep link, drawn shapes: what the user
  // asked for), so the device then goes first (visual-qa R4-M1). Still after the first basemap frame.
  const deckSlot = useAdmission(loaded && basemapPainted && hasDeckLayers, 'deck-device', deferred ? 1 : -1);

  // Honest basemap state: repeated tile failures → BASEMAP OFFLINE (last observed tile) + backoff retry.
  const [basemapHealth, setBasemapHealth] = useState<BasemapHealth | null>(null);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    const el = map.getContainer();
    const health = createBasemapHealth();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown = 'ok|0';
    el.dataset.basemapState = 'ok';
    const publish = (h: BasemapHealth) => {
      const key = `${h.state}|${h.missing}`;
      if (key === shown) return;
      shown = key;
      el.dataset.basemapState = h.state;
      setBasemapHealth(h.state === 'ok' ? null : h);
    };
    // Ask again for the failed tiles only (R1r4-m2): a whole-viewport reload re-downloads and
    // re-parses every tile in view from a donation-funded host.
    const retry = (h: BasemapHealth) => {
      if (h.retryInMs === null || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        const targets = retryTargets(health.get(), health.failedTiles());
        health.retried();
        if (!targets || !map.getSource(BASEMAP_SOURCE_ID)) return;
        if (targets === 'source') map.refreshTiles(BASEMAP_SOURCE_ID);
        else map.refreshTiles(BASEMAP_SOURCE_ID, targets);
      }, h.retryInMs);
    };
    const tileKey = (e: unknown): string | undefined => {
      const c = (e as { tile?: { tileID?: { canonical?: { z: number; x: number; y: number } } } }).tile?.tileID?.canonical;
      return c ? `${c.z}/${c.x}/${c.y}` : undefined;
    };
    const onError = (e: maplibregl.ErrorEvent) => {
      if ((e as { sourceId?: string }).sourceId !== BASEMAP_SOURCE_ID) return;
      const h = health.tileError(tileKey(e));
      publish(h);
      retry(h);
    };
    const onData = (e: maplibregl.MapSourceDataEvent) => {
      if (e.sourceId !== BASEMAP_SOURCE_ID || !e.tile) return;
      const h = health.tileLoaded(Date.now(), tileKey(e));
      if (h.retryInMs === null) {
        clearTimeout(timer);
        timer = undefined;
      }
      publish(h);
    };
    // Tiles that failed out of view no longer matter (MapLibre requests the new view itself);
    // failed tiles still in view stay reported and are retried by id on the next tick.
    const onMoveEnd = () => {
      if (health.get().missing === 0) return;
      const held = heldTileKeys(map, BASEMAP_SOURCE_ID);
      const h = held ? health.keepInView(held) : health.forgetMissing();
      publish(h);
      retry(h);
    };
    // Tiles in view still loading after BASEMAP_STALL_MS (a hung host, nothing failed): LOADING chip.
    let loadingSince: number | null = null;
    const stallCheck = setInterval(() => {
      let busy = false;
      try {
        busy = !!map.getSource(BASEMAP_SOURCE_ID) && !map.isSourceLoaded(BASEMAP_SOURCE_ID);
      } catch {
        busy = false;
      }
      const now = Date.now();
      loadingSince = busy ? (loadingSince ?? now) : null;
      publish(health.setStalled(loadingSince !== null && now - loadingSince >= BASEMAP_STALL_MS));
    }, 1000);
    map.on('error', onError);
    map.on('sourcedata', onData);
    map.on('moveend', onMoveEnd);
    return () => {
      clearTimeout(timer);
      clearInterval(stallCheck);
      map.off('error', onError);
      map.off('sourcedata', onData);
      map.off('moveend', onMoveEnd);
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
        {deckSlot && <DeckOverlay beforeId={labelAnchor} />}
        {loaded && <FeatureBackgrounds />}
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
