'use client';
/**
 * Keeps the shareable URL and the UI store in sync (§4: camera + layers + projection + theme +
 * open/pinned panels + route + flight + dossier). Restores once on load, then writes back with a
 * 1.5 s debounce via nuqs. OSIRIS `?lat=&lon=&zoom=` links are read once and rewritten as `?c=`.
 * Owner: lead.
 */
import { debounce, parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useRef } from 'react';
import { serializeLayersParam } from '@/lib/layer-registry';
import { useUiStore } from '@/lib/store';
import { parseUrlState, serializeCamera, serializeLatLng, serializeRouteParam } from '@/lib/url-state';

const PARAMS = {
  c: parseAsString,
  layers: parseAsString,
  proj: parseAsString,
  theme: parseAsString,
  panel: parseAsString,
  pinned: parseAsString,
  route: parseAsString,
  flight: parseAsString,
  dossier: parseAsString,
  // Legacy OSIRIS camera params: read once, then removed.
  lat: parseAsString,
  lon: parseAsString,
  lng: parseAsString,
  zoom: parseAsString,
};

type Patch = Partial<Record<keyof typeof PARAMS, string | null>>;

export default function UrlStateSync() {
  const [query, setQuery] = useQueryStates(PARAMS, { history: 'replace', limitUrlUpdates: debounce(1500) });
  const restored = useRef(false);

  // Restore once.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (typeof v === 'string') params.set(k, v);
    const s = parseUrlState(params);
    const ui = useUiStore.getState();
    if (s.layers) ui.setLayers(s.layers);
    if (s.projection) ui.setProjection(s.projection);
    if (s.theme) ui.setTheme(s.theme);
    if (s.camera) ui.setCamera({ lng: s.camera.lng, lat: s.camera.lat, zoom: s.camera.zoom, pitch: s.camera.pitch, bearing: s.camera.bearing }, true);
    if (s.pinned) ui.setPinnedPanels(s.pinned);
    if (s.route) ui.setPlannedRoute(s.route);
    if (s.flight) ui.setFlightIdent(s.flight);
    if (s.dossier) ui.openDossier(s.dossier);
    else if (s.panel) ui.setOpenPanel(s.panel);
    if (query.lat !== null || query.lon !== null || query.lng !== null || query.zoom !== null) {
      void setQuery({ lat: null, lon: null, lng: null, zoom: null, c: s.camera ? serializeCamera(s.camera) : query.c });
    }
  }, [query, setQuery]);

  // Write back.
  useEffect(
    () =>
      useUiStore.subscribe((s, prev) => {
        const patch: Patch = {};
        if (s.activeLayers !== prev.activeLayers) patch.layers = serializeLayersParam(s.activeLayers);
        if (s.camera && s.camera !== prev.camera) patch.c = serializeCamera(s.camera);
        if (s.projection !== prev.projection) patch.proj = s.projection === 'globe' ? null : s.projection;
        if (s.openPanel !== prev.openPanel) patch.panel = s.openPanel;
        if (s.pinnedPanels !== prev.pinnedPanels) patch.pinned = s.pinnedPanels.length ? s.pinnedPanels.join(',') : null;
        if (s.plannedRoute !== prev.plannedRoute) patch.route = s.plannedRoute ? serializeRouteParam(s.plannedRoute) : null;
        if (s.flightIdent !== prev.flightIdent) patch.flight = s.flightIdent;
        if (s.dossierTarget !== prev.dossierTarget) patch.dossier = s.dossierTarget ? serializeLatLng(s.dossierTarget) : null;
        if (s.theme !== prev.theme) patch.theme = s.theme === 'HORUS' ? null : s.theme;
        if (Object.keys(patch).length) void setQuery(patch);
      }),
    [setQuery],
  );

  return null;
}
