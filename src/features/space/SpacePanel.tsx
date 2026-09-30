'use client';
/**
 * SPACE tool panel — "Live from Space": NASA's official ISS stream (youtube-nocookie embed, a
 * FRAME_HOSTS entry) beside the ISS position (wheretheiss.at, with its own timestamp) and a ground
 * track PROPAGATED from NORAD 25544's elements. Owner: layers-space.
 *
 * Stream check (2026-09-30): oEmbed for awQzjn72bI0 answers 200 with author "NASA" and title "Live
 * High-Definition Views from the International Space Station (Official NASA Stream)" — oEmbed
 * refuses non-embeddable videos, so embedding is allowed. The channel `/live` page could not be read
 * from the build sandbox (Google bot wall), so the panel always offers the YouTube link-out too.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crosshair, ExternalLink, Radio, X } from 'lucide-react';
import type { PanelProps } from '@/lib/feature-module';
import { useSelectionStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { entityFreshness, formatAge, FRESHNESS_COLOR_TOKEN, freshnessLabel } from '@/lib/freshness';
import type { IssResponse } from '@/lib/types';
import { FeedOfflineError, fetchIss, fetchSatelliteById, recordFromResponse, satelliteByIdQueryKey, selectionDataFor, useNow, useSpaceStore } from './client/data';

export const NASA_ISS_VIDEO_ID = 'awQzjn72bI0';
const ISS_NORAD_ID = 25544;
const W = 320;
const H = 160;

const px = (lng: number) => ((lng + 180) / 360) * W;
const py = (lat: number) => ((90 - lat) / 180) * H;

function GroundTrackMap({ iss }: { iss: IssResponse }) {
  const track = iss.groundTrack;
  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="ISS ground track on an equirectangular grid" className="w-full rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)]">
        {[-60, -30, 0, 30, 60].map((lat) => (
          <line key={`lat${lat}`} x1={0} x2={W} y1={py(lat)} y2={py(lat)} stroke="var(--border-secondary)" strokeWidth={lat === 0 ? 0.8 : 0.4} />
        ))}
        {[-120, -60, 0, 60, 120].map((lng) => (
          <line key={`lng${lng}`} y1={0} y2={H} x1={px(lng)} x2={px(lng)} stroke="var(--border-secondary)" strokeWidth={lng === 0 ? 0.8 : 0.4} />
        ))}
        {track?.segments.map((seg, i) => (
          <polyline key={i} points={seg.map(([lng, lat]) => `${px(lng).toFixed(1)},${py(lat).toFixed(1)}`).join(' ')} fill="none" stroke="var(--map-sat-science)" strokeWidth={1.2} strokeOpacity={0.8} />
        ))}
        <circle cx={px(iss.lng)} cy={py(iss.lat)} r={4} fill="var(--cyan-primary)" stroke="var(--bg-void)" strokeWidth={1} />
      </svg>
      <figcaption className="font-sans text-[12px] text-[var(--text-secondary)]">
        {track
          ? `Dot: position reported by wheretheiss.at. Line: ground track propagated (SGP4) from NORAD 25544 elements of ${track.elementsEpoch.slice(0, 16).replace('T', ' ')} UTC, −45 to +90 min.`
          : 'Dot: position reported by wheretheiss.at. Ground track appears once the satellite catalogue has loaded.'}
      </figcaption>
    </figure>
  );
}

export function SpacePanel({ onClose }: PanelProps) {
  const autoplay = useUiStore((s) => s.settings.previewAutoplay);
  const requestFlyTo = useUiStore((s) => s.requestFlyTo);
  const setLayer = useUiStore((s) => s.setLayer);
  const select = useSelectionStore((s) => s.select);
  const frameAt = useSpaceStore((s) => s.frameAt);
  // Only the ISS elements (one row), so the panel works with the layer off and never parses the catalogue.
  const sats = useQuery({ queryKey: satelliteByIdQueryKey(ISS_NORAD_ID), queryFn: () => fetchSatelliteById(ISS_NORAD_ID), staleTime: 5 * 60_000 });
  const now = useNow(1000);
  const iss = useQuery({ queryKey: ['space', 'iss'], queryFn: fetchIss, refetchInterval: 5_000, staleTime: 4_000 });
  const d = iss.data;
  const offline = iss.error instanceof FeedOfflineError ? iss.error : null;
  const state = d ? entityFreshness({ kind: 'live', at: d.meta.observedAt ? Date.parse(d.meta.observedAt) : null, observationCadenceMs: 60_000, feedState: d.meta.state, now }) : 'offline';
  const issRecord = useMemo(() => recordFromResponse(sats.data, ISS_NORAD_ID), [sats.data]);

  const embed = `https://www.youtube-nocookie.com/embed/${NASA_ISS_VIDEO_ID}?${new URLSearchParams({ autoplay: autoplay ? '1' : '0', mute: '1', playsinline: '1', rel: '0' })}`;

  return (
    <section aria-label="Live from Space" className="glass-panel flex w-full flex-col gap-3 p-3" data-testid="space-panel">
      <header className="flex items-center gap-2">
        <Radio aria-hidden className="h-4 w-4 text-[var(--cyan-primary)]" />
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--cyan-primary)]">Live from Space</h2>
        <span className="ml-auto rounded-sm border border-[var(--border-secondary)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">NASA stream</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Live from Space"
          className="grid h-8 w-8 place-items-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </header>

      <div className="relative w-full overflow-hidden rounded-md bg-[var(--bg-void)]" style={{ aspectRatio: '16 / 9' }}>
        <iframe
          src={embed}
          title="Live High-Definition Views from the International Space Station (Official NASA Stream)"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          loading="lazy"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
      <p className="flex items-start justify-between gap-2 font-sans text-[12px] text-[var(--text-secondary)]">
        <span>Official NASA stream. During loss of signal NASA shows a holding screen or a recording.</span>
        <a
          href={`https://www.youtube.com/watch?v=${NASA_ISS_VIDEO_ID}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-6 shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cyan-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
        >
          YouTube <ExternalLink aria-hidden className="h-3 w-3" />
        </a>
      </p>

      <div className="flex flex-col gap-2 border-t border-[var(--border-secondary)] pt-2" aria-live="polite">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">ISS · NORAD 25544</h3>
          <span
            className="ml-auto rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{ color: `var(${FRESHNESS_COLOR_TOKEN[state]})`, borderColor: `var(${FRESHNESS_COLOR_TOKEN[state]})` }}
          >
            {d ? freshnessLabel(state, d.meta.observedAt ? Date.parse(d.meta.observedAt) : null, now) : iss.isPending ? 'Acquiring' : 'Source offline'}
          </span>
        </div>
        {d ? (
          <>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums tracking-[0.08em]">
              {[
                ['Lat', `${d.lat.toFixed(2)}°`],
                ['Lng', `${d.lng.toFixed(2)}°`],
                ['Alt', `${Math.round(d.altKm)} km`],
                ['Speed', `${Math.round(d.velocityKmH).toLocaleString('en-US')} km/h`],
                ['Sun', d.visibility === 'eclipsed' ? 'Eclipsed' : d.visibility === 'daylight' ? 'Daylight' : '—'],
                ['Seen', d.meta.observedAt ? `${formatAge(now - Date.parse(d.meta.observedAt))} ago` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{k}</dt>
                  <dd className="truncate text-[var(--text-primary)]">{v}</dd>
                </div>
              ))}
            </dl>
            <GroundTrackMap iss={d} />
          </>
        ) : (
          <p className="font-sans text-[12px] text-[var(--text-secondary)]">
            {offline
              ? `SOURCE OFFLINE — wheretheiss.at did not answer${offline.meta?.lastGoodAt ? `; last good ${offline.meta.lastGoodAt.slice(11, 19)} UTC` : ''}.`
              : 'Acquiring ISS position…'}
          </p>
        )}
        <button
          type="button"
          disabled={!issRecord}
          onClick={() => {
            if (!issRecord) return;
            setLayer('satellites', true);
            select({
              kind: 'satellite',
              id: String(ISS_NORAD_ID),
              layer: 'satellites',
              source: sats.data?.catalogueSource === 'satnogs-fallback' ? 'satnogs' : 'celestrak',
              observedAt: issRecord.epoch,
              data: selectionDataFor(issRecord, frameAt ?? Date.now(), sats.data ?? null),
              lngLat: d ? [d.lng, d.lat] : null,
            });
            if (d) requestFlyTo({ lng: d.lng, lat: d.lat, zoom: 2.2 });
          }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border-cyan)] font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--cyan-primary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Crosshair aria-hidden className="h-4 w-4" />
          {issRecord ? 'Track ISS on globe' : sats.isError ? 'Satellite catalogue offline' : 'Satellite catalogue loading…'}
        </button>
      </div>
    </section>
  );
}
