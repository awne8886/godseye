'use client';
/**
 * Entity card bodies for cameras and live-news channels (the HUD frame supplies kind, id,
 * freshness badge, source and observed-at). Each card names the operator, licence, attribution and
 * terms, says plainly when the operator publishes no image time, and carries the one-click
 * "Report / remove this camera" link (§0.7). Owner: layers-surveillance.
 */
import { MonitorPlay, Tv } from 'lucide-react';
import type { CardProps } from '@/lib/feature-module';
import type { Camera, NewsChannel } from '@/lib/types';
import { cameraTag, STREAM_LABEL } from '../shared';
import { isoShort, OutLink, ProviderBlock, ReportLink, Row } from './parts';
import { openCameraViewer, openLiveNews } from './store';
import { refreshSeconds, useProviders } from './useProviders';

const btn =
  'inline-flex min-h-[32px] items-center gap-1.5 rounded border border-[var(--gold-primary)] px-2.5 font-mono text-[11px] uppercase tracking-[.08em] text-[var(--gold-primary)] hover:bg-[var(--gold-primary)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]';

export function CameraCard({ selection }: CardProps) {
  const cam = selection.data as unknown as Camera;
  const providers = useProviders();
  const provider = providers?.get(cam.providerId);
  const place = [cam.city, cam.country].filter(Boolean).join(', ');
  return (
    <div className="flex flex-col gap-2" data-testid="camera-card">
      <p className="font-sans text-[13px] text-[var(--text-heading)]">{cam.name}</p>
      <dl>
        <Row label="Tag">{cameraTag(cam.lat, cam.lng)}</Row>
        {place && <Row label="Place">{place}</Row>}
        <Row label="Feed">{provider?.link_out_only ? 'LINK OUT' : STREAM_LABEL[cam.streamType]}</Row>
        <Row label="Image time" testId="camera-observed">
          {cam.observedAt ? isoShort(cam.observedAt) : 'Time not published by operator'}
        </Row>
        {provider && !provider.link_out_only && <Row label="Refresh">{`≥ ${refreshSeconds(provider)} s`}</Row>}
      </dl>
      <ProviderBlock provider={provider} />
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {provider?.link_out_only || cam.streamType === 'link' ? (
          <OutLink href={cam.externalUrl ?? provider?.terms_url ?? null}>Open at operator</OutLink>
        ) : (
          <button type="button" className={btn} onClick={() => openCameraViewer(cam)} data-testid="camera-open-viewer">
            <MonitorPlay size={14} aria-hidden /> Open viewer
          </button>
        )}
        {cam.externalUrl && !provider?.link_out_only && cam.streamType !== 'link' && <OutLink href={cam.externalUrl}>Operator page</OutLink>}
      </div>
      <ReportLink camera={cam} provider={provider} />
    </div>
  );
}

/** Live status with the time it was checked (never LIVE without an observed check time). */
export function liveLabel(live: boolean | null, checkedAt: string | null = null): string {
  const at = checkedAt ? ` · CHECKED ${checkedAt.slice(11, 16)}Z` : '';
  if (live === true) return checkedAt ? `LIVE${at}` : 'LIVE STATUS UNKNOWN';
  return live === false ? `NOT LIVE${at}` : 'LIVE STATUS UNKNOWN';
}

export function NewsChannelCard({ selection }: CardProps) {
  const ch = selection.data as unknown as NewsChannel;
  return (
    <div className="flex flex-col gap-2" data-testid="news-card">
      <p className="font-sans text-[13px] text-[var(--text-heading)]">{ch.name}</p>
      <dl>
        <Row label="HQ">{[ch.city, ch.country].filter(Boolean).join(', ')}</Row>
        <Row label="Category">{ch.category}</Row>
        <Row label="Status" testId="news-live">{liveLabel(ch.live, ch.observedAt)}</Row>
        {ch.observedAt && <Row label="Checked">{isoShort(ch.observedAt)}</Row>}
        <Row label="Playback">{ch.embedAllowed ? 'Official embed' : 'Opens on YouTube'}</Row>
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        {ch.embedAllowed && ch.embedUrl ? (
          <button type="button" className={btn} onClick={() => openLiveNews(ch)}>
            <Tv size={14} aria-hidden /> Watch
          </button>
        ) : null}
        <OutLink href={ch.externalUrl}>YouTube</OutLink>
      </div>
      <p className="font-sans text-[12px] text-[var(--text-secondary)]">Official broadcaster channel. The live status comes from an hourly server-side check of the channel&apos;s live page.</p>
    </div>
  );
}
