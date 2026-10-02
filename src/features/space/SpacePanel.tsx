'use client';
/**
 * SPACE tool panel — "Live from Space": NASA's official ISS stream (youtube-nocookie embed, a
 * FRAME_HOSTS entry) beside the ISS position (COMPUTED by wheretheiss.at from NORAD 25544's TLE,
 * badged COMPUTED with that TLE's epoch, never LIVE: it is not an observation) and a ground
 * track PROPAGATED from NORAD 25544's elements. Owner: layers-space.
 *
 * Stream check (2026-09-30): oEmbed for awQzjn72bI0 answers 200 with author "NASA" and title "Live
 * High-Definition Views from the International Space Station (Official NASA Stream)" — oEmbed
 * refuses non-embeddable videos, so embedding is allowed. The channel `/live` page could not be read
 * from the build sandbox (Google bot wall), so the panel always offers the YouTube link-out too.
 * Round 8: the player shows only after the IFrame Player API answers (`usePlayerState`), and the
 * panel header carries a state chip (`spaceChip`).
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crosshair, ExternalLink, Radio } from 'lucide-react';
import { usePanelChip, type ChipTone } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { useSelectionStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { entityFreshness, formatAge, FRESHNESS_COLOR_TOKEN, freshnessLabel } from '@/lib/freshness';
import type { FreshnessState, IssResponse } from '@/lib/types';
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
          ? `Dot: position computed by wheretheiss.at from TLE elements (SGP4), not observed. Line: ground track propagated (SGP4) from NORAD 25544 elements of ${track.elementsEpoch.slice(0, 16).replace('T', ' ')} UTC, −45 to +90 min.`
          : 'Dot: position computed by wheretheiss.at from TLE elements (SGP4), not observed. Ground track appears once the satellite catalogue has loaded.'}
      </figcaption>
    </figure>
  );
}

/**
 * Badge for the ISS readout. wheretheiss.at propagates a TLE, so a fresh answer is COMPUTED (cyan,
 * like the satellite card's PROPAGATED), never LIVE; it still ages (COMPUTED · 3m), then follows the
 * feed to STALE / OFFLINE.
 */
export function issBadge(state: FreshnessState, positionAt: number | null, now: number): { label: string; colorToken: string; computed: boolean } {
  if (state === 'live') return { label: 'Computed', colorToken: '--cyan-primary', computed: true };
  if (state === 'recent') return { label: `Computed · ${freshnessLabel(state, positionAt, now)}`, colorToken: FRESHNESS_COLOR_TOKEN.recent, computed: true };
  return { label: freshnessLabel(state, positionAt, now), colorToken: FRESHNESS_COLOR_TOKEN[state], computed: false };
}

/** How long the embed may take before the panel says it did not load (the link-out stays). */
export const PLAYER_TIMEOUT_MS = 15_000;

/** The embed's origin: the only origin whose player messages count. */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
/** How often the panel repeats the IFrame Player API "listening" handshake until the player answers. */
export const PLAYER_HANDSHAKE_MS = 250;
/**
 * After PLAYER_TIMEOUT_MS the handshake keeps going at this slower pace, so a player that answers
 * late (seen at 18 s through a slow proxy) still flips the panel to ready instead of leaving the
 * "did not load" note over a working stream.
 */
export const PLAYER_LATE_HANDSHAKE_MS = 2_000;
/**
 * Player API events that only a loaded player sends. Checked against the embed client on
 * 2026-10-02: on a "listening" message it answers initialDelivery + onReady (alreadyInitialized
 * to a repeated one), JSON strings with channel "widget", posted to the sender's origin.
 */
const PLAYER_READY_EVENTS: ReadonlySet<string> = new Set(['onReady', 'initialDelivery', 'infoDelivery', 'alreadyInitialized']);
/** Larger player messages are not parsed (the ones we read are a few kB). */
const MAX_PLAYER_MESSAGE = 64 * 1024;

export type PlayerState = 'loading' | 'ready' | 'failed';

