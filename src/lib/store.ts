/**
 * UI state (zustand). Only UI state lives here — never per-frame entity data.
 * Select with narrow selectors or `useShallow` to avoid re-render storms.
 * URL-synchronised fields (layers, camera, projection, theme, panel, pinned, route, flight, dossier)
 * are mirrored by src/components/UrlStateSync.tsx via src/lib/url-state.ts. The `settings` slice is
 * persisted to localStorage (per viewer, best-effort). Owner: lead.
 */
'use client';

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { DEFAULT_ACTIVE_LAYERS, type LayerId } from './layer-registry';
import type { PanelId } from './tool-registry';

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

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlannedRoute {
  from: string;
  to: string;
}

/** Per-viewer preferences (Settings panel). Persisted; never sent to the server. */
export interface Settings {
  units: 'metric' | 'imperial' | 'aviation';
  /** `system` follows prefers-reduced-motion. */
  motion: 'system' | 'reduced' | 'full';
  /** Browser geolocation is only requested after an explicit opt-in. */
  geoConsent: 'ask' | 'granted' | 'denied';
  /** CCTV/live-news previews play automatically (off = click to play). */
  previewAutoplay: boolean;
  /** Preferred AI provider when several are configured; `auto` = server's choice. */
  aiProvider: 'auto' | 'claude' | 'gemini' | 'ollama' | 'analyst';
}

export const DEFAULT_SETTINGS: Settings = {
  units: 'aviation',
  motion: 'system',
  geoConsent: 'ask',
  previewAutoplay: true,
  aiProvider: 'auto',
};

/** Flight Watch and live trails follow at most this many aircraft (§8). */
export const MAX_WATCHED_FLIGHTS = 6;
/** At most this many floating panels are pinned at once (URL `?pinned=` has the same cap). */
export const MAX_PINNED_PANELS = 6;

export interface UiState {
  activeLayers: ReadonlySet<LayerId>;
  projection: Projection;
  basemap: Basemap;
  /** Style Studio preset id (HORUS default). */
  theme: string;
  ghost: boolean;
  sensor: SensorMode;
  /** The one open right-side panel (tools and card-launched panels are mutually exclusive). */
  openPanel: PanelId | null;
  /** Floating/pinned panels that may coexist with the open panel (≤ 6, never the open panel). */
  pinnedPanels: readonly PanelId[];
  /**
   * Region Dossier target (double right-click / long-press / palette "Dossier at map centre").
   * Invariant: non-null exactly when `openPanel === 'dossier'`.
   */
  dossierTarget: LatLng | null;
  /** ICAO 6-hex ids (`~` prefix for non-ICAO/TIS-B) followed by Flight Watch with trails, oldest first. */
  watchedFlights: readonly string[];
  /** Flight Path Planner origin/destination (`?route=`). */
  plannedRoute: PlannedRoute | null;
  /** "Track my flight" ident (`?flight=`): callsign, IATA flight number, registration or hex. */
  flightIdent: string | null;
  flyTo: FlyToRequest | null;
  /** Last camera reported by the map (for share URLs and restore). */
  camera: Camera | null;
  /** True when the initial camera came from the URL, so the intro fly-to is skipped. */
  cameraFromUrl: boolean;
  splashDone: boolean;
  settings: Settings;

