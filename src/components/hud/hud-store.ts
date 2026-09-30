'use client';
/**
 * HUD-local UI state (not URL-synchronised): the pinned layer flyout and Style Studio edits.
 * The studio slice persists to localStorage `godseye:style-studio` (sanitised on read).
 * Owner: design-system-hud.
 */
import { create } from 'zustand';
import type { LayerGroupId } from '@/lib/layer-registry';
import { EMPTY_STUDIO, STUDIO_STORAGE_KEY, sanitizeStudio, type StudioSettings } from './style-engine';

interface HudState {
  /** Group whose flyout is pinned open (click), or null. */
  pinnedFlyout: LayerGroupId | null;
  setPinnedFlyout: (g: LayerGroupId | null) => void;
}

export const useHudStore = create<HudState>((set) => ({
  pinnedFlyout: null,
  setPinnedFlyout: (pinnedFlyout) => set({ pinnedFlyout }),
}));

function readStudio(): StudioSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STUDIO_STORAGE_KEY);
    return raw ? sanitizeStudio(JSON.parse(raw)) : EMPTY_STUDIO;
  } catch {
    return EMPTY_STUDIO;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveStudio(s: StudioSettings) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      globalThis.localStorage?.setItem(STUDIO_STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* storage blocked: edits stay for this session */
    }
  }, 250);
}

interface StudioState {
  settings: StudioSettings;
  loaded: boolean;
  load: () => void;
  set: (s: StudioSettings) => void;
  reset: () => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  settings: EMPTY_STUDIO,
  loaded: false,
  load: () => set({ settings: readStudio(), loaded: true }),
  set: (settings) => {
    const clean = sanitizeStudio(settings);
    saveStudio(clean);
    set({ settings: clean });
  },
  reset: () => {
    try {
      globalThis.localStorage?.removeItem(STUDIO_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    set({ settings: EMPTY_STUDIO });
  },
}));