/**
 * True when `data` is a YouTube IFrame Player API message from a working player (onReady,
 * initialDelivery or infoDelivery). Only the `event` name is read; nothing is rendered from it.
 */
export function isPlayerReadyMessage(data: unknown): boolean {
  let msg: unknown = data;
  if (typeof data === 'string') {
    if (data.length > MAX_PLAYER_MESSAGE) return false;
    try {
      msg = JSON.parse(data);
    } catch {
      return false;
    }
  }
  if (!msg || typeof msg !== 'object') return false;
  const event = (msg as { event?: unknown }).event;
  return typeof event === 'string' && PLAYER_READY_EVENTS.has(event);
}

/**
 * The panel's header chip (§7): the ISS readout's state (COMPUTED, never LIVE: wheretheiss.at
 * propagates a TLE), SOURCE OFFLINE when /api/iss fails (also while an older answer is still
 * shown), CONNECTING until the first answer. The tooltip adds the NASA stream's state.
 */
export function spaceChip(
  iss: { badge: { label: string } | null; state: FreshnessState; pending: boolean; failed: boolean; lastGoodAt: string | null },
  player: PlayerState,
): { text: string; tone: ChipTone; title: string } {
  const stream = player === 'ready' ? 'NASA stream playing' : player === 'loading' ? 'NASA stream connecting' : 'NASA stream did not load here';
  if (iss.failed) {
    const last = iss.lastGoodAt ? `; last good ${iss.lastGoodAt.slice(11, 19)} UTC` : '';
    return { text: 'SOURCE OFFLINE', tone: 'error', title: `ISS position: wheretheiss.at did not answer${last}. ${stream}.` };
  }
  if (iss.badge) {
    const tone: ChipTone = iss.state === 'live' ? 'live' : iss.state === 'offline' ? 'error' : 'warn';
    return { text: iss.badge.label.toUpperCase(), tone, title: `ISS position computed (SGP4) by wheretheiss.at from TLE elements, not observed. ${stream}.` };
  }
  if (iss.pending) return { text: 'CONNECTING', tone: 'busy', title: `Acquiring the ISS position. ${stream}.` };
  return { text: 'SOURCE OFFLINE', tone: 'error', title: `ISS position: wheretheiss.at did not answer. ${stream}.` };
}

/**
 * Whether the NASA embed really plays. An iframe `load` event proves nothing: Chrome fires it for
 * its own network-error page too (a blocking network or filter). The panel therefore uses the
 * YouTube IFrame Player API handshake (`enablejsapi=1` + `origin`): after each load it posts the
 * API's "listening" message to the frame — addressed to the YouTube origin, so an error page never
 * receives it — and the player counts as ready only when the YouTube origin, from this very frame,
 * answers with onReady / initialDelivery / infoDelivery. No answer within PLAYER_TIMEOUT_MS = failed,
 * but the handshake continues (every PLAYER_LATE_HANDSHAKE_MS) until the player answers, so a late
 * player still becomes ready.
 */
function usePlayerState(frameRef: RefObject<HTMLIFrameElement | null>): { player: PlayerState; onLoad: () => void } {
  const [player, setPlayer] = useState<PlayerState>('loading');
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setPlayer((p) => (p === 'loading' ? 'failed' : p)), PLAYER_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const win = frameRef.current?.contentWindow;
      if (e.origin !== YOUTUBE_EMBED_ORIGIN || !win || e.source !== win) return;
      if (isPlayerReadyMessage(e.data)) setPlayer('ready');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameRef]);
  useEffect(() => {
    if (!loads || player === 'ready') return;
    const listening = JSON.stringify({ event: 'listening', id: 1, channel: 'widget' });
    const send = () => frameRef.current?.contentWindow?.postMessage(listening, YOUTUBE_EMBED_ORIGIN);
    send();
    const t = setInterval(send, player === 'loading' ? PLAYER_HANDSHAKE_MS : PLAYER_LATE_HANDSHAKE_MS);
    return () => clearInterval(t);
  }, [loads, player, frameRef]);
  return { player, onLoad: () => setLoads((n) => n + 1) };
}

