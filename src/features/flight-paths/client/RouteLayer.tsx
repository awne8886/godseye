'use client';
/**
 * Always-mounted Flight Path Planner map layer (FeatureModule.Background): draws the planned route
 * (`?route=` / store.plannedRoute) and the tracked flight (`?flight=` / store.flightIdent) with
 * the live aircraft on the pair, re-reads colours on theme changes, filters billboards to the
 * visible hemisphere on the globe, animates the endpoint pulse and the comet head (not under
 * reduced motion) and frames each new route/flight. Every new route/flight (deep link, palette,
 * card button) opens the PATHS panel.
 *
 * Framing (framing.ts): the camera is solved against the measured HUD chrome (insets.ts) so the
 * whole drawing stays in the free area (inside the header band, status bar, left rail, docked panel
 * or phone sheet) and both endpoint dots and code labels clear every overlay (view controls, chips,
 * attribution …), in both projections, applied with `easeTo({center, zoom, padding, pitch: 0})`.
 * It is issued as soon as the style is parsed (camera moves need no tiles) and once more when the
 * map is published if that came later (R4-B2). For 30 s afterwards the chrome is watched (sheet
 * height, chips appearing, attribution moving, resize): if an endpoint mark ends up under an
 * overlay the route is framed again; when no clear framing exists (a long route on a small phone)
 * PATHS names the endpoints the chrome covers. The framing's own camera moves are tagged
 * (`routeFraming` event data); any other camera move — a drag/zoom, a fly the viewer asked for
 * (palette, presets, search, alerts, intel, reset view), PATHS closing — ends all of it; MapLibre's
 * own resize moves (rotation, window resize) do not. The padding the framing set is released when
 * PATHS closes or the route/flight is cleared, so later flies land at the screen centre and `?c=`
 * is the centre on screen. Client-only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useDeckLayers, useDeckLayerStore, useMapInstance, useMapInstanceStore } from '@/lib/layer-host';
import { getFarSideCamera, isFacing } from '@/lib/map/far-side';
import { styleParsed } from '@/lib/map/ready';
import { useUiStore } from '@/lib/store';
import type { LngLatTuple } from '@/lib/geo';
import { useFlight, useLive, usePlan } from './api';
import { fitState, getFitNotice, setFitNotice, useFitNotice } from './fit';
import { frameArea, type FrameFit, intersects, markBoxes, solveFrame } from './framing';
import { isPhoneLayout, measureObstacles, overlayElements, publishedSheet, sheetOccupiedPx } from './insets';
import { buildRouteAnimLayers, buildRouteLayers, frameBounds, routeFrame, type RouteFrame } from './layers';

/** Above aviation (80–83) so the route and its aircraft rings sit on top. */
const Z = 90;
/** One pulse + one comet pass per period; ~15 fps is plenty for a slow sweep. */
const ANIM_PERIOD_MS = 6_000;
const ANIM_TICK_MS = 66;
const FIT_DURATION_MS = 1_200;
/** After a framing, watch the chrome this long (late chips, the sheet settling, rotation). */
const CHROME_WATCH_MS = 30_000;
/** Chrome changes are batched: the check runs once things have been still this long. */
const CHROME_SETTLE_MS = 250;
/** At most this many automatic re-framings per route/flight. */
const MAX_REFITS = 4;
/**
 * Untagged camera moves this soon after a window resize are MapLibre's own (its throttled resize,
 * a layout minimum-zoom change), not the viewer's.
 */
const LAYOUT_MOVE_MS = 1_000;
/** Padding release glide (the framed picture slides to the screen centre). */
const RELEASE_DURATION_MS = 600;
/** Event data on the framing's own camera moves (MapLibre copies it onto movestart/moveend). */
const FRAMING_EVENT = { routeFraming: true } as const;
const ANIM_KEY = 'flight-paths-anim';

const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A camera event as MapLibre fires it: `originalEvent` for gestures, the caller's event data otherwise. */
interface CameraEvent {
  originalEvent?: unknown;
  routeFraming?: unknown;
}

/**
 * The panel over the map: the right dock on desktop (its `--panel-width` plus the right-16 rail
 * offset), the bottom sheet on phones (its published `--sheet-occupied`, else its CSS bound); none
 * while no panel is open.
 */
function panelGeometry(phone: boolean, open: boolean): { side: 'right' | 'bottom'; size: number } | null {
  if (typeof window === 'undefined' || !open) return null;
  if (phone) return { side: 'bottom', size: sheetOccupiedPx(publishedSheet(), window.innerHeight) };
  const w = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-width')) || 360;
  return { side: 'right', size: w + 64 };
}

/**
 * Drop the padding a framing left on the camera (round 4 fix pass): ease to zero padding, keeping
 * the centre, so the framed picture slides to the screen centre — after the move in progress, if
 * any. Returns a canceller for a release still waiting on that move.
 */