  setLayer: (id: LayerId, on: boolean) => void;
  toggleLayer: (id: LayerId) => void;
  setLayers: (ids: Iterable<LayerId>) => void;
  setProjection: (p: Projection) => void;
  setBasemap: (b: Basemap) => void;
  setTheme: (t: string) => void;
  setGhost: (g: boolean) => void;
  setSensor: (m: SensorMode) => void;
  setOpenPanel: (p: PanelId | null) => void;
  togglePanel: (p: PanelId) => void;
  pinPanel: (p: PanelId) => void;
  unpinPanel: (p: PanelId) => void;
  setPinnedPanels: (p: readonly PanelId[]) => void;
  /** Sets the dossier target and opens the dossier panel. */
  openDossier: (target: LatLng) => void;
  closeDossier: () => void;
  /** Adds a hex to the watch list (drops the oldest beyond MAX_WATCHED_FLIGHTS). */
  watchFlight: (hex: string) => void;
  unwatchFlight: (hex: string) => void;
  setPlannedRoute: (r: PlannedRoute | null) => void;
  setFlightIdent: (ident: string | null) => void;
  requestFlyTo: (r: Omit<FlyToRequest, 'ts'>) => void;
  setCamera: (c: Camera, fromUrl?: boolean) => void;
  setSplashDone: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

let flySeq = 0;

/** localStorage that never throws (private mode, blocked storage, SSR). */
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return globalThis.localStorage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      globalThis.localStorage?.setItem(k, v);
    } catch {
      /* storage unavailable: settings stay in memory */
    }
  },
  removeItem: (k) => {
    try {
      globalThis.localStorage?.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

/** Same id rule as Aircraft.id: ICAO 24-bit hex, `~` for non-ICAO (TIS-B) addresses. */
const HEX_RE = /^~?[0-9a-f]{6}$/;

const pinnable = (list: readonly PanelId[], open: PanelId | null) => [...new Set(list)].filter((p) => p !== open).slice(0, MAX_PINNED_PANELS);

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeLayers: new Set(DEFAULT_ACTIVE_LAYERS),
      projection: 'globe',
      basemap: 'dark',
      theme: 'HORUS',
      ghost: false,
      sensor: 'none',
      openPanel: null,
      pinnedPanels: [],
      dossierTarget: null,
      watchedFlights: [],
      plannedRoute: null,
      flightIdent: null,
      flyTo: null,
      camera: null,
      cameraFromUrl: false,
      splashDone: false,
      settings: DEFAULT_SETTINGS,

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
      setOpenPanel: (openPanel) =>
        set((s) => ({
          openPanel,
          dossierTarget: openPanel === 'dossier' ? s.dossierTarget : null,
          pinnedPanels: openPanel && s.pinnedPanels.includes(openPanel) ? pinnable(s.pinnedPanels, openPanel) : s.pinnedPanels,
        })),
      togglePanel: (p) =>
        set((s) => {
          const openPanel = s.openPanel === p ? null : p;
          return {
            openPanel,
            dossierTarget: openPanel === 'dossier' ? s.dossierTarget : null,
            pinnedPanels: openPanel && s.pinnedPanels.includes(openPanel) ? pinnable(s.pinnedPanels, openPanel) : s.pinnedPanels,
          };
        }),
      pinPanel: (p) =>
        set((s) => (s.pinnedPanels.includes(p) || p === s.openPanel || s.pinnedPanels.length >= MAX_PINNED_PANELS ? s : { pinnedPanels: [...s.pinnedPanels, p] })),
      unpinPanel: (p) => set((s) => ({ pinnedPanels: s.pinnedPanels.filter((x) => x !== p) })),
      setPinnedPanels: (p) => set((s) => ({ pinnedPanels: pinnable(p, s.openPanel) })),
      openDossier: (target) =>
        set((s) => ({ dossierTarget: { lat: target.lat, lng: target.lng }, openPanel: 'dossier', pinnedPanels: pinnable(s.pinnedPanels, 'dossier') })),
      closeDossier: () => set((s) => ({ dossierTarget: null, openPanel: s.openPanel === 'dossier' ? null : s.openPanel })),
      watchFlight: (hex) =>
        set((s) => {
          const h = hex.trim().toLowerCase();
          if (!HEX_RE.test(h) || s.watchedFlights.includes(h)) return s;
          return { watchedFlights: [...s.watchedFlights, h].slice(-MAX_WATCHED_FLIGHTS) };
        }),
      unwatchFlight: (hex) => set((s) => ({ watchedFlights: s.watchedFlights.filter((x) => x !== hex.trim().toLowerCase()) })),
      setPlannedRoute: (plannedRoute) => set({ plannedRoute }),
      setFlightIdent: (flightIdent) => set({ flightIdent }),
      // A monotonic sequence, not wall-clock time, so two requests in one millisecond still differ.
      requestFlyTo: (r) => set({ flyTo: { ...r, ts: ++flySeq } }),
      setCamera: (camera, fromUrl) => set(fromUrl ? { camera, cameraFromUrl: true } : { camera }),
      setSplashDone: () => set({ splashDone: true }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    {
      name: 'godseye:settings',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ settings: s.settings }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { settings?: Partial<Settings> };
        return { ...current, settings: sanitizeSettings(p.settings) };
      },
    },
  ),
);

/** Drops unknown or malformed persisted values (storage is user-editable). */
export function sanitizeSettings(raw: Partial<Settings> | undefined): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  if (raw.units === 'metric' || raw.units === 'imperial' || raw.units === 'aviation') out.units = raw.units;
  if (raw.motion === 'system' || raw.motion === 'reduced' || raw.motion === 'full') out.motion = raw.motion;
  if (raw.geoConsent === 'ask' || raw.geoConsent === 'granted' || raw.geoConsent === 'denied') out.geoConsent = raw.geoConsent;
  if (typeof raw.previewAutoplay === 'boolean') out.previewAutoplay = raw.previewAutoplay;
  if (raw.aiProvider && ['auto', 'claude', 'gemini', 'ollama', 'analyst'].includes(raw.aiProvider)) out.aiProvider = raw.aiProvider;
  return out;
}
