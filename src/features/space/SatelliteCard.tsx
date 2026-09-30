'use client';
/**
 * Satellite readout (card body and the fixed SATELLITE panel). A fixed readout, not a ground popup:
 * a marker at 36 000 km has no honest ground anchor. Every number is PROPAGATED from the element
 * set named on the card; nothing here was observed. Owner: layers-space.
 */
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Orbit, Satellite, X } from 'lucide-react';
import type { CardProps, PanelProps } from '@/lib/feature-module';
import { useSelectionStore } from '@/lib/layer-host';
import { formatAge } from '@/lib/freshness';
import { CATEGORY_LABEL, CATEGORY_TOKEN } from './lib/catalog';
import { orbitClass, periodMinutes } from './lib/orbit-math';
import { fetchOrbit, orbitQueryKey, useNow, useSpaceStore, type SatelliteSelectionData } from './client/data';

const ORBIT_NOTE: Record<string, string> = {
  LEO: 'Low Earth orbit',
  MEO: 'Medium Earth orbit',
  GEO: 'Geostationary belt',
  HEO: 'High / highly elliptical',
};

function fmtPeriod(min: number): string {
  if (min < 100) return `${min.toFixed(1)} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${String(Math.round(min - h * 60)).padStart(2, '0')}m`;
}

function fmtUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function Field({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</dt>
      <dd className="truncate font-mono text-[11px] tabular-nums tracking-[0.08em] text-[var(--text-primary)]" style={accent ? { color: accent } : undefined} title={value}>
        {value}
      </dd>
    </div>
  );
}

/** Shared body: used by `cards.satellite` and `panels.satellite`. */
export function SatelliteDetails({ data, onClose }: { data: SatelliteSelectionData; onClose?: () => void }) {
  const telemetry = useSpaceStore((s) => (s.telemetry?.noradId === data.noradId ? s.telemetry : null));
  const orbit = useQuery({
    queryKey: orbitQueryKey(data.noradId, data.anchorAt),
    queryFn: () => fetchOrbit(data.noradId, data.anchorAt),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const accent = `var(${CATEGORY_TOKEN[data.category]})`;
  const cls = orbitClass(data.meanMotion, data.eccentricity);
  const period = periodMinutes(data.meanMotion);
  const now = useNow(10_000);
  const epochAge = formatAge(now - Date.parse(data.epoch));
  const fallback = data.catalogueSource === 'satnogs-fallback';

  return (
    <section aria-label={`Satellite ${data.name}`} className="flex flex-col gap-2" data-testid="satellite-card">
      <header className="flex items-start gap-2">
        <Satellite aria-hidden className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-[13px] uppercase tracking-[0.08em] text-[var(--text-heading)]" title={data.name}>
            {data.name}
          </h2>
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            {data.mission} · {CATEGORY_LABEL[data.category]}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close satellite details"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        )}
      </header>

      <p className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
          style={{ borderColor: 'var(--cyan-dim)', color: 'var(--cyan-primary)' }}
          title="Positions are computed with SGP4 from published orbital elements, not observed"
        >
          Propagated
        </span>
        {fallback && (
          <span className="rounded-sm border border-[var(--alert-orange)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--alert-orange)]">
            SatNOGS fallback
          </span>
        )}
        <span className="font-sans text-[12px] text-[var(--text-secondary)]">
          Propagated from elements of {fmtUtc(data.epoch)} ({epochAge} old)
        </span>
      </p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Field label="Altitude" value={telemetry ? `${Math.round(telemetry.altKm).toLocaleString('en-US')} km` : '—'} accent="var(--cyan-primary)" />
        <Field label="Orbit" value={`${cls} · ${ORBIT_NOTE[cls]}`} accent={accent} />
        <Field label="Period" value={period ? fmtPeriod(period) : '—'} />
        <Field label="Speed" value={telemetry ? `${telemetry.velocityKmS.toFixed(2)} km/s` : '—'} />
        <Field label="Latitude" value={telemetry ? `${telemetry.lat.toFixed(3)}°` : '—'} />
        <Field label="Longitude" value={telemetry ? `${telemetry.lng.toFixed(3)}°` : '—'} />
        <Field label="NORAD ID" value={String(data.noradId)} />
        <Field label="Intl designator" value={data.objectId || '—'} />
        <Field label="Inclination" value={`${data.inclination.toFixed(2)}°`} />
        <Field label="Illumination" value={telemetry ? (telemetry.shadow ? 'In Earth shadow' : 'Sunlit') : '—'} />
      </dl>

      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" aria-live="polite">
        <Orbit aria-hidden className="h-3 w-3" />
        {orbit.isPending && 'Plotting orbit…'}
        {orbit.data && <span style={{ color: accent }}>Orbit ±½ period on globe · {orbit.data.orbitClass}</span>}
        {orbit.isError && 'No track — elements unavailable'}
      </p>

      <footer className="flex items-center justify-between gap-2 border-t border-[var(--border-secondary)] pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
        <span>Source: {fallback ? 'SatNOGS DB (fallback)' : 'CelesTrak GP'}</span>
        <a
          href={`https://celestrak.org/satcat/records.php?CATNR=${encodeURIComponent(String(data.noradId))}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-6 items-center gap-1 text-[var(--cyan-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
        >
          SATCAT <ExternalLink aria-hidden className="h-3 w-3" />
        </a>
      </footer>
    </section>
  );
}

/** `cards.satellite`: the HUD supplies the card frame. */
export function SatelliteCard({ selection }: CardProps) {
  if (selection.kind !== 'satellite') return null;
  return <SatelliteDetails data={selection.data as SatelliteSelectionData} />;
}

/** `panels.satellite`: the fixed satellite readout for the current selection. */
export function SatellitePanel({ onClose }: PanelProps) {
  const selection = useSelectionStore((s) => s.selection);
  const clear = useSelectionStore((s) => s.clear);
  if (selection?.kind !== 'satellite') {
    return (
      <section aria-label="Satellite" className="glass-panel flex flex-col gap-2 p-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">Standby — select a satellite on the globe.</p>
      </section>
    );
  }
  return (
    <div className="glass-panel p-3">
      <SatelliteDetails
        data={selection.data as SatelliteSelectionData}
        onClose={() => {
          clear();
          onClose();
        }}
      />
    </div>
  );
}
