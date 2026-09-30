'use client';
/**
 * Applies UI state to <html>: `data-theme` (Style Studio preset, persisted to `godseye:theme` for
 * the pre-paint boot script), `data-ghost` (Ghost Protocol, applied last), studio inline custom
 * properties, `data-sensor` and `data-motion`. Fires `godseye:style` after each change so the map
 * re-reads its --map-* palette. Owner: design-system-hud.
 */
import { useEffect, useRef } from 'react';
import { THEME_STORAGE_KEY } from '@/lib/theme-boot';
import { useUiStore } from '@/lib/store';
import { useStudioStore } from './hud-store';
import { STUDIO_VAR_NAMES, STYLE_EVENT, isEmptyStudio, isPresetId, studioVars } from './style-engine';

function announce() {
  window.dispatchEvent(new CustomEvent(STYLE_EVENT));
  // A second read after layout lands, for renderers that sample computed styles.
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(STYLE_EVENT)));
}

let transitionTimer: ReturnType<typeof setTimeout> | null = null;
function crossFade(root: HTMLElement) {
  root.classList.add('theme-transition');
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => root.classList.remove('theme-transition'), 650);
}

export default function ThemeSync() {
  const theme = useUiStore((s) => s.theme);
  const ghost = useUiStore((s) => s.ghost);
  const sensor = useUiStore((s) => s.sensor);
  const motionPref = useUiStore((s) => s.settings.motion);
  const studio = useStudioStore((s) => s.settings);
  const loaded = useStudioStore((s) => s.loaded);
  const first = useRef(true);

  // Restore once: the saved preset (unless the URL named one) and the saved studio edits.
  useEffect(() => {
    useStudioStore.getState().load();
    const hasUrlTheme = new URLSearchParams(window.location.search).has('theme');
    if (!hasUrlTheme && useUiStore.getState().theme === 'HORUS') {
      try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY)?.toUpperCase();
        if (saved && isPresetId(saved) && saved !== 'HORUS') useUiStore.getState().setTheme(saved);
      } catch {
        /* storage blocked */
      }
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (first.current) {
      first.current = false;
      // The boot script already painted the URL/saved preset; the store catches up on the next
      // render (restore above or UrlStateSync), so don't flash HORUS in between.
      if (theme === 'HORUS' && root.hasAttribute('data-theme')) return;
    } else crossFade(root);
    if (isPresetId(theme) && theme !== 'HORUS') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    try {
      localStorage.setItem(THEME_STORAGE_KEY, isPresetId(theme) ? theme : 'HORUS');
    } catch {
      /* storage blocked */
    }
    announce();
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (ghost) root.setAttribute('data-ghost', '');
    else root.removeAttribute('data-ghost');
    announce();
  }, [ghost]);

  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    const vars = studioVars(studio, { ghost });
    for (const name of STUDIO_VAR_NAMES) if (!(name in vars)) root.style.removeProperty(name);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    if (isEmptyStudio(studio)) root.removeAttribute('data-studio');
    else root.setAttribute('data-studio', 'on');
    announce();
  }, [studio, ghost, loaded]);

  useEffect(() => {
    const root = document.documentElement;
    if (sensor === 'none') root.removeAttribute('data-sensor');
    else root.setAttribute('data-sensor', sensor);
  }, [sensor]);

  useEffect(() => {
    const root = document.documentElement;
    if (motionPref === 'reduced') root.setAttribute('data-motion', 'reduced');
    else root.removeAttribute('data-motion');
  }, [motionPref]);

  return null;
}
