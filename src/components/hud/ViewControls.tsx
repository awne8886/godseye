'use client';
/**
 * Bottom-left view strip: 3D | 2D and MAP | SAT segmented controls (shared layoutId highlight; the
 * map host swaps Esri imagery in place), consent-based "centre on my region", the terrain status
 * line while 3D terrain is on, and the readout: scale bar + cursor position fed by map-engine's
 * zero-render channels (subscribeView / subscribeCursor in src/lib/map/cursor.ts) and written
 * straight into DOM refs, with reverse geocoding (/api/geo/reverse, 3 s debounce, 0.1° cache;
 * coordinates only while the geocoder does not answer). Owner: design-system-hud.
 */
import { m } from 'motion/react';
import { Globe, Layers2, LocateFixed, MapPinned, Maximize, Minimize, Mountain, Navigation2, Satellite } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLayerStatus, useMapInstanceStore } from '@/lib/layer-host';
import { getCursor, getView, subscribeCursor, subscribeView, type MapPoint } from '@/lib/map/cursor';
import { TERRAIN_STATUS_TEXT, type TerrainStatus } from '@/lib/map/terrain';
import { useUiStore, type Settings } from '@/lib/store';
import { toggleFullscreen } from './actions';
import { locateOnce } from './Boot';
import { useApiRoute } from './hooks';
import { formatLatLng, geoCell, HINT_MIN_ROW_PX, readoutRightInset, scaleBarFor } from './map-readout';

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
            className={`hud-micro hud-control relative flex min-h-[32px] items-center justify-center gap-1.5 px-2.5 phone:min-h-[44px] phone:min-w-[44px] phone:px-2 ${on ? 'text-[var(--gold-light)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            {on && (
              <m.span
                layoutId={`seg-${group}`}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="hud-control absolute inset-0 border border-[var(--border-active)] bg-[rgba(var(--gold-rgb),0.1)]"
                aria-hidden
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <span className="inline-flex phone:hidden">{o.icon}</span>
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
      if (coords.current) {
        coords.current.textContent = c ? formatLatLng(c.lat, c.lng) : '';
        // The hint line gives way while a position is shown (R2-M5): no re-render, a data flag.
        coords.current.closest('[data-readout-row]')?.toggleAttribute('data-cursor', c !== null);
      }
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
      <span className="flex min-w-0 overflow-hidden whitespace-nowrap tabular-nums" data-testid="cursor-readout">
        <span ref={coords} className="shrink-0" />
        <span ref={place} className="ml-2 min-w-0 max-w-[360px] truncate normal-case text-[var(--text-primary)]" />
      </span>
    </>
  );
}

/**
 * Keeps the desktop readout/hint row clear of MapLibre's attribution box (R3-M1): measures the
 * attribution (ResizeObserver + window resize; re-found if the map remounts) and writes the row's
 * right inset straight to the element, hiding the hint (`data-narrow`) when too little room is left.
 */
export function useClearOfAttribution(row: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let attrib: Element | null = null;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => apply());
    function apply() {
      const el = row.current;
      if (!el) return;
      const box = attrib?.isConnected ? attrib.getBoundingClientRect() : null;
      const visible = box !== null && box.width > 0 && box.height > 0;
      const inset = readoutRightInset(window.innerWidth, visible ? box.left : null);
      el.style.right = `${inset}px`;
      const rowWidth = window.innerWidth - inset - el.getBoundingClientRect().left;
      el.toggleAttribute('data-narrow', rowWidth < HINT_MIN_ROW_PX);
    }
    function find() {
      if (attrib?.isConnected) return;
      ro?.disconnect();
      attrib = document.querySelector('.maplibregl-ctrl-attrib');
      if (attrib) ro?.observe(attrib);
      apply();
    }
    find();
    const poll = setInterval(find, 1000);
    window.addEventListener('resize', apply);
    return () => {
      clearInterval(poll);
      window.removeEventListener('resize', apply);
      ro?.disconnect();
    };
  }, [row]);
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
      data-map-inset="terrain-line"
      className="hud-micro fixed bottom-[140px] left-[120px] z-[var(--z-hud)] flex items-center gap-1.5 phone:bottom-auto phone:left-3 phone:top-[112px]"
      style={{ color: error ? 'var(--alert-orange)' : 'var(--text-secondary)' }}
    >
      <Mountain size={12} aria-hidden /> {terrainText(status.state)}
    </p>
  );
}

/** The compass shows only while the view is rotated or tilted (MapLibre's own threshold is similar). */
export function compassVisible(bearing: number, pitch: number): boolean {
  const b = (((bearing % 360) + 540) % 360) - 180;
  return Math.abs(b) > 0.5 || pitch > 0.5;
}

/**
 * Compass / reset-north: the needle turns with the map bearing (written straight to the DOM on
 * rotate/pitch, no React render per frame); a click eases back to north with no tilt. Hidden at
 * bearing 0 / pitch 0.
 */
export function CompassButton() {
  const map = useMapInstanceStore((s) => s.map);
  const needle = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!map) return;
    const sync = () => {
      const bearing = map.getBearing();
      const pitch = map.getPitch();
      if (needle.current) needle.current.style.transform = `rotate(${-bearing}deg)`;
      const v = compassVisible(bearing, pitch);
      setShown((s) => (s === v ? s : v));
    };
    sync();
    map.on('rotate', sync);
    map.on('pitch', sync);
    return () => {
      map.off('rotate', sync);
      map.off('pitch', sync);
    };
  }, [map]);
  if (!shown) return null;
  const reset = () => {
    const c = map?.getCenter();
    if (!map || !c) return;
    useUiStore.getState().requestFlyTo({ lat: c.lat, lng: c.lng, zoom: map.getZoom(), bearing: 0, pitch: 0, durationMs: 600 });
  };
  return (
    <button
      type="button"
      onClick={reset}
      aria-label="Reset north and tilt"
      title="Reset north and tilt"
      className="hud-control grid h-8 w-8 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)] phone:h-11 phone:w-11"
    >
      <span ref={needle} className="grid place-items-center" data-testid="compass-needle">
        <Navigation2 size={14} aria-hidden className="text-[var(--gold-primary)]" />
      </span>
    </button>
  );
}

/** Fullscreen toggle; hidden where the browser offers no Fullscreen API (e.g. iPhone Safari). */
export function FullscreenButton() {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => {
      setSupported(!!document.fullscreenEnabled);
      setOn(!!document.fullscreenElement);
    };
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={toggleFullscreen}
      aria-pressed={on}
      aria-label="Fullscreen"
      title={on ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
      className="hud-control grid h-8 w-8 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)] phone:h-11 phone:w-11"
    >
      {on ? <Minimize size={14} aria-hidden /> : <Maximize size={14} aria-hidden />}
    </button>
  );
}

export default function ViewControls() {
  // The highlight shows the projection the map actually applies (terrain forces mercator), falling
  // back to the requested one before the map is mounted.
  const requested = useUiStore((s) => s.projection);
  const applied = useMapInstanceStore((s) => (s.map ? s.projection : null));
  const projection = applied ?? requested;
  const setProjection = useUiStore((s) => s.setProjection);
  const basemap = useUiStore((s) => s.basemap);
  const setBasemap = useUiStore((s) => s.setBasemap);
  const units = useUiStore((s) => s.settings.units);
  const updateSettings = useUiStore((s) => s.updateSettings);
  const geocodeRoute = useApiRoute('/api/geo/reverse');
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed'>('idle');
  const failTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readoutRow = useRef<HTMLDivElement>(null);
  useClearOfAttribution(readoutRow);

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
      {/* data-map-inset: map framing (flight paths) keeps route endpoints out from under this bar. */}
      <div data-map-inset="view-controls" data-testid="view-controls" className="glass-panel fixed bottom-[100px] left-[120px] z-[var(--z-hud)] flex items-center gap-1 p-1 phone:bottom-auto phone:left-3 phone:top-[64px]">
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
          className="hud-control grid h-8 w-8 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)] phone:h-11 phone:w-11"
          style={locating === 'failed' ? { color: 'var(--alert-orange)' } : undefined}
        >
          <LocateFixed size={14} aria-hidden className={locating === 'busy' ? 'hud-pulse' : ''} />
        </button>
        <CompassButton />
        <FullscreenButton />
      </div>
      <TerrainLine />
      {/* data-map-inset on both status lines: route framing keeps endpoints out from under them (round 5 m1). */}
      {locating === 'failed' && (
        <p
          role="status"
          data-map-inset="locate-status"
          className="hud-micro fixed bottom-[160px] left-[120px] z-[var(--z-hud)] text-[var(--alert-orange)] phone:bottom-auto phone:left-3 phone:top-[112px]"
        >
          LOCATION UNAVAILABLE
        </p>
      )}
      {/* Ends at least 44rem short of the right edge, and always before the measured attribution box
          (R3-M1), so it never runs under the credits / imagery chips. One row: scale bar, readout
          (clipped at the row edge, never overprinting) and the hint, which is hidden while a cursor
          position is shown (R2-M5) or when the row is too narrow for it. */}
      <div
        ref={readoutRow}
        data-readout-row
        data-testid="readout-row"
        className="group hud-micro pointer-events-none fixed bottom-8 left-72 right-[44rem] z-[var(--z-hud)] hidden min-w-0 items-end gap-6 overflow-hidden text-[var(--text-secondary)] xl:flex phone:hidden"
      >
        <Readout units={units} geocode={geocodeRoute} />
        <span data-testid="view-hint" className="hidden min-w-0 truncate text-[var(--text-muted)] group-data-[cursor]:!hidden group-data-[narrow]:!hidden 2xl:inline">DRAG TO PAN · RIGHT-DRAG TO TILT · DOUBLE RIGHT-CLICK FOR DOSSIER · ⌘K COMMANDS · ? SHORTCUTS</span>
      </div>
    </>
  );
}
