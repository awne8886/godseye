'use client';
/**
 * DRAW: points, lines, polygons and geodesic circles with turf measurements in the visitor's
 * units; GeoJSON import/export; mark a polygon as the Area of Interest (AOI) and open the Region
 * Dossier at its centre or export its bounding box. Map clicks are captured only while a tool is
 * active (ReconOverlays). Owner: panels-recon.
 */
import { Circle, Download, FileUp, MapPin, Pentagon, Spline, Target, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { useUiStore } from '@/lib/store';
import { HudButton, Prose, SectionTitle, downloadJson } from '../recon/ui';
import { nextId, useOverlayStore, zoomForBbox } from '../recon/overlay-store';
import { featureBbox, featureCentre, formatArea, formatDistance, measure, parseGeoJson, toFeatureCollection, type DrawShape } from './geometry';

const TOOLS: { id: DrawShape; label: string; Icon: typeof MapPin; hint: string }[] = [
  { id: 'point', label: 'Point', Icon: MapPin, hint: 'Click the map to drop a point.' },
  { id: 'line', label: 'Line', Icon: Spline, hint: 'Click to add vertices; double-click or Enter to finish; Esc clears.' },
  { id: 'polygon', label: 'Polygon', Icon: Pentagon, hint: 'Click to add corners; double-click or Enter closes the shape; Esc clears.' },
  { id: 'circle', label: 'Circle', Icon: Circle, hint: 'Click the centre, then click again at the radius.' },
];

export default function DrawPanel(_: PanelProps) {
  const units = useUiStore((s) => s.settings.units);
  const requestFlyTo = useUiStore((s) => s.requestFlyTo);
  const openDossier = useUiStore((s) => s.openDossier);
  const { drawMode, setDrawMode, features, removeFeature, toggleAoi, clearFeatures, addFeatures, sketch } = useOverlayStore();
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  usePanelChip(drawMode ? 'PLOTTING' : features.length ? `${features.length} SHAPES` : 'STANDBY', drawMode ? 'busy' : features.length ? 'live' : 'idle');
  // Closing the panel ends the drawing session: map clicks go back to normal selection.
  useEffect(() => () => useOverlayStore.getState().setDrawMode(null), []);

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
  return (
    <div className="flex flex-col gap-3" data-testid="draw-panel">
      {/* Two columns: at 326 px a 4-up grid squeezed the icons to nothing next to "POLYGON" (visual-qa M7). */}
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Drawing tools">
        {TOOLS.map(({ id, label, Icon }) => (
          <HudButton key={id} tone={drawMode === id ? 'cyan' : 'muted'} pressed={drawMode === id} onClick={() => setDrawMode(drawMode === id ? null : id)}>
            <Icon size={14} aria-hidden className="shrink-0" data-testid={`draw-tool-icon-${id}`} /> {label}
          </HudButton>
        ))}
      </div>
      {tool ? (
        <div className="flex items-start gap-2">
          <Prose className="flex-1">{tool.hint}</Prose>
          <HudButton tone="muted" onClick={() => setDrawMode(null)} aria-label="Stop drawing">
            <X size={14} aria-hidden /> Done
          </HudButton>
        </div>
      ) : (
        <Prose>Pick a tool, then click the map. Distances and areas are geodesic (turf), in your unit setting.</Prose>
      )}
      {drawMode && sketch.length > 0 && <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cyan-primary)]">{sketch.length} vertices</p>}
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
