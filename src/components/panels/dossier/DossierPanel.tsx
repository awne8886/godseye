'use client';
/**
 * REGION DOSSIER for `dossierTarget` (double right-click / long-press / `?dossier=lat,lng`): place,
 * country facts (Wikidata), Wikipedia summary, weather at the point, and live layers within 150 km
 * with each layer's own state — an offline layer reads OFFLINE, never 0; a cold one LOADING, a
 * keyed/licensed one NO KEY / LICENCE OFF, a reference layer (ports, cables) REF.
 * Owner: panels-alerts-markets-dossier-graph.
 */
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { formatAge } from '@/lib/freshness';
import { useUiStore } from '@/lib/store';
import type { RegionDossierResponse } from '@/lib/types';
import { AiReadout } from '../intel/AiReadout';
import { layerValue } from './layer-value';
import { FeedOfflineError, getJson, safeHref, useNow } from '../intel/client';

const LAYER_LABEL: Record<string, string> = {
  flights: 'Aircraft',
  earthquakes: 'Earthquakes',
  fires: 'Fires',
  weather: 'Severe weather',
  alerts: 'Live alerts',
  vessels: 'Vessels (AIS)',
  ports: 'Ports · straits',
  maritime: 'Vessels',
  cameras: 'Cameras',
  cables: 'Subsea cables',
  incidents: 'GDACS incidents',
};

