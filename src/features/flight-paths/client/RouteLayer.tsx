'use client';
/**
 * Always-mounted Flight Path Planner map layer (FeatureModule.Background): draws the planned route
 * (`?route=` / store.plannedRoute) and the tracked flight (`?flight=` / store.flightIdent) with
 * the live aircraft on the pair, re-reads colours on theme changes, filters billboards to the
 * visible hemisphere on the globe, animates the endpoint pulse and the comet head (not under
 * reduced motion) and frames each new route/flight: fit-bounds in mercator, midpoint + angular
 * extent on the globe, padded by the HUD chrome (header, status bar, left rail) and the docked
 * panel, plus measured chrome (phone sheet, lifted attribution, view controls). Every new
 * route/flight (deep link, palette, card button) opens the PATHS panel.
 *
 * Framing (R4-B2): the fit is issued as soon as the style is parsed (camera moves need no tiles)
 * and issued once more at the map's first `idle` if the camera was moved by something other than
 * the viewer in between (e.g. an intro fly-in served at `load`). A viewer drag/zoom cancels it.
 * Client-only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useDeckLayers, useDeckLayerStore, useMapInstance, useMapInstanceStore } from '@/lib/layer-host';
import { styleParsed } from '@/lib/map/ready';
import { useUiStore } from '@/lib/store';
import type { LngLatTuple } from '@/lib/geo';
import { useFlight, useLive, usePlan } from './api';
import { setFitNotice, useFitNotice } from './fit';
import { measureObstacles, PHONE_MAX_WIDTH } from './insets';
import { buildRouteAnimLayers, buildRouteLayers, frameBounds, framePadding, globeCamera, routeFrame } from './layers';

/** Above aviation (80–83) so the route and its aircraft rings sit on top. */
const Z = 90;
/** One pulse + one comet pass per period; ~15 fps is plenty for a slow sweep. */
const ANIM_PERIOD_MS = 6_000;
const ANIM_TICK_MS = 66;
const FIT_DURATION_MS = 1_200;
/** Re-frame this long after the phone sheet's published height last changed. */
const SHEET_SETTLE_MS = 180;
/** Watch the sheet height only right after a new route/flight is framed. */
const SHEET_WATCH_MS = 4_000;
const ANIM_KEY = 'flight-paths-anim';

const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Docked panel geometry for the fit padding: the right dock on desktop. The phone sheet is an
 * obstacle measured by `measureObstacles()` (its published `--sheet-occupied` height).
 */
function panelGeometry(open: boolean): { side: 'right' | 'bottom'; size: number } | null {
  if (!open || typeof window === 'undefined') return null;
  if (window.innerWidth < PHONE_MAX_WIDTH) return null;
  const w = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-width')) || 360;
  return { side: 'right', size: w + 64 }; // panel + its right-16 rail offset
}

