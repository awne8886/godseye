'use client';
/**
 * Always-mounted Flight Path Planner map layer (FeatureModule.Background): draws the planned route
 * (`?route=` / store.plannedRoute) and the tracked flight (`?flight=` / store.flightIdent) with
 * the live aircraft on the pair, re-reads colours on theme changes, filters billboards to the
 * visible hemisphere on the globe, and frames a new route once. A deep link opens the PATHS panel.
 * Client-only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDeckLayers, useMapInstance, useMapInstanceStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import type { LngLatTuple } from '@/lib/geo';
import { useFlight, useLive, usePlan } from './api';
import { buildRouteLayers, cameraFor } from './layers';

/** Above aviation (80–83) so the route and its aircraft rings sit on top. */
const Z = 90;

export default function RouteLayer() {
  const route = useUiStore((s) => s.plannedRoute);
  const ident = useUiStore((s) => s.flightIdent);
  const theme = useUiStore((s) => s.theme);
  const openPanel = useUiStore((s) => s.openPanel);
  const setOpenPanel = useUiStore((s) => s.setOpenPanel);
  const requestFlyTo = useUiStore((s) => s.requestFlyTo);
  const map = useMapInstance();
  const projection = useMapInstanceStore((s) => s.projection);
  const [center, setCenter] = useState<LngLatTuple>([0, 20]);
  const [themeTick, setThemeTick] = useState(0);

  const plan = usePlan(route);
  const live = useLive(route, openPanel === 'paths' || !!route);
  const flight = useFlight(route ? null : ident);

  // A deep link (?route= / ?flight=) restores the panel once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if ((route || ident) && openPanel === null) setOpenPanel('paths');
  }, [route, ident, openPanel, setOpenPanel]);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const c = map.getCenter();
      setCenter([c.lng, c.lat]);
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

  // Frame each newly planned route once per map instance (midpoint towards the camera on the
  // globe). A map rebuilt by the host (context loss) starts from its initial camera: frame again.
  const framed = useRef<{ key: string; map: unknown } | null>(null);
  useEffect(() => {
    const p = plan.data;
    if (!p || !map) return;
    const key = `${p.origin.ident}-${p.destination.ident}`;
    if (framed.current?.key === key && framed.current.map === map) return;
    framed.current = { key, map };
    requestFlyTo({ ...cameraFor(p), durationMs: 1200 });
  }, [plan.data, map, requestFlyTo]);
  const framedFlight = useRef<{ key: string; map: unknown } | null>(null);
  useEffect(() => {
    const f = flight.data;
    if (!f || !map) return;
    if (framedFlight.current?.key === f.ident && framedFlight.current.map === map) return;
    framedFlight.current = { key: f.ident, map };
    const target = f.position ?? f.origin;
    if (target) requestFlyTo({ lng: target.lng, lat: target.lat, zoom: 4, durationMs: 1200 });
  }, [flight.data, map, requestFlyTo]);

  const layers = useMemo(() => {
    const p = route ? (plan.data ?? null) : null;
    const f = !route && ident ? (flight.data ?? null) : null;
    if (!p && !f) return null;
    return buildRouteLayers({ plan: p, live: route ? (live.data ?? null) : null, flight: f, globe: projection === 'globe', center, theme: themeTick });
  }, [route, ident, plan.data, live.data, flight.data, projection, center, themeTick]);

  useDeckLayers('flight-paths', layers, Z);
  // Diagnostics for tests (what is drawn, from which request); no visible output.
  return (
    <div
      hidden
      data-testid="flight-paths-status"
      data-route={route ? `${route.from}-${route.to}` : ''}
      data-flight={ident ?? ''}
      data-layers={(layers ?? []).map((l) => (l && typeof l === 'object' && 'id' in l ? String(l.id) : '')).join(',')}
      data-points={plan.data?.greatCircle.points.length ?? flight.data?.plannedArc.length ?? 0}
    />
  );
}
