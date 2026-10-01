'use client';
/**
 * DRAW: points, lines, polygons and geodesic circles with turf measurements in the visitor's
 * units; GeoJSON import/export; mark a polygon as the Area of Interest (AOI) and open the Region
 * Dossier at its centre or export its bounding box. Map clicks are captured only while a tool is
 * active (ReconOverlays), and then never select entities. Lines and polygons end with FINISH (the
 * touch path; double-click and Enter also work), CANCEL discards the sketch, DONE stops the tool
 * and keeps a finishable shape. Owner: panels-recon.
 */
import { Check, Circle, Download, FileUp, MapPin, Pentagon, Spline, Target, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { mediaQueryStore } from '@/lib/map/view';
import { useUiStore } from '@/lib/store';
import { HudButton, Prose, SectionTitle, downloadJson } from '../recon/ui';
import { nextId, useOverlayStore, zoomForBbox } from '../recon/overlay-store';
import { featureBbox, featureCentre, formatArea, formatDistance, measure, parseGeoJson, sketchFeature, toFeatureCollection, verticesToFinish, type DrawShape, type Units } from './geometry';

interface Tool {
  id: DrawShape;
  label: string;
  Icon: typeof MapPin;
  /** Mouse/keyboard wording. */
  hint: string;
  /** Touch wording (coarse pointer): no double-click or keys, FINISH instead. */
  touch: string;
}

export const TOOLS: readonly Tool[] = [
  { id: 'point', label: 'Point', Icon: MapPin, hint: 'Click the map to drop a point.', touch: 'Tap the map to drop a point.' },
  { id: 'line', label: 'Line', Icon: Spline, hint: 'Click to add vertices; FINISH, double-click or Enter ends the line; CANCEL or Esc discards it.', touch: 'Tap to add vertices, then tap FINISH. CANCEL discards the line.' },
  { id: 'polygon', label: 'Polygon', Icon: Pentagon, hint: 'Click to add corners; FINISH, double-click or Enter closes the shape; CANCEL or Esc discards it.', touch: 'Tap to add 3 or more corners, then tap FINISH to close the shape. CANCEL discards it.' },
  { id: 'circle', label: 'Circle', Icon: Circle, hint: 'Click the centre, then click again at the radius.', touch: 'Tap the centre, then tap again at the radius.' },
];

const coarsePointer = mediaQueryStore('(pointer: coarse)');
/** Touch-first device (phones, tablets): hints say "tap" and point at FINISH. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(coarsePointer.subscribe, coarsePointer.get, () => false);
}

/** Live readout of the shape in progress: vertex count, what FINISH still needs, and its measurement. */
export function sketchStatus(mode: DrawShape | null, sketch: readonly [number, number][], units: Units): string | null {
  if (!mode || !sketch.length) return null;
  if (mode === 'circle') return 'Centre set: now the radius point';
  const parts = [`${sketch.length} ${sketch.length === 1 ? 'vertex' : 'vertices'}`];
  const need = verticesToFinish(mode, sketch);
  if (need) parts.push(`${need} more to finish`);
  const f = sketchFeature(mode, sketch, () => 'sketch', 0);
  if (f) {
    const m = measure(f);
    if (m.lengthM !== null) parts.push(formatDistance(m.lengthM, units));
    if (m.areaM2 !== null) parts.push(formatArea(m.areaM2, units));
  }
  return parts.join(' · ');
}

export default function DrawPanel(_: PanelProps) {
  const units = useUiStore((s) => s.settings.units);
  const requestFlyTo = useUiStore((s) => s.requestFlyTo);
  const openDossier = useUiStore((s) => s.openDossier);
  const { drawMode, setDrawMode, features, removeFeature, toggleAoi, clearFeatures, addFeatures, sketch, finishSketch, cancelSketch, stopDrawing } = useOverlayStore();
  const coarse = useCoarsePointer();
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  usePanelChip(drawMode ? 'PLOTTING' : features.length ? `${features.length} SHAPES` : 'STANDBY', drawMode ? 'busy' : features.length ? 'live' : 'idle');
  // Closing the panel ends the drawing session (a finishable sketch is kept): map clicks go back to normal selection.
  useEffect(() => () => useOverlayStore.getState().stopDrawing(), []);
  const status = useMemo(() => sketchStatus(drawMode, sketch, units), [drawMode, sketch, units]);
  const need = verticesToFinish(drawMode, sketch);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const r = parseGeoJson(await file.text(), () => nextId('import'));
    if ('error' in r) setMsg(`Import failed: ${r.error}`);
    else {
      addFeatures(r.features);
      setMsg(`Imported ${r.features.length} shapes${r.skipped ? `, skipped ${r.skipped} unsupported/invalid` : ''}.`);
      const bb = featureBbox({ type: 'FeatureCollection', features: r.features });
      requestFlyTo({ lat: (bb[1] + bb[3]) / 2, lng: (bb[0] + bb[2]) / 2, zoom: zoomForBbox(bb), durationMs: 1800 });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const tool = TOOLS.find((t) => t.id === drawMode);
  // Two columns: at 326 px a 4-up grid squeezed the icons to nothing next to "POLYGON" (visual-qa M7).
  const toolGrid = (
    <div key="tools" className="grid grid-cols-2 gap-1.5" role="group" aria-label="Drawing tools">
      {TOOLS.map(({ id, label, Icon }) => (
        <HudButton key={id} tone={drawMode === id ? 'cyan' : 'muted'} pressed={drawMode === id} onClick={() => setDrawMode(drawMode === id ? null : id)}>
          <Icon size={14} aria-hidden className="shrink-0" data-testid={`draw-tool-icon-${id}`} /> {label}
        </HudButton>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col gap-3" data-testid="draw-panel">
      {/* While a tool is armed the sketch status and FINISH/CANCEL/DONE come first, so a landscape
          phone's short sheet shows them without scrolling (r5). Keyed, so flipping the order inserts
          the sketch block without remounting the tool grid (focus stays on the button just pressed). */}
      {tool
        ? [
            <div key="sketch" className="flex flex-col gap-2">
              <Prose>{coarse ? tool.touch : tool.hint}</Prose>
              {status && (
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] tabular-nums text-[var(--cyan-primary)]" data-testid="draw-sketch" aria-live="polite">
                  {status}
                </p>
              )}
              {/* FINISH commits, CANCEL discards, DONE stops the tool (keeping a finishable shape). 44 px on phones. */}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sketch actions">
                {need !== null && (
                  <HudButton
                    tone="cyan"
                    data-testid="draw-finish"
                    disabled={need > 0}
                    title={need > 0 ? `Add ${need} more ${tool.id === 'polygon' ? (need === 1 ? 'corner' : 'corners') : need === 1 ? 'vertex' : 'vertices'} first` : undefined}
                    onClick={() => finishSketch()}
                  >
                    <Check size={14} aria-hidden /> Finish
                  </HudButton>
                )}
                <HudButton tone="muted" disabled={!sketch.length} onClick={cancelSketch} aria-label="Cancel the shape in progress">
                  <Undo2 size={14} aria-hidden /> Cancel
                </HudButton>
                <HudButton tone="muted" onClick={stopDrawing} aria-label="Stop drawing" title="Stop drawing (a finishable shape is kept)">
                  <X size={14} aria-hidden /> Done
                </HudButton>
              </div>
            </div>,
            toolGrid,
          ]
        : [
            toolGrid,
            <Prose key="hint">Pick a tool, then {coarse ? 'tap' : 'click'} the map. Distances and areas are geodesic (turf), in your unit setting.</Prose>,
          ]}
      <div className="flex flex-wrap gap-1.5">
        <HudButton tone="muted" onClick={() => fileRef.current?.click()}>
          <FileUp size={14} aria-hidden /> Import GeoJSON
        </HudButton>
        <input ref={fileRef} type="file" accept=".geojson,.json,application/geo+json,application/json" className="sr-only" aria-label="GeoJSON file" onChange={(e) => void onFile(e.target.files?.[0])} />
        <HudButton tone="muted" disabled={!features.length} onClick={() => downloadJson('godseye-drawing.geojson', toFeatureCollection(features), 'application/geo+json')}>
          <Download size={14} aria-hidden /> Export
        </HudButton>
        <HudButton tone="red" disabled={!features.length} onClick={clearFeatures}>
          <Trash2 size={14} aria-hidden /> Clear
        </HudButton>
      </div>
      {msg && (
        <p role="status" className="font-sans text-[12px] text-[var(--text-secondary)]">
          {msg}
        </p>
      )}
      {features.length > 0 && <SectionTitle>Shapes</SectionTitle>}
      <ul className="flex flex-col gap-1.5" aria-label="Drawn shapes" data-testid="draw-shapes">
        {features.map((f) => {
          const m = measure(f);
          const parts = [
            m.lengthM !== null && formatDistance(m.lengthM, units),
            m.radiusM !== null && `r ${formatDistance(m.radiusM, units)}`,
            m.areaM2 !== null && formatArea(m.areaM2, units),
            m.perimeterM !== null && `perimeter ${formatDistance(m.perimeterM, units)}`,
            f.geometry.type === 'Point' && `${(f.geometry.coordinates[1] as number).toFixed(5)}, ${(f.geometry.coordinates[0] as number).toFixed(5)}`,
          ].filter(Boolean);
          const isArea = f.geometry.type === 'Polygon';
          return (
            <li key={f.properties.id} className="rounded-md border border-[var(--border-secondary)] px-2 py-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex-1 text-left font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-primary)] hover:text-[var(--gold-light)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
                  onClick={() => {
                    const bb = featureBbox(f);
                    requestFlyTo({ lat: (bb[1] + bb[3]) / 2, lng: (bb[0] + bb[2]) / 2, zoom: zoomForBbox(bb), durationMs: 1200 });
                  }}
                >
                  {f.properties.name}
                  {f.properties.aoi && <span className="ml-2 text-[var(--gold-primary)]">AOI</span>}
                </button>
                {isArea && (
                  <HudButton tone={f.properties.aoi ? 'gold' : 'muted'} pressed={Boolean(f.properties.aoi)} onClick={() => toggleAoi(f.properties.id)} title="Mark as Area of Interest">
                    <Target size={13} aria-hidden /> AOI
                  </HudButton>
                )}
                <HudButton tone="muted" aria-label={`Delete ${f.properties.name}`} onClick={() => removeFeature(f.properties.id)}>
                  <Trash2 size={13} aria-hidden />
                </HudButton>
              </div>
              <p className="font-mono text-[11px] tabular-nums tracking-[0.08em] text-[var(--cyan-primary)]" data-testid="draw-measure">
                {parts.join(' · ')}
              </p>
              {f.properties.aoi && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <HudButton
                    tone="muted"
                    onClick={() => {
                      const [lng, lat] = featureCentre(f);
                      openDossier({ lat, lng });
                    }}
                  >
                    Dossier at AOI
                  </HudButton>
                  <HudButton tone="muted" onClick={() => downloadJson(`aoi-${f.properties.id}.geojson`, { ...toFeatureCollection([f]), bbox: featureBbox(f) }, 'application/geo+json')}>
                    <Download size={13} aria-hidden /> AOI + bbox
                  </HudButton>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