export default function RouteLayer() {
  const route = useUiStore((s) => s.plannedRoute);
  const ident = useUiStore((s) => s.flightIdent);
  const theme = useUiStore((s) => s.theme);
  const motion = useUiStore((s) => s.settings.motion);
  const openPanel = useUiStore((s) => s.openPanel);
  const setOpenPanel = useUiStore((s) => s.setOpenPanel);
  const map = useMapInstance();
  // The raw instance (before the first idle) for camera framing: a camera move needs the parsed
  // style, not loaded tiles, so framing does not wait for `ready` (R4-B2 / visual-qa m12).
  const cameraMap = useMapInstanceStore((s) => s.map);
  const projection = useMapInstanceStore((s) => s.projection);
  const [view, setView] = useState<{ center: LngLatTuple; zoom: number }>({ center: [0, 20], zoom: 2 });
  const [themeTick, setThemeTick] = useState(0);

  const plan = usePlan(route);
  const live = useLive(route, openPanel === 'paths' || !!route);
  const flight = useFlight(route ? null : ident);

  // Each new route/flight (deep link included) opens PATHS. Latched per value, not per mount, so a
  // value restored from the URL after the first render still opens it (R4-B2); closing the panel
  // for the same route keeps it closed.
  const key = route ? `route:${route.from}-${route.to}` : ident ? `flight:${ident}` : null;
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!key || opened.current === key) return;
    opened.current = key;
    if (useUiStore.getState().openPanel !== 'paths') setOpenPanel('paths');
  }, [key, setOpenPanel]);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const c = map.getCenter();
      setView({ center: [c.lng, c.lat], zoom: typeof map.getZoom === 'function' ? map.getZoom() : 2 });
    };
    update();
    map.on('moveend', update);
    return () => {
      map.off('moveend', update);
    };
  }, [map]);

  // Theme tokens are applied to the document after the store changes; re-read on the next frame.
  useEffect(() => {
    const id = requestAnimationFrame(() => setThemeTick((t) => t + 1));
    return () => cancelAnimationFrame(id);
  }, [theme]);

  const p = route ? (plan.data ?? null) : null;
  const f = !route && ident ? (flight.data ?? null) : null;
  const l = route ? (live.data ?? null) : null;
  const frame = useMemo(() => routeFrame(p, l, f), [p, l, f]);

  // Fit-bounds framing, once per route/flight per map instance (a map rebuilt after context loss
  // starts from its initial camera, so it is framed again).
  const framed = useRef<{ key: string; map: unknown } | null>(null);
  const frameKey = p ? `route:${p.origin.ident}-${p.destination.ident}` : f ? `flight:${f.ident}` : null;
  // Latest frame for the framing effect, which must not restart (and drop a pending fit) when only
  // the live aircraft refresh.
  const frameRef = useRef(frame);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);
  useEffect(() => {
    const fr = frameRef.current;
    const map = cameraMap;
    if (!map || !fr || !frameKey) return;
    if (framed.current?.key === frameKey && framed.current.map === map) return;
    const bounds = frameBounds(fr);
    if (!bounds) return;
    framed.current = { key: frameKey, map };
    const m = map as MapLibreMap;
    let viewerMoved = false;
    let done = false;
    const reduced = motion === 'reduced' || (motion === 'system' && prefersReducedMotion());
    const fit = (animate: boolean) => {
      if (done || viewerMoved) return;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const padding = framePadding(viewport, panelGeometry(true), measureObstacles());
      const duration = animate && !reduced ? FIT_DURATION_MS : 0;
      // Globe (R2-M4): centre on the arc midpoint and zoom by angular extent — a lng/lat box cannot
      // frame polar or antimeridian routes. Mercator: fit the unwrapped bounds.
      // The solver works within the map's minimum zoom (round 3 M2) and reports when the route
      // cannot fit at it (PATHS then says so).
      const minZoom = typeof m.getMinZoom === 'function' ? m.getMinZoom() : 0;
      const cam = useMapInstanceStore.getState().projection === 'globe' ? globeCamera(fr, viewport, padding, { minZoom, maxZoom: 8 }) : null;
      setFitNotice({ key: frameKey, fits: cam ? cam.fits : true });
      if (cam) m.easeTo({ center: cam.center, zoom: cam.zoom, padding, bearing: 0, pitch: 0, duration, essential: false });
      else m.fitBounds(bounds, { padding, maxZoom: 8, duration, essential: false });
    };
    const onMoveStart = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) viewerMoved = true;
    };
    m.on('movestart', onMoveStart);
    const onStyle = () => fit(true);
    if (styleParsed(m)) fit(true);
    else m.once('style.load', onStyle);
    // Re-issue at the first idle if the map was not ready yet (a fly-in served at `load` would
    // otherwise leave the route off-screen).
    // Phones: the sheet slides in (and publishes `--sheet-occupied`) after the first fit may have
    // run; re-frame once its height settles, unless the viewer has taken the camera.
    let sheetTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSheet = document.documentElement.style.getPropertyValue('--sheet-occupied');
    const sheetObserver =
      typeof MutationObserver === 'undefined' || window.innerWidth >= PHONE_MAX_WIDTH
        ? null
        : new MutationObserver(() => {
            const v = document.documentElement.style.getPropertyValue('--sheet-occupied');
            if (v === lastSheet || !v) return;
            lastSheet = v;
            if (sheetTimer) clearTimeout(sheetTimer);
            sheetTimer = setTimeout(() => fit(true), SHEET_SETTLE_MS);
          });
    sheetObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    const sheetWatchEnd = sheetObserver ? setTimeout(() => sheetObserver.disconnect(), SHEET_WATCH_MS) : null;
    let unsub: (() => void) | null = null;
    if (!useMapInstanceStore.getState().ready) {
      unsub = useMapInstanceStore.subscribe((s) => {
        if (!s.ready) return;
        unsub?.();
        unsub = null;
        fit(false);
      });
    }
    return () => {
      done = true;
      unsub?.();
      sheetObserver?.disconnect();
      if (sheetTimer) clearTimeout(sheetTimer);
      if (sheetWatchEnd) clearTimeout(sheetWatchEnd);
      m.off('movestart', onMoveStart);
      m.off('style.load', onStyle);
    };
  }, [cameraMap, frameKey, motion]);

  const layers = useMemo(() => {
    if (!frame) return null;
    return buildRouteLayers({ plan: p, live: l, flight: f, globe: projection === 'globe', center: view.center, zoom: view.zoom, theme: themeTick }, frame);
  }, [frame, p, l, f, projection, view, themeTick]);

  // Pulse + comet: a slow clock while something is drawn, paused in hidden tabs and under reduced
  // motion. The phase never enters React state: each tick builds the two small layers and hands
  // them straight to the deck layer store.
  const reduced = motion === 'reduced' || (motion === 'system' && prefersReducedMotion());
  const animating = !!frame && frame.arc.length > 1 && !reduced;
  const globe = projection === 'globe';
  useEffect(() => {
    const store = useDeckLayerStore.getState();
    if (!animating) {
      store.remove(ANIM_KEY);
      return;
    }
    const start = performance.now();
    const tick = () => {
      if (document.hidden) return;
      const phase = ((performance.now() - start) % ANIM_PERIOD_MS) / ANIM_PERIOD_MS;
      store.set(ANIM_KEY, { layers: buildRouteAnimLayers({ frame, globe, phase, reducedMotion: false, theme: themeTick }), z: Z + 1 });
    };
    tick();
    const id = setInterval(tick, ANIM_TICK_MS);
    return () => {
      clearInterval(id);
      store.remove(ANIM_KEY);
    };
    // `view` re-runs the far-side filter for the pulse rings.
  }, [animating, frame, globe, themeTick, view]);

  useDeckLayers('flight-paths', layers, Z);
  const fitNotice = useFitNotice();
  // Diagnostics for tests (what is drawn, from which request); no visible output.
  return (
    <div
      hidden
      data-testid="flight-paths-status"
      data-route={route ? `${route.from}-${route.to}` : ''}
      data-flight={ident ?? ''}
      data-layers={(layers ?? []).map((x) => (x && typeof x === 'object' && 'id' in x ? String(x.id) : '')).join(',')}
      data-points={plan.data?.greatCircle.points.length ?? flight.data?.plannedArc.length ?? 0}
      data-max-lng-step={frame ? Math.round(maxStep(frame) * 100) / 100 : ''}
      data-fit={fitNotice && fitNotice.key === frameKey ? (fitNotice.fits ? 'full' : 'partial') : ''}
    />
  );
}

/**
 * Largest longitude jump in anything drawn, including aircraft vs the arc's nearest vertex
 * (diagnostic for the antimeridian e2e: a continuous single-frame drawing stays ≤ 180).
 */
function maxStep(fr: NonNullable<ReturnType<typeof routeFrame>>): number {
  let m = 0;
  const walk = (pts: readonly LngLatTuple[]) => {
    for (let i = 1; i < pts.length; i++) m = Math.max(m, Math.abs(pts[i]![0] - pts[i - 1]![0]));
  };
  walk(fr.arc);
  walk(fr.remaining);
  for (const s of fr.flown) m = Math.max(m, Math.abs(s.to[0] - s.from[0]));
  if (fr.arc.length) {
    for (const a of fr.aircraft) m = Math.max(m, Math.min(...fr.arc.map((v) => Math.abs(v[0] - a.position[0]))));
  }
  return m;
}
