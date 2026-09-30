'use client';
/**
 * Entity card bodies for the hazards layers (the HUD supplies the outer frame). Every card shows
 * its source, the upstream observation time with its age, and a freshness badge: hazards are event
 * layers (OBSERVATION_CADENCE_MS = null), so the badge inherits the feed state and the event's age
 * is shown as text. Upstream strings render as React text only. Owner: layers-hazards.
 */
import Image from 'next/image';
import { useEffect, useState, type ReactNode } from 'react';
import type { CardProps } from '@/lib/feature-module';
import { FRESHNESS_COLOR_TOKEN, entityFreshness, formatAge, freshnessLabel } from '@/lib/freshness';
import { OBSERVATION_CADENCE_MS, getLayer, type LayerId } from '@/lib/layer-registry';
import { useLayerStatus } from '@/lib/layer-host';
import type { AirQuality, Earthquake, FreshnessState, GpsJamCell, SentinelScene, WeatherEvent } from '@/lib/types';
import { aqiCategory, jamLevel } from '../shared';

const SOURCES: Record<string, { label: string; url: string }> = {
  usgs: { label: 'USGS Earthquake Hazards Program', url: 'https://earthquake.usgs.gov/' },
  firms: { label: 'NASA FIRMS (LANCE NRT)', url: 'https://firms.modaps.eosdis.nasa.gov/' },
  eonet: { label: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/' },
  nws: { label: 'NOAA / National Weather Service', url: 'https://www.weather.gov/' },
  gdacs: { label: 'GDACS', url: 'https://www.gdacs.org/' },
  nhc: { label: 'NOAA National Hurricane Center', url: 'https://www.nhc.noaa.gov/' },
  gvp: { label: 'Smithsonian Global Volcanism Program', url: 'https://volcano.si.edu/' },
  'open-meteo': { label: 'Open-Meteo (CAMS model)', url: 'https://open-meteo.com/' },
  gpsjam: { label: 'gpsjam.org (licence unstated)', url: 'https://gpsjam.org/' },
  live_nacp: { label: 'Live ADS-B NACp binning', url: 'https://gpsjam.org/faq' },
  cdse_stac: { label: 'Copernicus Data Space Ecosystem', url: 'https://dataspace.copernicus.eu/' },
};

const safeHttp = (u: unknown): string | null => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <dt className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-muted)]">{label}</dt>
      <dd className="text-right font-mono text-[11px] uppercase tracking-[.08em] tabular-nums text-[var(--text-primary)]">{children}</dd>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] uppercase tracking-[.08em] text-[var(--gold-primary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--gold-primary)]">
      {children}
    </a>
  );
}

/** Source · observed-at · freshness block shared by every hazards card. */
export function Provenance({ layer, source, observedAt, note }: { layer: LayerId; source: string; observedAt: string | null; note?: string }) {
  const status = useLayerStatus(layer);
  const now = useNow();
  const def = getLayer(layer);
  const at = observedAt ? Date.parse(observedAt) : null;
  const feedState: FreshnessState = status.state === 'idle' || status.state === 'loading' ? 'stale' : status.state;
  const state = entityFreshness({ kind: def?.kind ?? 'live', at, observationCadenceMs: OBSERVATION_CADENCE_MS[layer], feedState, now });
  const src = SOURCES[source] ?? { label: source, url: null };
  return (
    <div className="mb-2 border-b border-white/10 pb-2" data-testid="hazard-provenance">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-secondary)]" data-testid="card-source">
          SOURCE · {src.url ? <ExternalLink href={src.url}>{src.label}</ExternalLink> : src.label}
        </span>
        <span
          className="rounded border px-1.5 font-mono text-[10px] uppercase tracking-[.16em]"
          style={{ color: `var(${FRESHNESS_COLOR_TOKEN[state]})`, borderColor: `var(${FRESHNESS_COLOR_TOKEN[state]})` }}
          data-testid="card-freshness"
        >
          {state === 'offline' ? 'SOURCE OFFLINE' : freshnessLabel(state, status.fetchedAt ? Date.parse(status.fetchedAt) : at, now)}
        </span>
      </div>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-[.08em] tabular-nums text-[var(--text-primary)]" data-testid="card-observed">
        OBSERVED {observedAt ? `${observedAt.slice(0, 16).replace('T', ' ')} UTC · ${formatAge(Math.max(0, now - (at ?? now)))} AGO` : 'TIME UNKNOWN'}
      </div>
      {state === 'offline' && status.lastGoodAt && (
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[.16em] text-[var(--alert-red)]">LAST GOOD {status.lastGoodAt.slice(0, 16).replace('T', ' ')} UTC</div>
      )}
      {note && <p className="mt-1 font-sans text-[12px] text-[var(--text-secondary)]">{note}</p>}
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div data-testid="hazard-card" className="text-[var(--text-primary)]">
      {children}
    </div>
  );
}

