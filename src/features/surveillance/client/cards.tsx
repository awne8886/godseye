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
import { cameraTag, frameHealthLabel, frameHealthNote, STREAM_LABEL } from '../shared';
import { isoShort, OutLink, ProviderBlock, ReportLink, Row } from './parts';
import { openCameraViewer, openLiveNews } from './store';
import { refreshSeconds, useFrameHealth, useProviders } from './useProviders';

const btn =
  'inline-flex min-h-8 phone:min-h-11 items-center gap-1.5 rounded border border-[var(--gold-primary)] px-2.5 font-mono text-[11px] uppercase tracking-[.08em] text-[var(--gold-primary)] hover:bg-[var(--gold-primary)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]';

const TONE_CLASS = { ok: 'text-[var(--alert-green)]', warn: 'text-[var(--alert-orange)]', error: 'text-[var(--alert-red)]', idle: 'text-[var(--text-secondary)]' } as const;

export function CameraCard({ selection }: CardProps) {
  const cam = selection.data as unknown as Camera;
  const providers = useProviders();
  const health = useFrameHealth();
  const provider = providers?.get(cam.providerId);
  const place = [cam.city, cam.country].filter(Boolean).join(', ');
  const proxied = !!provider && provider.proxy_allowed && !provider.link_out_only && cam.streamType !== 'link';
  // AVAILABLE only for fresh frames: judged against this operator's own refresh interval.
  const frames = proxied ? frameHealthLabel(health[cam.providerId], refreshSeconds(provider)) : null;
  return (
    <div className="flex flex-col gap-2" data-testid="camera-card">
      <p className="font-sans text-[13px] text-[var(--text-heading)]">{cam.name}</p>
      <dl>
        <Row label="Tag">{cameraTag(cam.lat, cam.lng)}</Row>
        {place && <Row label="Place">{place}</Row>}
        <Row label="Feed">{provider?.link_out_only ? 'LINK OUT' : STREAM_LABEL[cam.streamType]}</Row>
        {/* The operator's frame time as of the last camera-list refresh (the viewer shows the current frame's own time). */}
        <Row label={cam.observedAt ? 'Listed frame time' : 'Image time'} testId="camera-observed">
          {cam.observedAt ? isoShort(cam.observedAt) : 'Time not published by operator'}
        </Row>
        {provider && !provider.link_out_only && <Row label="Refresh">{`≥ ${refreshSeconds(provider)} s`}</Row>}
        {frames && (
          <Row label="Operator frames" testId="camera-frames">
            <span className={TONE_CLASS[frames.tone]}>{frames.text}</span>
          </Row>
        )}
      </dl>
      {frames && frameHealthNote(health[cam.providerId]) && (
        <p className="font-sans text-[12px] text-[var(--text-secondary)]" data-testid="camera-frames-note">
          {frameHealthNote(health[cam.providerId])}
        </p>
      )}
      <ProviderBlock provider={provider} />
      {/* m21: the actions and the report link stay in view inside the card's scroll container (phones).
          r7: opaque token background + top edge so scrolled body rows never show through the footer. */}
      <div
        className="sticky bottom-0 -mx-4 border-t border-[var(--border-primary)] bg-[var(--bg-panel-solid)] px-4 pb-1 pt-2"
        data-testid="camera-card-footer"
      >
        <div className="flex flex-wrap items-center gap-3">
            {provider?.link_out_only || cam.streamType === 'link' ? (
            <OutLink href={cam.externalUrl ?? provider?.terms_url ?? null} testId="camera-open-operator">
              Open at operator
            </OutLink>
          ) : (
            <button type="button" className={btn} onClick={() => openCameraViewer(cam)} data-testid="camera-open-viewer">
              <MonitorPlay size={14} aria-hidden /> Open viewer
            </button>
          )}
          {cam.externalUrl && !provider?.link_out_only && cam.streamType !== 'link' && <OutLink href={cam.externalUrl}>Operator page</OutLink>}
        </div>
        <ReportLink camera={cam} provider={provider} />
      </div>
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
