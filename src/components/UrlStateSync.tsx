'use client';
/**
 * Keeps the shareable URL and the UI store in sync (§4: camera + layers + theme + panel +
 * route + flight). Restores once on load, then writes back with a 1.5 s debounce via nuqs.
 * Owner: lead.
 */
import { debounce, parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useRef } from 'react';
import { serializeLayersParam } from '@/lib/layer-registry';
import { useUiStore } from '@/lib/store';
import { parseUrlState, serializeCamera } from '@/lib/url-state';

const PARAMS = {
  c: parseAsString,
  layers: parseAsString,
  proj: parseAsString,
  theme: parseAsString,
  panel: parseAsString,
  route: parseAsString,
  flight: parseAsString,
};

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
    if (s.camera) ui.setCamera({ lng: s.camera.lng, lat: s.camera.lat, zoom: s.camera.zoom, pitch: s.camera.pitch, bearing: s.camera.bearing });
    if (s.panel) {
      const tool = s.panel as Parameters<typeof ui.openToolPanel>[0];
      ui.openToolPanel(tool);
    }
  }, [query]);

  // Write back.
  useEffect(
    () =>
      useUiStore.subscribe((s, prev) => {
        const patch: Partial<Record<keyof typeof PARAMS, string | null>> = {};
        if (s.activeLayers !== prev.activeLayers) patch.layers = serializeLayersParam(s.activeLayers);
        if (s.camera && s.camera !== prev.camera) patch.c = serializeCamera(s.camera);
        if (s.projection !== prev.projection) patch.proj = s.projection === 'globe' ? null : s.projection;
        if (s.openTool !== prev.openTool) patch.panel = s.openTool;
        if (s.theme !== prev.theme) patch.theme = s.theme === 'HORUS' ? null : s.theme;
        if (Object.keys(patch).length) void setQuery(patch);
      }),
    [setQuery],
  );

  return null;
}
