/**
 * UI state (zustand). Only UI state lives here — never per-frame entity data.
 * Select with narrow selectors or `useShallow` to avoid re-render storms.
 * URL-synchronised fields (layers, camera, theme, panel, route, flight) are mirrored by
 * src/lib/url-state.ts. Owner: lead.
 */
'use client';

import { create } from 'zustand';
import { DEFAULT_ACTIVE_LAYERS, type LayerId } from './layer-registry';
import type { PanelId, ToolId } from './tool-registry';

export type Projection = 'globe' | 'mercator';
export type Basemap = 'dark' | 'satellite';
export type SensorMode = 'none' | 'crt' | 'nvg' | 'flir' | 'noir';

export interface Camera {
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

/** A camera move request. `ts` makes identical targets re-fire. */
export interface FlyToRequest extends Partial<Camera> {
  lng: number;
  lat: number;
  durationMs?: number;
  ts: number;
}

export interface UiState {
  activeLayers: ReadonlySet<LayerId>;
  projection: Projection;
  basemap: Basemap;
  /** Style Studio preset id (HORUS default). */
  theme: string;
  ghost: boolean;
  sensor: SensorMode;
  /** The one open right-rail tool (mutually exclusive set). */
  openTool: ToolId | null;
  /** Floating/pinned panels that may coexist with the open tool. */
  pinnedPanels: readonly PanelId[];
  flyTo: FlyToRequest | null;
  /** Last camera reported by the map (for share URLs and restore). */
  camera: Camera | null;
  splashDone: boolean;

  setLayer: (id: LayerId, on: boolean) => void;
  toggleLayer: (id: LayerId) => void;
  setLayers: (ids: Iterable<LayerId>) => void;
  setProjection: (p: Projection) => void;
  setBasemap: (b: Basemap) => void;
  setTheme: (t: string) => void;
  setGhost: (g: boolean) => void;
  setSensor: (m: SensorMode) => void;
  openToolPanel: (t: ToolId | null) => void;
  toggleTool: (t: ToolId) => void;
  pinPanel: (p: PanelId) => void;
  unpinPanel: (p: PanelId) => void;
  requestFlyTo: (r: Omit<FlyToRequest, 'ts'>) => void;
  setCamera: (c: Camera) => void;
  setSplashDone: () => void;
}

let flySeq = 0;

export const useUiStore = create<UiState>((set) => ({
  activeLayers: new Set(DEFAULT_ACTIVE_LAYERS),
  projection: 'globe',
  basemap: 'dark',
  theme: 'HORUS',
  ghost: false,
  sensor: 'none',
  openTool: null,
  pinnedPanels: [],
  flyTo: null,
  camera: null,
  splashDone: false,

  setLayer: (id, on) =>
    set((s) => {
      if (s.activeLayers.has(id) === on) return s;
      const next = new Set(s.activeLayers);
      if (on) next.add(id);
      else next.delete(id);
      return { activeLayers: next };
    }),
  toggleLayer: (id) =>
    set((s) => {
      const next = new Set(s.activeLayers);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { activeLayers: next };
    }),
  setLayers: (ids) => set({ activeLayers: new Set(ids) }),
  setProjection: (projection) => set({ projection }),
  setBasemap: (basemap) => set({ basemap }),
  setTheme: (theme) => set({ theme }),
  setGhost: (ghost) => set({ ghost }),
  setSensor: (sensor) => set({ sensor }),
  openToolPanel: (openTool) => set({ openTool }),
  toggleTool: (t) => set((s) => ({ openTool: s.openTool === t ? null : t })),
  pinPanel: (p) => set((s) => (s.pinnedPanels.includes(p) ? s : { pinnedPanels: [...s.pinnedPanels, p] })),
  unpinPanel: (p) => set((s) => ({ pinnedPanels: s.pinnedPanels.filter((x) => x !== p) })),
  // A monotonic sequence, not wall-clock time, so two requests in one millisecond still differ.
  requestFlyTo: (r) => set({ flyTo: { ...r, ts: ++flySeq } }),
  setCamera: (camera) => set({ camera }),
  setSplashDone: () => set({ splashDone: true }),
}));