export function EarthquakeCard({ selection }: CardProps) {
  const q = selection.data as unknown as Earthquake;
  return (
    <Body>
      <Provenance layer="earthquakes" source={q.source} observedAt={q.observedAt} />
      <h3 className="mb-1 font-mono text-[13px] uppercase tracking-[.08em] text-[var(--text-heading)]">
        M{q.magnitude.toFixed(1)} {q.magType ? `(${q.magType})` : ''} · {q.place ?? 'Earthquake'}
      </h3>
      <dl>
        <Row label="Depth">{q.depthKm !== null ? `${q.depthKm.toFixed(1)} km` : '—'}</Row>
        <Row label="Position">{`${q.lat.toFixed(3)}, ${q.lng.toFixed(3)}`}</Row>
        <Row label="PAGER alert">{q.alert ? q.alert.toUpperCase() : 'NONE'}</Row>
        <Row label="Tsunami flag">{q.tsunami ? 'YES' : 'NO'}</Row>
        <Row label="Felt reports">{q.felt ?? '—'}</Row>
        <Row label="Significance">{q.significance ?? '—'}</Row>
      </dl>
      <div className="mt-2">
        <ExternalLink href={safeHttp(q.url)}>USGS event page</ExternalLink>
      </div>
    </Body>
  );
}

interface FireCardData {
  frpMw: number | null;
  brightnessK: number | null;
  confidence: string;
  dayNight: 'D' | 'N' | null;
  satellite: string;
  lat: number;
  lng: number;
  source: string;
  observedAt: string;
}

export function FireCard({ selection }: CardProps) {
  const f = selection.data as unknown as FireCardData;
  return (
    <Body>
      <Provenance layer="fires" source={f.source} observedAt={f.observedAt} note="Satellite overpass time. The layer shows the 30 000 strongest pixels by fire radiative power." />
      <h3 className="mb-1 font-mono text-[13px] uppercase tracking-[.08em] text-[var(--text-heading)]">Active fire pixel · {f.satellite}</h3>
      <dl>
        <Row label="Radiative power">{f.frpMw !== null ? `${f.frpMw.toLocaleString('en-US')} MW` : '—'}</Row>
        <Row label="Brightness">{f.brightnessK !== null ? `${f.brightnessK.toFixed(1)} K` : '—'}</Row>
        <Row label="Confidence">{f.confidence}</Row>
        <Row label="Day / night">{f.dayNight === 'D' ? 'DAY' : f.dayNight === 'N' ? 'NIGHT' : '—'}</Row>
        <Row label="Position">{`${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}`}</Row>
      </dl>
    </Body>
  );
}

export function WeatherEventCard({ selection }: CardProps) {
  const e = selection.data as unknown as WeatherEvent;
  const layer: LayerId = selection.layer === 'fires' ? 'fires' : 'weather';
  const placed = e.positionBasis === 'zone-centroid' ? 'Marker at the centre of an affected NWS zone; shaded area = the alert zones.' : undefined;
  return (
    <Body>
      <Provenance layer={layer} source={e.source} observedAt={e.observedAt} note={placed} />
      <h3 className="mb-1 font-sans text-[13px] text-[var(--text-heading)]">{e.title}</h3>
      <dl>
        <Row label="Type">{e.type.replace(/_/g, ' ')}</Row>
        <Row label="Severity">{e.severity}</Row>
        {e.alertLevel && <Row label="GDACS alert">{e.alertLevel}</Row>}
        <Row label="Provider">{e.provider}</Row>
        {e.expiresAt && <Row label="Expires">{`${e.expiresAt.slice(0, 16).replace('T', ' ')} UTC`}</Row>}
      </dl>
      {e.area && <p className="mt-1 font-sans text-[12px] text-[var(--text-secondary)]">{e.area}</p>}
      {e.detail && <p className="mt-1 font-sans text-[12px] text-[var(--text-secondary)]">{e.detail}</p>}
      <div className="mt-2">
        <ExternalLink href={safeHttp(e.url)}>Source report</ExternalLink>
      </div>
    </Body>
  );
}