function releaseFramePadding(m: MapLibreMap, reduced: boolean): () => void {
  const run = () => {
    const p = typeof m.getPadding === 'function' ? m.getPadding() : null;
    if (!p || (!p.top && !p.right && !p.bottom && !p.left)) return;
    m.easeTo({ padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration: reduced ? 0 : RELEASE_DURATION_MS, essential: false });
  };
  if (m.isMoving()) {
    m.once('moveend', run);
    return () => void m.off('moveend', run);
  }
  run();
  return () => {};
}

/**
 * Screen boxes (viewport px) of the endpoint dots and labels for the map's current camera, through
 * MapLibre's own projection. Globe: far-side endpoints are not drawn, so they have no box.
 * Mercator: deck repeats world copies; the copy nearest the camera is the one on screen.
 */
function currentMarks(m: MapLibreMap, fr: Pick<RouteFrame, 'endpoints'>, globe: boolean) {
  const c = m.getCenter();
  const o = m.getContainer().getBoundingClientRect();
  const far = getFarSideCamera();
  return markBoxes(fr, (p) => {
    if (globe && !isFacing(p, far)) return null;
    const lng = globe ? p[0] : p[0] + 360 * Math.round((c.lng - p[0]) / 360);
    const xy = m.project([lng, p[1]]);
    return [xy.x + o.left, xy.y + o.top];
  });
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
  // Diagnostics for the framing e2e: endpoint mark boxes after the last camera move.
  const [marksDiag, setMarksDiag] = useState('');
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

  // Latest frame for the camera handlers below, which must not restart (and drop a pending fit)
  // when only the live aircraft refresh.
  const frameRef = useRef<RouteFrame | null>(null);
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const c = map.getCenter();
      setView({ center: [c.lng, c.lat], zoom: typeof map.getZoom === 'function' ? map.getZoom() : 2 });
      const fr = frameRef.current;
      const marks = fr ? currentMarks(map, fr, useMapInstanceStore.getState().projection === 'globe') : [];
      setMarksDiag(marks.length ? JSON.stringify(marks.map((b) => ({ label: b.label, kind: b.kind, box: [b.box.left, b.box.top, b.box.right, b.box.bottom].map(Math.round) }))) : '');
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

  // Framing, once per route/flight per map instance (a map rebuilt after context loss starts from
  // its initial camera, so it is framed again).
  const framed = useRef<{ key: string; map: unknown } | null>(null);
  const frameKey = p ? `route:${p.origin.ident}-${p.destination.ident}` : f ? `flight:${f.ident}` : null;
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);
  useEffect(() => {
    const fr = frameRef.current;
    const map = cameraMap;
    if (!map || !fr || !frameKey) return;
    if (framed.current?.key === frameKey && framed.current.map === map) return;
    if (!frameBounds(fr)) return;
    framed.current = { key: frameKey, map };
    const m = map as MapLibreMap;
    // `halted`: the viewer has the camera (gesture, a fly they asked for, PATHS closed) or the
    // effect ended — nothing here moves the camera any more.
    let halted = false;
    let refits = 0;
    let lastClear = false;
    let framedOnce = false;
    let layoutAt = -Infinity;
    let mapResized = false;
    const reduced = motion === 'reduced' || (motion === 'system' && prefersReducedMotion());
    const globeNow = () => useMapInstanceStore.getState().projection === 'globe';
    const solve = (): FrameFit | null => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      // Phone layout by the HUD's own media query (landscape phones have the sheet, no rail).
      const phone = isPhoneLayout();
      const panelOpen = useUiStore.getState().openPanel !== null;
      // The solver works within the map's minimum zoom (round 3 M2) and reports when the route
      // cannot fit at it, or which endpoints stay under chrome (PATHS then says so).
      const minZoom = typeof m.getMinZoom === 'function' ? m.getMinZoom() : 0;
      return solveFrame(fr, { projection: globeNow() ? 'globe' : 'mercator', viewport, area: frameArea(viewport, panelGeometry(phone, panelOpen), phone), obstacles: measureObstacles({ sheet: panelOpen }), minZoom, maxZoom: 8 });
    };
    const apply = (sol: FrameFit, animate: boolean) => {
      framedOnce = true;
      lastClear = sol.clear;
      setFitNotice({ key: frameKey, fits: sol.fits, hidden: sol.hidden });
      const duration = animate && !reduced ? FIT_DURATION_MS : 0;
      m.easeTo({ center: sol.center, zoom: sol.zoom, padding: sol.padding, bearing: 0, pitch: 0, duration, essential: false }, FRAMING_EVENT);
    };
    const fit = (animate: boolean) => {
      if (halted) return;
      const sol = solve();
      if (sol) apply(sol, animate);
    };

    // Chrome watch: the phone sheet publishes its height and lifts the attribution after the first
    // fit, a BASEMAP chip can appear seconds later, a phone rotates. When an endpoint dot or label
    // is now under an overlay or off screen, re-frame if the last framing was clear or a clear one
    // exists now; otherwise publish which endpoints are covered (PATHS names them).
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watching = true;
    const check = () => {
      timer = null;
      if (halted || !framedOnce) return;
      if (m.isMoving()) {
        schedule();
        return;
      }
      const W = window.innerWidth;
      const H = window.innerHeight;
      const obstacles = measureObstacles({ sheet: useUiStore.getState().openPanel !== null });
      const marks = currentMarks(m, fr, globeNow());
      const hidden = fr.endpoints
        .map((e) => e.label)
        .filter((label) => {
          const own = marks.filter((b) => b.label === label);
          return own.length < 2 || own.some(({ box }) => box.left < 0 || box.top < 0 || box.right > W || box.bottom > H || obstacles.some((o) => intersects(box, o)));
        });
      const notice = getFitNotice();
      const publish = (h: string[]) => {
        if (notice?.key === frameKey && notice.fits) setFitNotice({ ...notice, hidden: h });
      };
      if (!hidden.length) {
        lastClear = true;
        publish([]);
        return;
      }
      if (refits < MAX_REFITS) {
        const sol = solve();
        if (sol && (lastClear || sol.clear)) {
          refits++;
          apply(sol, true);
          return;
        }
      }
      publish(hidden);
    };
    const schedule = () => {
      if (!watching || halted) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, CHROME_SETTLE_MS);
    };
    const onWindowResize = () => {
      layoutAt = performance.now();
      schedule();
    };
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    mutations?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    const controls = m.getContainer().querySelector('.maplibregl-control-container');
    if (controls) mutations?.observe(controls, { childList: true, subtree: true, characterData: true });
    const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    for (const el of overlayElements()) resizes?.observe(el);
    window.addEventListener('resize', onWindowResize);
    const stopWatch = () => {
      watching = false;
      mutations?.disconnect();
      resizes?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const watchEnd = setTimeout(stopWatch, CHROME_WATCH_MS);
    const halt = () => {
      halted = true;
      stopWatch();
    };

    // Who moved the camera: the framing's own moves carry FRAMING_EVENT; a gesture carries its DOM
    // event; anything else after the first framing is a fly the viewer asked for (palette, preset,
    // search, alerts/intel row, reset view, projection switch) — except MapLibre's own resize move
    // (movestart → move → resize → moveend in one call) and moves right after a window resize.
    const onMoveStart = (e: CameraEvent) => {
      if (e.routeFraming) return;
      if (e.originalEvent) return halt();
      if (!framedOnce || performance.now() - layoutAt < LAYOUT_MOVE_MS) return;
      mapResized = false;
      queueMicrotask(() => {
        if (!mapResized) halt();
      });
    };
    const onMapResize = () => {
      mapResized = true;
    };
    // The framing's move ended: check what is really on screen (publishes covered endpoints).
    const onMoveEnd = (e: CameraEvent) => {
      if (e.routeFraming) schedule();
    };
    m.on('movestart', onMoveStart);
    m.on('resize', onMapResize);
    m.on('moveend', onMoveEnd);
    // A fly request or PATHS closing ends the framing even before the camera moves.
    const unsubUi = useUiStore.subscribe((s, prev) => {
      if ((s.flyTo && s.flyTo !== prev.flyTo) || (prev.openPanel === 'paths' && s.openPanel !== 'paths')) halt();
    });

    const onStyle = () => fit(true);
    if (styleParsed(m)) fit(true);
    else m.once('style.load', onStyle);
    // Re-issue when the map is published if it was not yet (a fly-in served at `load` would
    // otherwise leave the route off-screen).
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
      halt();
      unsub?.();
      unsubUi();
      clearTimeout(watchEnd);
      m.off('movestart', onMoveStart);
      m.off('resize', onMapResize);
      m.off('moveend', onMoveEnd);
      m.off('style.load', onStyle);
    };
  }, [cameraMap, frameKey, motion]);

  // Padding release: the framing's padding (the anchor between the chrome) lives while PATHS shows
  // the framed route/flight (or the next one is loading); when PATHS closes or nothing is framed
  // any more, the camera eases back to zero padding so later flies land at the screen centre and
  // `?c=` is the centre on screen.
  const pending = route ? plan.isFetching : ident ? flight.isFetching : false;
  const holdPadding = openPanel === 'paths' && (!!frameKey || pending);
  const heldPadding = useRef(false);
  useEffect(() => {
    if (holdPadding) {
      heldPadding.current = true;
      return;
    }
    if (!heldPadding.current || !cameraMap) return;
    heldPadding.current = false;
    const m = useUiStore.getState().settings.motion;
    return releaseFramePadding(cameraMap as MapLibreMap, m === 'reduced' || (m === 'system' && prefersReducedMotion()));
  }, [holdPadding, cameraMap]);

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
      data-fit={fitNotice && fitNotice.key === frameKey ? fitState(fitNotice) : ''}
      data-marks={marksDiag}
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