/** The host frame (InstrumentFrame / phone sheet) owns the title and the close button. */
export function SpacePanel(_props: PanelProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { player, onLoad } = usePlayerState(frameRef);
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
  const positionAt = d?.meta.observedAt ? Date.parse(d.meta.observedAt) : null;
  const state = d ? entityFreshness({ kind: 'live', at: positionAt, observationCadenceMs: 60_000, feedState: d.meta.state, now }) : 'offline';
  const badge = d ? issBadge(state, positionAt, now) : null;
  const issRecord = useMemo(() => recordFromResponse(sats.data, ISS_NORAD_ID), [sats.data]);
  const chip = spaceChip({ badge, state, pending: iss.isPending, failed: iss.isError, lastGoodAt: offline?.meta?.lastGoodAt ?? d?.meta.lastGoodAt ?? null }, player);
  usePanelChip(chip.text, chip.tone, chip.title);

  // enablejsapi + origin: the player answers the panel's handshake (see usePlayerState).
  const embed = `${YOUTUBE_EMBED_ORIGIN}/embed/${NASA_ISS_VIDEO_ID}?${new URLSearchParams({ autoplay: autoplay ? '1' : '0', mute: '1', playsinline: '1', rel: '0', enablejsapi: '1', origin: window.location.origin })}`;

  return (
    // The host's panel frame supplies the one header (SPACE + state chip + close); this body adds a
    // sub-heading only. The player stays collapsed until the embed has loaded, so the panel never
    // shows an empty black 16:9 box (R3-m7, n6).
    <div className="flex w-full flex-col gap-3" data-testid="space-panel">
      <div className="flex items-center gap-2">
        <Radio aria-hidden className="h-4 w-4 text-[var(--cyan-primary)]" />
        <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">Live from space · NASA stream</h3>
      </div>

      <div
        className="relative w-full overflow-hidden rounded-md bg-[var(--bg-void)]"
        style={player === 'ready' ? { aspectRatio: '16 / 9' } : { height: 0 }}
        aria-hidden={player === 'ready' ? undefined : true}
        data-testid="space-player"
        data-state={player}
      >
        <iframe
          ref={frameRef}
          src={embed}
          title="Live High-Definition Views from the International Space Station (Official NASA Stream)"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          tabIndex={player === 'ready' ? undefined : -1}
          onLoad={onLoad}
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
      {player !== 'ready' && (
        <p role="status" className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]" data-testid="space-player-status">
          {player === 'loading' ? 'Connecting to the NASA stream…' : 'The NASA stream did not load here; open it on YouTube.'}
        </p>
      )}
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
            style={{ color: `var(${badge?.colorToken ?? FRESHNESS_COLOR_TOKEN[state]})`, borderColor: `var(${badge?.colorToken ?? FRESHNESS_COLOR_TOKEN[state]})` }}
            title={badge?.computed ? 'Computed (SGP4) by wheretheiss.at from published TLE elements, not observed' : undefined}
            data-testid="iss-badge"
          >
            {badge ? badge.label : iss.isPending ? 'Acquiring' : 'Source offline'}
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
                ['Computed', positionAt !== null ? `${formatAge(now - positionAt)} ago` : '—'],
                ['TLE epoch', d.position?.elementsEpoch ? `${d.position.elementsEpoch.slice(0, 16).replace('T', ' ')} UTC` : 'Unknown'],
              ].map(([k, v]) => (
                <div key={k} className={k === 'TLE epoch' ? 'col-span-3 min-w-0' : 'min-w-0'}>
                  <dt className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{k}</dt>
                  <dd className="truncate text-[var(--text-primary)]">{v}</dd>
                </div>
              ))}
            </dl>
            <GroundTrackMap iss={d} />
          </>
        ) : (
          <p className="font-sans text-[12px] text-[var(--text-secondary)]">
            {iss.isError
              ? `SOURCE OFFLINE — wheretheiss.at did not answer${offline?.meta?.lastGoodAt ? `; last good ${offline.meta.lastGoodAt.slice(11, 19)} UTC` : ''}.`
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
    </div>
  );
}
