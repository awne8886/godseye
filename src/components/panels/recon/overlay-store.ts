'use client';
/**
 * UI state for the RECON family's map overlays: the active directions result, drawn features and
 * the DRAW tool mode, and imported ArcGIS layers. Small objects only (no per-frame data).
 * Rendered by ReconOverlays (the module's Background). Owner: panels-recon.
 */
import { create } from 'zustand';
import type { DirectionsResponse } from '@/lib/types';
import { circlePolygon, distanceM, sketchFeature, type DrawFeature, type DrawShape } from '../draw/geometry';

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
  /**
   * Switch tool (null = stop). A line/polygon sketch that can be finished is kept as a shape
   * first; work is only ever discarded by cancelSketch (CANCEL / Esc).
   */
  setDrawMode: (m: DrawShape | null) => void;
  setSketch: (s: [number, number][]) => void;
  /** FINISH (button, double-click, Enter): commit a line (≥ 2) / polygon (≥ 3) sketch; the tool stays armed. */
  finishSketch: () => DrawFeature | null;
  /** CANCEL / Esc: discard the shape in progress; the tool stays armed. */
  cancelSketch: () => void;
  /** DONE: keep a finishable sketch, then stop drawing (map taps select entities again). */
  stopDrawing: () => void;
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

export const useOverlayStore = create<OverlayState>((set, get) => ({
  route: null,
  setRoute: (route) => set({ route }),
  setActiveRoute: (active) => set((s) => (s.route ? { route: { ...s.route, active } } : s)),

  drawMode: null,
  sketch: [],
  features: [],
  setDrawMode: (drawMode) => {
    get().finishSketch();
    set({ drawMode, sketch: [] });
  },
  setSketch: (sketch) => set({ sketch }),
  finishSketch: () => {
    const { drawMode, sketch, features } = get();
    const f = sketchFeature(drawMode, sketch, nextId, features.length + 1);
    if (f) set({ features: [...features, f], sketch: [] });
    // A sketch that cannot become a shape yet stays, so a premature FINISH loses nothing.
    return f;
  },
  cancelSketch: () => set({ sketch: [] }),
  stopDrawing: () => get().setDrawMode(null),
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

/** One map click/tap while a DRAW tool is armed: drop a point, set a circle, or add a vertex. */
export function addDrawPoint(p: [number, number]): void {
  const st = useOverlayStore.getState();
  const { drawMode, sketch, features } = st;
  const n = features.length + 1;
  if (drawMode === 'point') {
    st.addFeatures([{ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { id: nextId('pt'), shape: 'point', name: `Point ${n}` } }]);
  } else if (drawMode === 'circle') {
    if (!sketch.length) st.setSketch([p]);
    else {
      const c = sketch[0]!;
      const r = distanceM(c, p);
      if (r > 0) st.addFeatures([{ type: 'Feature', geometry: circlePolygon(c, r), properties: { id: nextId('circle'), shape: 'circle', name: `Circle ${n}`, center: c, radiusM: r } }]);
      st.setSketch([]);
    }
  } else if (drawMode === 'line' || drawMode === 'polygon') {
    const last = sketch.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) st.setSketch([...sketch, p]);
  }
}

/** Zoom that fits a [w, s, e, n] box in roughly a 900 px viewport. */
export function zoomForBbox([w, s, e, n]: [number, number, number, number]): number {
  const span = Math.max(Math.abs(e - w), Math.abs(n - s) * 1.6, 0.0005);
  return Math.max(1.5, Math.min(16, Math.log2(360 / span) + 0.6));
}
