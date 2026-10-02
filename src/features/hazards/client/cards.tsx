'use client';
/**
 * Entity card bodies for the hazards layers. The HUD frame supplies source, observed-at time with
 * age, the freshness badge and SOURCE OFFLINE / last-good; bodies add the originator link and the
 * entity details. Upstream strings render as React text only. Owner: layers-hazards.
 */
import Image from 'next/image';
import type { ReactNode } from 'react';
import type { CardProps } from '@/lib/feature-module';
import type { AirQuality, Earthquake, GpsJamCell, SentinelScene, WeatherEvent } from '@/lib/types';
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

/**
 * Card-body provenance. The HUD frame (EntityCardFrame) already shows SOURCE, OBSERVED (time + age),
 * the freshness badge and SOURCE OFFLINE / last-good, so the body does not repeat them (visual-qa m7).
 * It adds only what the frame cannot know: the originator's name and link, the UTC day of a daily
 * aggregate (gpsjam has no single observation instant) and a short note on what the time means.
 */
export function Provenance({ source, observedDay, note }: { source: string; observedDay?: string; note?: string }) {
  const src = SOURCES[source] ?? { label: source, url: null };
  return (
    <div className="mb-2 border-b border-white/10 pb-2" data-testid="hazard-provenance">
      <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-secondary)]" data-testid="card-source">
        DATA · {src.url ? <ExternalLink href={src.url}>{src.label}</ExternalLink> : src.label}
      </div>
      {observedDay && (
        <div className="mt-1 font-mono text-[11px] uppercase tracking-[.08em] tabular-nums text-[var(--text-primary)]" data-testid="card-observed-day">
          UTC DAY {observedDay} · DAILY AGGREGATE
        </div>
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
      <Provenance source={q.source} />
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
      <Provenance source={f.source} note="Satellite overpass time. The layer shows the 30 000 strongest pixels by fire radiative power." />
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

/** NWS UGC zone codes, the first 12 listed and the rest counted (never silently cut). */
export function zoneList(zones: readonly string[], max = 12): string {
  return zones.length > max ? `${zones.slice(0, max).join(', ')} +${zones.length - max} more` : zones.join(', ');
}

export function WeatherEventCard({ selection }: CardProps) {
  const e = selection.data as unknown as WeatherEvent;
  const placed = e.positionBasis === 'zone-centroid' ? 'Marker at the centre of an affected NWS zone; shaded area = the alert zones.' : undefined;
  return (
    <Body>
      <Provenance source={e.source} note={placed} />
      <h3 className="mb-1 font-sans text-[13px] text-[var(--text-heading)]">{e.title}</h3>
      <dl>
        <Row label="Type">{e.type.replace(/_/g, ' ')}</Row>
        <Row label="Severity">{e.severity}</Row>
        {e.alertLevel && <Row label="GDACS alert">{e.alertLevel}</Row>}
        <Row label="Provider">{e.provider}</Row>
        {e.expiresAt && <Row label="Expires">{`${e.expiresAt.slice(0, 16).replace('T', ' ')} UTC`}</Row>}
        {!!e.zones?.length && <Row label="Zones">{zoneList(e.zones)}</Row>}
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
      <Provenance source={a.source} note="Modelled CAMS estimate for this grid cell, not a station measurement." />
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
        source={selection.source}
        observedDay={live ? undefined : (c.date ?? undefined)}
        note={live ? 'Live bin: airborne ADS-B aircraft (no ground, TIS-B, ADS-R or MLAT positions) seen in the last 60 s; NACp ≤ 4 counts as degraded; ≥ 3 aircraft in this H3 cell.' : `gpsjam.org daily aggregate for ${c.date} (UTC day); share = (bad − 1) / (good + bad), gpsjam's published formula.`}
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
      <Provenance source="cdse_stac" note="Acquisition time of the Sentinel-2 scene." />
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
