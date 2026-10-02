'use client';
/**
 * ROUTE: turn-by-turn directions. From/To/Via accept a place name (geocoded through
 * /api/geosearch on submit) or "lat,lng"; modes DRIVE/WALK/BIKE; avoid tolls/highways/ferries.
 * Shows the engine that answered (Valhalla or the OSRM fallback), alternatives, toll/highway/ferry
 * flags, ascent/descent with an elevation profile (walk/bike), and the step list. The route is drawn
 * on the map by ReconOverlays. Owner: panels-recon.
 */
import { ArrowDown, ArrowUp, Bike, Car, Crosshair, Footprints, Plus, Route as RouteIcon, X } from 'lucide-react';
import { useId, useState } from 'react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { getView } from '@/lib/map/cursor';
import { useUiStore } from '@/lib/store';
import type { DirectionsResponse, GeoResponse } from '@/lib/types';
import { ErrorLine, HudButton, HudInput, Label, ProviderChips, Prose, SectionTitle, apiGet } from '../recon/ui';
import { useOverlayStore, zoomForBbox } from '../recon/overlay-store';
import { formatDistance, featureBbox } from '../draw/geometry';
import { directionsQuery, formatDuration, parseLatLngText, type Mode } from './format';

const MODES: { id: Mode; label: string; Icon: typeof Car }[] = [
  { id: 'drive', label: 'Drive', Icon: Car },
  { id: 'walk', label: 'Walk', Icon: Footprints },
  { id: 'bike', label: 'Bike', Icon: Bike },
];

async function resolvePoint(text: string): Promise<{ lat: number; lng: number; label: string } | string> {
  const ll = parseLatLngText(text);
  if (ll) return { ...ll, label: text.trim() };
  if (!text.trim()) return 'empty';
  const r = await apiGet<GeoResponse>(`/api/geosearch?q=${encodeURIComponent(text.trim())}&submit=1`);
  const p = r.ok ? r.body.results[0] : undefined;
  return p ? { lat: p.lat, lng: p.lng, label: `${p.name}${p.label && p.label !== p.name ? `, ${p.label}` : ''}` } : r.ok ? `No place found for “${text.trim()}”` : `Geocoder unavailable (${r.body.error ?? r.status})`;
}

