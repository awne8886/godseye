'use client';
/**
 * UI state for the RECON family's map overlays: the active directions result, drawn features and
 * the DRAW tool mode, and imported ArcGIS layers. Small objects only (no per-frame data).
 * Rendered by ReconOverlays (the module's Background). Owner: panels-recon.
 */
import { create } from 'zustand';
import type { DirectionsResponse } from '@/lib/types';
import type { DrawFeature, DrawShape } from '../draw/geometry';

export interface ArcgisLayer {
  id: string;
  title: string;
  source: string;
  fc: GeoJSON.FeatureCollection;
  truncated: boolean;
  visible: boolean;
  importedAt: string;
}

export interface RouteState {
  result: DirectionsResponse;
  active: number;
  /** [lng, lat] of from, via…, to. */
  stops: [number, number][];
}

interface OverlayState {
  route: RouteState | null;
  setRoute: (r: RouteState | null) => void;
  setActiveRoute: (i: number) => void;

  drawMode: DrawShape | null;
  /** Vertices of the shape being drawn ([lng, lat]). */
  sketch: [number, number][];
  features: DrawFeature[];
  setDrawMode: (m: DrawShape | null) => void;
  setSketch: (s: [number, number][]) => void;
  addFeatures: (f: DrawFeature[]) => void;
  removeFeature: (id: string) => void;
  toggleAoi: (id: string) => void;
  clearFeatures: () => void;

  arcgis: ArcgisLayer[];
  addArcgis: (l: ArcgisLayer) => void;
  toggleArcgis: (id: string) => void;
  removeArcgis: (id: string) => void;
}

export const MAX_ARCGIS_LAYERS = 8;

export const useOverlayStore = create<OverlayState>((set) => ({
  route: null,
  setRoute: (route) => set({ route }),
  setActiveRoute: (active) => set((s) => (s.route ? { route: { ...s.route, active } } : s)),

  drawMode: null,
  sketch: [],
  features: [],
  setDrawMode: (drawMode) => set({ drawMode, sketch: [] }),
  setSketch: (sketch) => set({ sketch }),
  addFeatures: (f) => set((s) => ({ features: [...s.features, ...f] })),
  removeFeature: (id) => set((s) => ({ features: s.features.filter((f) => f.properties.id !== id) })),
  toggleAoi: (id) => set((s) => ({ features: s.features.map((f) => (f.properties.id === id ? { ...f, properties: { ...f.properties, aoi: !f.properties.aoi } } : f)) })),
  clearFeatures: () => set({ features: [], sketch: [] }),

  arcgis: [],
  addArcgis: (l) => set((s) => ({ arcgis: [...s.arcgis.filter((x) => x.source !== l.source), l].slice(-MAX_ARCGIS_LAYERS) })),
  toggleArcgis: (id) => set((s) => ({ arcgis: s.arcgis.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) })),
  removeArcgis: (id) => set((s) => ({ arcgis: s.arcgis.filter((l) => l.id !== id) })),
}));

let seq = 0;
/** Deterministic, session-unique ids (no randomness). */
export const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Zoom that fits a [w, s, e, n] box in roughly a 900 px viewport. */
export function zoomForBbox([w, s, e, n]: [number, number, number, number]): number {
  const span = Math.max(Math.abs(e - w), Math.abs(n - s) * 1.6, 0.0005);
  return Math.max(1.5, Math.min(16, Math.log2(360 / span) + 0.6));
}
