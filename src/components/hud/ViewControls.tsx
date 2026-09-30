'use client';
/**
 * Bottom-left view strip: 3D | 2D and MAP | SAT segmented controls (shared layoutId highlight),
 * consent-based "centre on my region", scale bar, cursor readout with reverse geocoding
 * (/api/geo/reverse, 3 s debounce, 0.1° cache; coordinates only when the geocoder is unavailable)
 * and the hint line. Owner: design-system-hud.
 */
import { motion } from 'motion/react';
import { Globe, Layers2, LocateFixed, MapPinned, Satellite } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMapInstanceStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { locateOnce } from './Boot';
import { formatLatLng, geoCell, metersPerPixel, scaleBar } from './map-readout';

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

function useCursorAndScale() {
  const map = useMapInstanceStore((s) => s.map);
  const [cursor, setCursor] = useState<{ lat: number; lng: number } | null>(null);
  const [view, setView] = useState<{ lat: number; zoom: number } | null>(null);
  useEffect(() => {
    if (!map) return;
    let raf = 0;
    const onMove = (e: { lngLat: { lat: number; lng: number } }) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setCursor({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    };
    const onView = () => setView({ lat: map.getCenter().lat, zoom: map.getZoom() });
    const onOut = () => setCursor(null);
    map.on('mousemove', onMove);
    map.on('move', onView);
    map.on('mouseout', onOut);
    onView();
    return () => {
      cancelAnimationFrame(raf);
      map.off('mousemove', onMove);
      map.off('move', onView);
      map.off('mouseout', onOut);
    };
  }, [map]);
  return { cursor, view };
}

function usePlace(cursor: { lat: number; lng: number } | null): string | null {
  const [place, setPlace] = useState<{ cell: string; name: string | null } | null>(null);
  const cell = cursor ? geoCell(cursor.lat, cursor.lng) : null;
  useEffect(() => {
    if (!cell || placeCache.has(cell) || Date.now() < geocoderDownUntil) return;
    const ac = new AbortController();
    const t = setTimeout(async () => {
      const [lat, lng] = cell.split(',');
      try {
        const r = await fetch(`/api/geo/reverse?lat=${lat}&lng=${lng}`, { signal: ac.signal });
        if (!r.ok) {
          geocoderDownUntil = Date.now() + 5 * 60_000;
          return;
        }
        const body = (await r.json()) as { results?: { label?: string; name?: string }[] };
        const first = body.results?.[0];
        const name = first?.label ?? first?.name ?? null;
        placeCache.set(cell, name);
        setPlace({ cell, name });
      } catch {
        if (!ac.signal.aborted) geocoderDownUntil = Date.now() + 60_000;
      }
    }, 3000);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [cell]);
  if (!cell) return null;
  if (placeCache.has(cell)) return placeCache.get(cell) ?? null;
  return place?.cell === cell ? place.name : null;
}

export default function ViewControls() {
  const projection = useUiStore((s) => s.projection);
  const setProjection = useUiStore((s) => s.setProjection);
  const basemap = useUiStore((s) => s.basemap);
  const setBasemap = useUiStore((s) => s.setBasemap);
  const units = useUiStore((s) => s.settings.units);
  const updateSettings = useUiStore((s) => s.updateSettings);
  const { cursor, view } = useCursorAndScale();
  const place = usePlace(cursor);
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed'>('idle');
  const bar = view ? scaleBar(metersPerPixel(view.lat, view.zoom), 100, units) : null;
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
      <div className="glass-panel fixed bottom-[calc(96px+env(safe-area-inset-bottom))] left-3 z-[var(--z-hud)] flex items-center gap-1 p-1 md:bottom-[100px] md:left-[120px]">
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
      {locating === 'failed' && (
        <p role="status" className="hud-micro fixed bottom-[140px] left-[120px] z-[var(--z-hud)] text-[var(--alert-orange)]">
          LOCATION UNAVAILABLE
        </p>
      )}
      <div className="hud-micro pointer-events-none fixed bottom-8 left-72 z-[var(--z-hud)] hidden items-end gap-4 text-[var(--text-secondary)] md:flex">
        {bar && (
          <span className="flex flex-col items-start gap-0.5">
            <span>{bar.label}</span>
            <span aria-hidden className="block h-1.5 border-x border-b border-[var(--text-secondary)]" style={{ width: `${Math.round(bar.widthPx)}px` }} />
          </span>
        )}
        <span className="tabular-nums" aria-live="off">
          {cursor ? formatLatLng(cursor.lat, cursor.lng) : ''}
          {cursor && place ? <span className="ml-2 normal-case text-[var(--text-primary)]">{place}</span> : null}
        </span>
        <span className="hidden text-[var(--text-muted)] xl:inline">DRAG TO PAN · RIGHT-DRAG TO TILT · DOUBLE RIGHT-CLICK FOR DOSSIER · ⌘K COMMANDS · ? SHORTCUTS</span>
      </div>
    </>
  );
}