/** Content-shaped placeholder while the dossier compiles (location, facts grid, brief, layers). */
function DossierSkeleton() {
  const bar = 'rounded-sm bg-[var(--border-primary)] motion-safe:animate-pulse';
  return (
    <div className="flex flex-col gap-3" aria-hidden data-testid="dossier-skeleton">
      <div className="flex flex-col gap-1.5">
        <div className={`${bar} h-2.5 w-20`} />
        <div className={`${bar} h-3.5 w-3/4`} />
      </div>
      <div className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="contents">
            <div className={`${bar} h-2.5`} />
            <div className={`${bar} h-2.5`} style={{ width: `${40 + ((i * 17) % 45)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className={`${bar} h-2.5 w-28`} />
        {[100, 96, 92, 60].map((w) => (
          <div key={w} className={`${bar} h-3`} style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className={`${bar} h-2.5`} />
        ))}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{k}</dt>
      <dd className="font-mono text-[11px] tabular-nums tracking-[0.08em] text-[var(--text-primary)]">{v}</dd>
    </>
  );
}

export function DossierPanel(_: PanelProps) {
  const target = useUiStore((s) => s.dossierTarget);
  const now = useNow(30_000);
  const q = useQuery({
    queryKey: ['intel', 'dossier', target?.lat, target?.lng],
    queryFn: ({ signal }) => getJson<RegionDossierResponse>(`/api/region-dossier?lat=${target!.lat.toFixed(4)}&lng=${target!.lng.toFixed(4)}`, signal),
    enabled: !!target,
    staleTime: 60_000,
  });
  usePanelChip(!target ? 'STANDBY' : q.data ? 'COMPILED' : q.isPending ? 'COMPILING' : 'SOURCE OFFLINE', !target ? 'idle' : q.data ? 'live' : q.isPending ? 'busy' : 'error');

  if (!target) return <p className="font-sans text-[12px] text-[var(--text-secondary)]">Double right-click (or long-press) the map to compile a dossier for that point.</p>;
  const d = q.data;
  return (
    <div className="flex flex-col gap-3" data-testid="dossier-panel">
      <p className="font-mono text-[11px] uppercase tabular-nums tracking-[0.08em] text-[var(--text-secondary)]">
        {target.lat.toFixed(4)}, {target.lng.toFixed(4)}
      </p>
      {!d && q.isPending && <DossierSkeleton />}
      {!d && !q.isPending && <p className="font-sans text-[12px] text-[var(--text-secondary)]">{q.error instanceof FeedOfflineError ? 'SOURCE OFFLINE — no dossier upstream answered and no live layer has data.' : 'SOURCE OFFLINE.'}</p>}
      {d && (
        <>
          <section className="flex flex-col gap-1">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">Location</h3>
            <p className="font-sans text-[13px] text-[var(--text-primary)]">{d.location?.displayName ?? 'Not resolved (geocoder unavailable or open water).'}</p>
            {d.location && <p className="font-sans text-[12px] text-[var(--text-muted)]">{d.location.attribution}</p>}
          </section>
          {d.country && (
            <section className="flex flex-col gap-1">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">Country · Wikidata</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <Row k="Country" v={`${d.country.name}${d.country.iso2 ? ` (${d.country.iso2})` : ''}`} />
                <Row k="Capital" v={d.country.capital ?? '—'} />
                <Row k="Population" v={d.country.population?.toLocaleString('en-US') ?? '—'} />
                <Row k="Area" v={d.country.areaKm2 ? `${Math.round(d.country.areaKm2).toLocaleString('en-US')} km²` : '—'} />
                <Row k="Region" v={d.country.region ?? '—'} />
                <Row k="Languages" v={d.country.languages.join(', ') || '—'} />
                <Row k="Head of state" v={d.country.headOfState?.name ?? '—'} />
              </dl>
            </section>
          )}
          {d.brief && (
            <section className="flex flex-col gap-1">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">Brief · Wikipedia</h3>
              <p className="font-sans text-[13px] leading-snug text-[var(--text-primary)]">{d.brief.extract}</p>
              {safeHref(d.brief.url) && (
                <a href={safeHref(d.brief.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cyan-primary)] hover:underline">
                  {d.brief.title} (CC BY-SA) <ExternalLink aria-hidden className="h-3 w-3" />
                </a>
              )}
            </section>
          )}
          <section className="flex flex-col gap-1">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">Weather at point</h3>
            {d.weather ? (
              <p className="font-mono text-[11px] tabular-nums tracking-[0.08em] text-[var(--text-primary)]">
                {d.weather.temperatureC === null ? '—' : `${d.weather.temperatureC.toFixed(1)} °C`} · wind {d.weather.windKmh === null ? '—' : `${Math.round(d.weather.windKmh)} km/h`}
                {d.weather.observedAt ? ` · ${formatAge(now - Date.parse(d.weather.observedAt))} ago (Open-Meteo)` : ''}
              </p>
            ) : (
              <p className="font-sans text-[12px] text-[var(--text-secondary)]">{d.providers['open-meteo']?.skipped ? 'Open-Meteo disabled on this deployment (non-commercial free tier).' : 'Weather unavailable (Open-Meteo did not answer).'}</p>
            )}
          </section>
          <section className="flex flex-col gap-1">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">Live layers within {d.nearby.radiusKm} km</h3>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1" aria-live="polite" data-testid="dossier-layers">
              {Object.entries(d.nearby.counts).map(([layer, c]) => {
                const v = layerValue(c);
                return (
                  <li key={layer} className="flex min-w-0 items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.16em]" title={c.note}>
                    <span className="min-w-0 truncate text-[var(--text-secondary)]">{LAYER_LABEL[layer] ?? layer}</span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums" style={{ color: `var(${v.token})` }}>
                      {v.text}
                    </span>
                  </li>
                );
              })}
            </ul>
            {Object.values(d.nearby.counts).some((c) => c.note) && (
              <ul className="flex flex-col gap-0.5 font-sans text-[12px] text-[var(--text-muted)]">
                {Object.entries(d.nearby.counts)
                  .filter(([, c]) => c.note)
                  .map(([layer, c]) => (
                    <li key={layer}>
                      {LAYER_LABEL[layer] ?? layer}: {c.note}
                    </li>
                  ))}
              </ul>
            )}
            {d.nearby.highlights.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 font-sans text-[12px] text-[var(--text-secondary)]">
                {d.nearby.highlights.map((h) => (
                  <li key={`${h.layer}:${h.id}`}>
                    {LAYER_LABEL[h.layer] ?? h.layer}: {h.title} · {h.distanceKm} km{h.observedAt ? ` · ${formatAge(now - Date.parse(h.observedAt))} ago` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <AiReadout path="/api/ai/analyze" body={{ lat: target.lat, lng: target.lng }} label="Analyse area" />
        </>
      )}
    </div>
  );
}