export function AirQualityCard({ selection }: CardProps) {
  const a = selection.data as unknown as AirQuality;
  const cat = aqiCategory(a.usAqi);
  return (
    <Body>
      <Provenance layer="air_quality" source={a.source} observedAt={a.observedAt} note="Modelled CAMS estimate for this grid cell, not a station measurement." />
      <h3 className="mb-1 font-mono text-[13px] uppercase tracking-[.08em] text-[var(--text-heading)]">{a.station ?? 'Grid sample'}</h3>
      <dl>
        <Row label="US AQI">
          {a.usAqi ?? '—'} <span style={{ color: `var(${cat.token})` }}>{cat.label}</span>
        </Row>
        <Row label="PM2.5">{a.pm25 !== null ? `${a.pm25.toFixed(1)} µg/m³` : '—'}</Row>
        <Row label="Position">{`${a.lat.toFixed(2)}, ${a.lng.toFixed(2)}`}</Row>
      </dl>
    </Body>
  );
}

export function GpsJamCard({ selection }: CardProps) {
  const c = selection.data as unknown as GpsJamCell & { suspect?: boolean | null };
  const level = jamLevel(c);
  const live = c.basis === 'live-nacp';
  return (
    <Body>
      <Provenance
        layer="gps_jam"
        source={selection.source}
        observedAt={selection.observedAt}
        note={live ? 'Live bin: aircraft reporting NACp ≤ 4 in this H3 cell (≥ 3 aircraft).' : `gpsjam.org daily aggregate for ${c.date} (UTC day).`}
      />
      <h3 className="mb-1 font-mono text-[13px] uppercase tracking-[.08em] text-[var(--text-heading)]">GPS interference · {level.label}</h3>
      <dl>
        <Row label="Degraded share">{`${(c.badRatio * 100).toFixed(1)} %`}</Row>
        <Row label="Aircraft (bad / total)">{`${c.bad} / ${c.aircraft}`}</Row>
        <Row label="H3 cell (r4)">{c.h3}</Row>
        {!live && <Row label="Day flagged suspect">{c.suspect === true ? 'YES' : c.suspect === false ? 'NO' : 'UNKNOWN'}</Row>}
      </dl>
    </Body>
  );
}

export function SentinelCard({ selection }: CardProps) {
  const s = selection.data as unknown as SentinelScene;
  return (
    <Body>
      <Provenance layer="sentinel" source="cdse_stac" observedAt={s.datetime} note="Acquisition time of the Sentinel-2 scene." />
      <h3 className="mb-1 font-mono text-[13px] uppercase tracking-[.08em] text-[var(--text-heading)]">{s.platform ?? 'Sentinel-2'} · {s.tile ?? s.collection}</h3>
      {s.thumbnailUrl && (
        <Image src={s.thumbnailUrl} alt={`Sentinel-2 quicklook ${s.id}`} width={320} height={320} className="mb-2 h-auto w-full rounded border border-white/10" />
      )}
      <dl>
        <Row label="Cloud cover">{s.cloudCover !== null ? `${s.cloudCover.toFixed(1)} %` : '—'}</Row>
        <Row label="Collection">{s.collection}</Row>
      </dl>
      <p className="mt-1 break-all font-mono text-[10px] tracking-[.08em] text-[var(--text-muted)]">{s.id}</p>
      <div className="mt-2">
        <ExternalLink href={safeHttp(s.browserUrl)}>Open in Copernicus Browser</ExternalLink>
      </div>
    </Body>
  );
}