function Elevation({ points }: { points: NonNullable<DirectionsResponse['elevation']> }) {
  const W = 300;
  const H = 48;
  const maxD = points.at(-1)!.distanceM || 1;
  const hs = points.map((p) => p.elevationM);
  const lo = Math.min(...hs);
  const hi = Math.max(...hs, lo + 1);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((p.distanceM / maxD) * W).toFixed(1)},${(H - ((p.elevationM - lo) / (hi - lo)) * (H - 4) - 2).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Elevation profile from ${Math.round(lo)} m to ${Math.round(hi)} m`} className="w-full rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)]">
      <path d={d} fill="none" stroke="var(--map-directions)" strokeWidth={1.5} />
    </svg>
  );
}

export default function DirectionsPanel(_: PanelProps) {
  const units = useUiStore((s) => s.settings.units);
  const requestFlyTo = useUiStore((s) => s.requestFlyTo);
  const route = useOverlayStore((s) => s.route);
  const setRoute = useOverlayStore((s) => s.setRoute);
  const setActive = useOverlayStore((s) => s.setActiveRoute);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [via, setVia] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('drive');
  const [avoid, setAvoid] = useState({ tolls: false, highways: false, ferries: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ error?: string; detail?: string; providers?: DirectionsResponse['providers'] } | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const fromId = useId();
  const toId = useId();
  usePanelChip(busy ? 'PLOTTING' : route ? `${route.result.routes.length} ROUTE${route.result.routes.length > 1 ? 'S' : ''}` : err ? 'NO ROUTE' : 'STANDBY', busy ? 'busy' : route ? 'live' : err ? 'warn' : 'idle');

  const mapCentre = (set: (v: string) => void) => {
    const v = getView();
    if (v) set(`${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}`);
  };

  const plot = async () => {
    setBusy(true);
    setErr(null);
    try {
      const pts = await Promise.all([from, ...via.filter((v) => v.trim()), to].map(resolvePoint));
      const bad = pts.find((p) => typeof p === 'string');
      if (bad) {
        setErr({ error: 'invalid_request', detail: bad === 'empty' ? 'Enter a start and a destination.' : (bad as string) });
        return;
      }
      const ok = pts as { lat: number; lng: number; label: string }[];
      const r = await apiGet<DirectionsResponse>(`/api/directions?${directionsQuery(ok[0]!, ok.at(-1)!, ok.slice(1, -1), mode, avoid)}`);
      if (!r.ok) {
        setRoute(null);
        setErr(r.body);
        return;
      }
      setLabels(ok.map((p) => p.label));
      setRoute({ result: r.body, active: 0, stops: ok.map((p) => [p.lng, p.lat]) });
      const bb = featureBbox({ type: 'Feature', properties: {}, geometry: r.body.routes[0]!.geometry });
      requestFlyTo({ lat: (bb[1] + bb[3]) / 2, lng: (bb[0] + bb[2]) / 2, zoom: zoomForBbox(bb), durationMs: 2000 });
    } catch {
      setErr({ error: 'network_error', detail: 'Could not reach this server.' });
    } finally {
      setBusy(false);
    }
  };

  const active = route?.result.routes[route.active];
  return (
    <div className="flex flex-col gap-3" data-testid="route-panel">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void plot();
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor={fromId}>From</Label>
          <div className="flex gap-1.5">
            <HudInput id={fromId} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Place or lat,lng" maxLength={200} />
            <HudButton tone="muted" aria-label="Use map centre as start" title="Use map centre" onClick={() => mapCentre(setFrom)}>
              <Crosshair size={14} aria-hidden />
            </HudButton>
          </div>
        </div>
        {via.map((v, i) => (
          <div key={i} className="flex gap-1.5">
            <HudInput aria-label={`Via point ${i + 1}`} value={v} onChange={(e) => setVia(via.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Via ${i + 1}: place or lat,lng`} maxLength={200} />
            <HudButton tone="muted" aria-label={`Remove via point ${i + 1}`} onClick={() => setVia(via.filter((_, j) => j !== i))}>
              <X size={14} aria-hidden />
            </HudButton>
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <Label htmlFor={toId}>To</Label>
          <div className="flex gap-1.5">
            <HudInput id={toId} value={to} onChange={(e) => setTo(e.target.value)} placeholder="Place or lat,lng" maxLength={200} />
            <HudButton tone="muted" aria-label="Use map centre as destination" title="Use map centre" onClick={() => mapCentre(setTo)}>
              <Crosshair size={14} aria-hidden />
            </HudButton>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MODES.map(({ id, label, Icon }) => (
            <HudButton key={id} pressed={mode === id} tone={mode === id ? 'gold' : 'muted'} onClick={() => setMode(id)}>
              <Icon size={14} aria-hidden /> {label}
            </HudButton>
          ))}
          <HudButton tone="muted" onClick={() => setVia([...via, ''])} disabled={via.length >= 8}>
            <Plus size={14} aria-hidden /> Via
          </HudButton>
        </div>
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">Avoid</legend>
          {(['tolls', 'highways', 'ferries'] as const).map((k) => (
            <HudButton key={k} tone="muted" pressed={avoid[k]} onClick={() => setAvoid({ ...avoid, [k]: !avoid[k] })}>
              Avoid {k}
            </HudButton>
          ))}
        </fieldset>
        <div className="flex gap-1.5">
          <HudButton type="submit" disabled={busy} className="flex-1">
            <RouteIcon size={14} aria-hidden /> {busy ? 'Plotting…' : 'Get directions'}
          </HudButton>
          {route && (
            <HudButton tone="muted" onClick={() => setRoute(null)}>
              Clear
            </HudButton>
          )}
        </div>
      </form>
      {err && <ErrorLine error={err.error} detail={err.detail} />}
      {err?.providers && <ProviderChips providers={err.providers} />}
      {route && active && (
        <section aria-label="Route" className="flex flex-col gap-2" data-testid="route-result">
          <SectionTitle right={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{route.result.engine} · {route.result.mode}</span>}>
            {formatDistance(active.distanceM, units)} · {formatDuration(active.durationS)}
          </SectionTitle>
          <ProviderChips providers={route.result.providers} at={route.result.timestamp} />
          {route.result.routes.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Alternatives">
              {route.result.routes.map((r, i) => (
                <HudButton key={i} pressed={i === route.active} tone={i === route.active ? 'cyan' : 'muted'} onClick={() => setActive(i)}>
                  {i === 0 ? 'Best' : `Alt ${i}`} · {formatDuration(r.durationS)}
                </HudButton>
              ))}
            </div>
          )}
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            {[active.hasHighway && 'Highway', active.hasToll && 'Toll', active.hasFerry && 'Ferry'].filter(Boolean).join(' · ') || (route.result.engine === 'osrm' ? 'Toll/highway/ferry not reported by OSRM' : 'No toll, highway or ferry')}
          </p>
          {route.result.elevation && (
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.08em] tabular-nums text-[var(--text-primary)]">
                <span className="inline-flex items-center gap-1"><ArrowUp size={12} aria-hidden /> {route.result.ascentM} m</span>
                <span className="inline-flex items-center gap-1"><ArrowDown size={12} aria-hidden /> {route.result.descentM} m</span>
              </p>
              <Elevation points={route.result.elevation} />
            </div>
          )}
          <ol className="flex flex-col gap-0.5" aria-label="Turn-by-turn steps">
            {active.steps.map((s, i) => {
              const c = active.geometry.coordinates[s.startIndex] as [number, number] | undefined;
              return (
                <li key={i}>
                  <button
                    type="button"
                    disabled={!c}
                    onClick={() => c && requestFlyTo({ lat: c[1], lng: c[0], zoom: 16, durationMs: 1200 })}
                    className="flex min-h-9 w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
                  >
                    <span className="w-5 shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{i + 1}</span>
                    <span className="flex-1 font-sans text-[12px] text-[var(--text-primary)]">{s.instruction}</span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-secondary)]">{s.distanceM ? formatDistance(s.distanceM, units) : ''}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <Prose>{labels.join(' → ')}</Prose>
          <p className="font-sans text-[11px] text-[var(--text-muted)]">{route.result.attribution}</p>
        </section>
      )}
    </div>
  );
}
