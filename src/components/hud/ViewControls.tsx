'use client';
/**
 * Bottom-left view strip: 3D | 2D and MAP | SAT segmented controls (shared layoutId highlight; the
 * map host swaps Esri imagery in place), consent-based "centre on my region", the terrain status
 * line while 3D terrain is on, and the readout: scale bar + cursor position fed by map-engine's
 * zero-render channels (subscribeView / subscribeCursor in src/lib/map/cursor.ts) and written
 * straight into DOM refs, with reverse geocoding (/api/geo/reverse, 3 s debounce, 0.1° cache;
 * coordinates only while the geocoder does not answer). Owner: design-system-hud.
 */
import { motion } from 'motion/react';
import { Globe, Layers2, LocateFixed, MapPinned, Mountain, Satellite } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLayerStatus } from '@/lib/layer-host';
import { getCursor, getView, subscribeCursor, subscribeView, type MapPoint } from '@/lib/map/cursor';
import { TERRAIN_STATUS_TEXT, type TerrainStatus } from '@/lib/map/terrain';
import { useUiStore, type Settings } from '@/lib/store';
import { locateOnce } from './Boot';
import { useApiRoute } from './hooks';
import { formatLatLng, geoCell, scaleBarFor } from './map-readout';

function Segmented<T extends string>({ label, value, options, onChange, group }: { label: string; value: T; group: string; options: { value: T; text: string; title: string; icon: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`hud-micro hud-control relative flex min-h-[32px] items-center gap-1.5 px-2.5 ${on ? 'text-[var(--gold-light)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            {on && (
              <motion.span
                layoutId={`seg-${group}`}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="hud-control absolute inset-0 border border-[var(--border-active)] bg-[rgba(var(--gold-rgb),0.1)]"
                aria-hidden
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {o.icon}
              {o.text}
            </span>
          </button>
        );
      })}
    </div>
  );
}


const placeCache = new Map<string, string | null>();
let geocoderDownUntil = 0;

/** Reverse geocode one 0.1° cell (cached; a failure pauses lookups so a missing route is not hammered). */
export async function reverseGeocode(cell: string, signal?: AbortSignal): Promise<string | null> {
  if (placeCache.has(cell)) return placeCache.get(cell) ?? null;
  if (Date.now() < geocoderDownUntil) return null;
  const [lat, lng] = cell.split(',');
  try {
    const r = await fetch(`/api/geo/reverse?lat=${lat}&lng=${lng}`, { signal });
    if (!r.ok) {
      geocoderDownUntil = Date.now() + 5 * 60_000;
      return null;
    }
    const body = (await r.json()) as { results?: { label?: string; name?: string }[] };
    const first = body.results?.[0];
    const name = first?.label ?? first?.name ?? null;
    placeCache.set(cell, name);
    return name;
  } catch {
    if (!signal?.aborted) geocoderDownUntil = Date.now() + 60_000;
    return null;
  }
}

export const GEOCODE_DEBOUNCE_MS = 3000;

/** Scale bar + cursor readout. Subscribes once per unit setting; never re-renders on pointer moves. */
export function Readout({ units, geocode = true }: { units: Settings['units']; geocode?: boolean }) {
  const scaleLabel = useRef<HTMLSpanElement>(null);
  const scaleLine = useRef<HTMLSpanElement>(null);
  const coords = useRef<HTMLSpanElement>(null);
  const place = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const writeScale = (v: MapPoint | null) => {
      const bar = v ? scaleBarFor(v.lat, v.zoom, 100, units) : null;
      if (scaleLabel.current) scaleLabel.current.textContent = bar?.label ?? '';
      if (scaleLine.current) {
        scaleLine.current.style.width = bar ? `${Math.round(bar.widthPx)}px` : '0px';
        scaleLine.current.style.visibility = bar ? 'visible' : 'hidden';
      }
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ac: AbortController | null = null;
    let cell: string | null = null;
    const writePlace = (text: string | null) => {
      if (place.current) place.current.textContent = text ?? '';
    };
    const writeCursor = (c: MapPoint | null) => {
      if (coords.current) coords.current.textContent = c ? formatLatLng(c.lat, c.lng) : '';
      const next = c ? geoCell(c.lat, c.lng) : null;
      if (next === cell) return;
      cell = next;
      if (timer) clearTimeout(timer);
      ac?.abort();
      if (!next || !geocode) return writePlace(null);
      if (placeCache.has(next)) return writePlace(placeCache.get(next) ?? null);
      writePlace(null);
      timer = setTimeout(() => {
        ac = new AbortController();
        void reverseGeocode(next, ac.signal).then((name) => {
          if (cell === next) writePlace(name);
        });
      }, GEOCODE_DEBOUNCE_MS);
    };
    writeScale(getView());
    writeCursor(getCursor());
    const offView = subscribeView(writeScale);
    const offCursor = subscribeCursor(writeCursor);
    return () => {
      offView();
      offCursor();
      if (timer) clearTimeout(timer);
      ac?.abort();
    };
  }, [units, geocode]);

  return (
    <>
      <span className="flex flex-col items-start gap-0.5" data-testid="scale-bar">
        <span ref={scaleLabel} />
        <span ref={scaleLine} aria-hidden className="block h-1.5 border-x border-b border-[var(--text-secondary)]" style={{ width: 0, visibility: 'hidden' }} />
      </span>
      <span className="tabular-nums" data-testid="cursor-readout">
        <span ref={coords} />
        <span ref={place} className="ml-2 normal-case text-[var(--text-primary)]" />
      </span>
    </>
  );
}

/** Terrain status from the layer status the map host reports for `terrain_elevation`. */
export function terrainText(state: string): string {
  const s: TerrainStatus = state === 'loading' ? 'loading' : state === 'reference' || state === 'live' ? 'ready' : state === 'offline' ? 'error' : 'idle';
  return TERRAIN_STATUS_TEXT[s];
}

function TerrainLine() {
  const on = useUiStore((s) => s.activeLayers.has('terrain_elevation'));
  const status = useLayerStatus('terrain_elevation');
  if (!on) return null;
  const error = status.state === 'offline';
  return (
    <p
      role="status"
      className="hud-micro fixed left-3 top-[112px] z-[var(--z-hud)] flex items-center gap-1.5 md:bottom-[140px] md:left-[120px] md:top-auto"
      style={{ color: error ? 'var(--alert-orange)' : 'var(--text-secondary)' }}
    >
      <Mountain size={12} aria-hidden /> {terrainText(status.state)}
    </p>
  );
}

export default function ViewControls() {
  const projection = useUiStore((s) => s.projection);
  const setProjection = useUiStore((s) => s.setProjection);
  const basemap = useUiStore((s) => s.basemap);
  const setBasemap = useUiStore((s) => s.setBasemap);
  const units = useUiStore((s) => s.settings.units);
  const updateSettings = useUiStore((s) => s.updateSettings);
  const geocodeRoute = useApiRoute('/api/geo/reverse');
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed'>('idle');
  const failTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const locate = async () => {
    // The click itself is the consent; it is remembered in Settings (and can be revoked there).
    updateSettings({ geoConsent: 'granted' });
    setLocating('busy');
    const ok = await locateOnce(6);
    setLocating(ok ? 'idle' : 'failed');
    if (!ok) {
      if (failTimer.current) clearTimeout(failTimer.current);
      failTimer.current = setTimeout(() => setLocating('idle'), 5000);
    }
  };

  return (
    <>
      <div className="glass-panel fixed left-3 top-[64px] z-[var(--z-hud)] flex items-center gap-1 p-1 md:bottom-[100px] md:left-[120px] md:top-auto">
        <Segmented
          label="Projection"
          group="proj"
          value={projection}
          onChange={(p) => setProjection(p)}
          options={[
            { value: 'globe', text: '3D', title: '3D Globe', icon: <Globe size={13} aria-hidden /> },
            { value: 'mercator', text: '2D', title: '2D Map', icon: <MapPinned size={13} aria-hidden /> },
          ]}
        />
        <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--border-primary)]" />
        <Segmented
          label="Basemap"
          group="basemap"
          value={basemap}
          onChange={(b) => setBasemap(b)}
          options={[
            { value: 'dark', text: 'MAP', title: 'Night map', icon: <Layers2 size={13} aria-hidden /> },
            { value: 'satellite', text: 'SAT', title: 'Satellite imagery (Esri World Imagery)', icon: <Satellite size={13} aria-hidden /> },
          ]}
        />
        <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--border-primary)]" />
        <button
          type="button"
          onClick={() => void locate()}
          aria-label="Centre on my region"
          title="Centre on my region (asks your browser for your location; nothing is sent to the server)"
          className="hud-control grid h-8 w-8 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)]"
          style={locating === 'failed' ? { color: 'var(--alert-orange)' } : undefined}
        >
          <LocateFixed size={14} aria-hidden className={locating === 'busy' ? 'hud-pulse' : ''} />
        </button>
      </div>
      <TerrainLine />
      {locating === 'failed' && (
        <p role="status" className="hud-micro fixed left-3 top-[112px] z-[var(--z-hud)] text-[var(--alert-orange)] md:bottom-[160px] md:left-[120px] md:top-auto">
          LOCATION UNAVAILABLE
        </p>
      )}
      <div className="hud-micro pointer-events-none fixed bottom-8 left-72 z-[var(--z-hud)] hidden items-end gap-4 text-[var(--text-secondary)] md:flex">
        <Readout units={units} geocode={geocodeRoute} />
        <span className="hidden text-[var(--text-muted)] xl:inline">DRAG TO PAN · RIGHT-DRAG TO TILT · DOUBLE RIGHT-CLICK FOR DOSSIER · ⌘K COMMANDS · ? SHORTCUTS</span>
      </div>
    </>
  );
}
