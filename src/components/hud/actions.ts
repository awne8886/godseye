'use client';
/**
 * What each KEY_BINDINGS action does. The global key handler, the help overlay and the command
 * palette all go through runKeyAction(), so a key and its palette entry cannot disagree.
 * Owner: design-system-hud.
 */
import type { KeyAction } from '@/lib/keyboard';
import { useMapInstanceStore, useSelectionStore } from '@/lib/layer-host';
import { RESET_VIEW } from '@/lib/map/view';
import { useUiStore, type SensorMode } from '@/lib/store';
import { useHudStore } from './hud-store';

export function toggleFullscreen(): void {
  if (typeof document === 'undefined') return;
  try {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.();
  } catch {
    /* fullscreen not allowed (iframe/permissions) */
  }
}

export function resetView(): void {
  useUiStore.getState().requestFlyTo({
    lng: RESET_VIEW.longitude,
    lat: RESET_VIEW.latitude,
    zoom: RESET_VIEW.zoom,
    pitch: RESET_VIEW.pitch,
    bearing: RESET_VIEW.bearing,
  });
}

/** Globe ↔ flat. Terrain forces mercator, so switching with G also turns 3D terrain off. */
export function toggleProjection(): void {
  const ui = useUiStore.getState();
  ui.setLayer('terrain_elevation', false);
  ui.setProjection(ui.projection === 'globe' ? 'mercator' : 'globe');
}

export function setSensor(mode: SensorMode): void {
  useUiStore.getState().setSensor(mode);
}

/** The map centre (live map if mounted, else the last reported camera, else the reset view). */
export function mapCentre(): { lat: number; lng: number } {
  const map = useMapInstanceStore.getState().map;
  if (map) {
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }
  const cam = useUiStore.getState().camera;
  return cam ? { lat: cam.lat, lng: cam.lng } : { lat: RESET_VIEW.latitude, lng: RESET_VIEW.longitude };
}

/** ESC: close the innermost thing (flyout → panel/modal → entity card). */
export function closeTopmost(): boolean {
  const hud = useHudStore.getState();
  if (hud.pinnedFlyout) {
    hud.setPinnedFlyout(null);
    return true;
  }
  const ui = useUiStore.getState();
  if (ui.openPanel === 'dossier') {
    ui.closeDossier();
    return true;
  }
  if (ui.openPanel) {
    ui.setOpenPanel(null);
    return true;
  }
  const sel = useSelectionStore.getState();
  if (sel.selection) {
    sel.clear();
    return true;
  }
  return false;
}

export function runKeyAction(action: KeyAction): void {
  const ui = useUiStore.getState();
  switch (action) {
    case 'toggle-fullscreen':
      return toggleFullscreen();
    case 'open-share':
      return ui.setOpenPanel('share');
    case 'toggle-layers':
      return ui.togglePanel('layers');
    case 'toggle-markets':
      return ui.togglePanel('markets');
    case 'toggle-intel':
      return ui.togglePanel('intel');
    case 'reset-view':
      return resetView();
    case 'toggle-projection':
      return toggleProjection();
    case 'toggle-paths':
      return ui.togglePanel('paths');
    case 'open-help':
      return ui.togglePanel('help');
    case 'close':
      closeTopmost();
      return;
    case 'open-palette':
      return ui.setOpenPanel('palette');
    case 'open-search':
      return ui.setOpenPanel('search');
    case 'sensor-crt':
      return setSensor('crt');
    case 'sensor-nvg':
      return setSensor('nvg');
    case 'sensor-flir':
      return setSensor('flir');
    case 'sensor-noir':
      return setSensor('noir');
    case 'sensor-none':
      return setSensor('none');
  }
}

/** Focus is in something that takes text (inputs, textareas, selects, contenteditable, cmdk). */
export function isTextField(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
  }
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}
