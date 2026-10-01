'use client';
/**
 * On-map camera preview tiles (OSIRIS parity, bounded): zoom ≥ 13, at most 8 tiles nearest the
 * view centre, at most 4 of them video (TfL latest-clip mp4 only; HLS tiles show the still to spare
 * operator bandwidth), 176×99 px, positioned by direct DOM transforms on every `move` (no React
 * re-render per frame). Stills refresh no faster than the operator's poll interval (≥ 15 s), only
 * while the tab is visible and only when previews autoplay is on (Settings). Frames come from the
 * same-origin stills proxy, fetched as blobs so a refusal is read, never drawn as a broken image.
 *
 * Every tile always asks for its own frame: the operator's frame availability (/api/cctv/providers
 * `frames`) is only a label on a tile whose own request failed — SOURCE OFFLINE with the operator's
 * last good relay time when its frames are unavailable across ≥ 5 cameras, otherwise this camera's
 * own outcome (CAMERA OFFLINE · reason, or FEED UNAVAILABLE for a transient failure). A failed tile is
 * retried at the next refresh. Owner: layers-surveillance.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Cell } from '@/lib/columnar';
import { useMapInstanceStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import type { Camera, FrameHealth } from '@/lib/types';
import { FRAME_REASON_LABEL, hhmmZ, PREVIEW_H, PREVIEW_MAX_TILES, PREVIEW_MAX_VIDEO, PREVIEW_MIN_ZOOM, PREVIEW_W, readFrameFailure, stillPath, type FrameFailure } from '../shared';
import { IDX, rowToCamera } from './rows';
import { selectCamera } from './store';
import { refreshSeconds, useFrameHealth, useProviders } from './useProviders';

const STILL_REFRESH_MS = 15_000;
const NETWORK_FAILURE: FrameFailure = { state: 'unavailable', detail: 'network', message: 'The frame could not be loaded.' };
const DECODE_FAILURE: FrameFailure = { state: 'unavailable', detail: 'decode', message: 'The frame could not be decoded.' };

export type TileState = 'frame' | 'video' | 'failed';

/** What a preview tile shows: the clip, its own still, or a placeholder when its own frame failed. */
export function tileState(opts: { video: boolean; failure: FrameFailure | null }): TileState {
  if (opts.video) return 'video';
  return opts.failure ? 'failed' : 'frame';
}

/**
 * Placeholder wording for a tile whose own frame failed. SOURCE OFFLINE only when the operator's
 * frames are unavailable (≥ 5 cameras, operator-wide failures), always with the last good relay
 * time or "NO FRAME IN 10 MIN"; otherwise this camera's own outcome.
 */
export function tileNote(failure: FrameFailure, health: Pick<FrameHealth, 'state' | 'lastOkAt' | 'windowS'> | undefined): { title: string; detail: string } {
  if (health?.state === 'unavailable') {
    const last = hhmmZ(health.lastOkAt);
    return { title: 'SOURCE OFFLINE', detail: last ? `LAST GOOD ${last}` : `NO FRAME IN ${Math.round(health.windowS / 60)} MIN` };
  }
  const why = FRAME_REASON_LABEL[failure.detail] ?? (failure.state === 'offline' ? 'NO FRAME' : 'RETRYING');
  return { title: failure.state === 'offline' ? 'CAMERA OFFLINE' : 'FEED UNAVAILABLE', detail: why };
}

function useVisibleClock(periodMs: number, enabled: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, periodMs);
    return () => clearInterval(t);
  }, [periodMs, enabled]);
  return tick;
}

/**
 * The tile's own still for refresh `bucket`, fetched from the proxy as a blob (the HTTP cache still
 * applies). A refusal (JSON FrameError) or a network failure clears the image and returns the reason.
 */
function useTileFrame(url: string | null, bucket: number): { src: string | null; failure: FrameFailure | null; fail: (f: FrameFailure) => void } {
  const [state, setState] = useState<{ src: string | null; failure: FrameFailure | null }>({ src: null, failure: null });
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!url) return;
    const ac = new AbortController();
    const show = (src: string | null, failure: FrameFailure | null) => {
      if (last.current && last.current !== src) URL.revokeObjectURL(last.current);
      last.current = src;
      setState({ src, failure });
    };
    fetch(`${url}&r=${bucket}`, { signal: ac.signal })
      .then(async (res) => {
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.startsWith('image/')) {
          const body = type.includes('json') ? await res.json().catch(() => null) : null;
          if (!ac.signal.aborted) show(null, readFrameFailure(res.status, body));
          return;
        }
        const blob = await res.blob();
        if (!ac.signal.aborted) show(URL.createObjectURL(blob), null);
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError' && !ac.signal.aborted) show(null, NETWORK_FAILURE);
      });
    return () => ac.abort();
  }, [url, bucket]);
  useEffect(
    () => () => {
      if (last.current) URL.revokeObjectURL(last.current);
    },
    [],
  );
  // An image that does not decode is dropped like a refusal (never left as a broken image).
  const fail = useCallback((f: FrameFailure) => {
    if (last.current) URL.revokeObjectURL(last.current);
    last.current = null;
    setState({ src: null, failure: f });
  }, []);
  return { ...state, fail };
}

export function PreviewTile({ cam, video, bucket, health, tileRef }: { cam: Camera; video: boolean; bucket: number; health: FrameHealth | undefined; tileRef: (el: HTMLButtonElement | null) => void }) {
  const frame = useTileFrame(video ? null : stillPath(cam), bucket);
  const state = tileState({ video, failure: frame.failure });
  const note = state === 'failed' && frame.failure ? tileNote(frame.failure, health) : null;
  return (
    <button
      ref={tileRef}
      type="button"
      onClick={() => selectCamera(cam)}
      className="pointer-events-auto absolute left-0 top-0 overflow-hidden rounded-md border border-[var(--map-cctv)] bg-[var(--bg-void)] shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
      style={{ width: PREVIEW_W, height: PREVIEW_H }}
      aria-label={`Open camera ${cam.name}`}
      data-tile-state={state}
    >
      {state === 'video' ? (
        // TfL sends no CORS headers: a plain <video src> (no crossOrigin) plays it.
        <video src={cam.streamUrl!} muted autoPlay loop playsInline className="h-full w-full object-cover" poster={stillPath(cam)} />
      ) : note ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 pb-3 font-mono text-[10px] uppercase tracking-[.16em] tabular-nums" data-testid="cctv-tile-unavailable">
          <span className="text-[var(--alert-red)]">{note.title}</span>
          <span className="text-[var(--text-secondary)]" data-testid="cctv-tile-detail">
            {note.detail}
          </span>
        </span>
      ) : frame.src ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob URL of a same-origin proxied frame, refreshed in place
        <img src={frame.src} alt={`Latest still from ${cam.name}`} className="h-full w-full object-cover" decoding="async" onError={() => frame.fail(DECODE_FAILURE)} />
      ) : null}
      <span className="absolute inset-x-0 bottom-0 truncate bg-[var(--bg-void)]/80 px-1 text-left font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-primary)]">{cam.name}</span>
    </button>
  );
}

export default function CctvPreviews({ rows }: { rows: Cell[][] }) {
  // Previews only project points and read bounds, which work before the first `idle` (useMapInstance waits for it).
  const map = useMapInstanceStore((s) => s.map);
  const autoplay = useUiStore((s) => s.settings.previewAutoplay);
  const [picked, setPicked] = useState<Cell[][]>([]);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const tick = useVisibleClock(STILL_REFRESH_MS, autoplay);
  const providers = useProviders();
  const health = useFrameHealth();

  // Choose tiles when the view settles.
  useEffect(() => {
    if (!map) return;
    const choose = () => {
      if (map.getZoom() < PREVIEW_MIN_ZOOM) return setPicked([]);
      const b = map.getBounds();
      const c = map.getCenter();
      const inView = rows.filter((r) => r[IDX.streamType] !== 'link' && r[IDX.stillUrl] && b.contains([r[IDX.lng] as number, r[IDX.lat] as number]));
      inView.sort((a, z) => ((a[IDX.lat] as number) - c.lat) ** 2 + ((a[IDX.lng] as number) - c.lng) ** 2 - (((z[IDX.lat] as number) - c.lat) ** 2 + ((z[IDX.lng] as number) - c.lng) ** 2));
      // Nearest first, skipping cameras whose tile would overlap one already placed.
      const placed: { x: number; y: number }[] = [];
      const out: Cell[][] = [];
      for (const r of inView) {
        if (out.length >= PREVIEW_MAX_TILES) break;
        const p = map.project([r[IDX.lng] as number, r[IDX.lat] as number]);
        if (placed.some((q) => Math.abs(q.x - p.x) < PREVIEW_W + 6 && Math.abs(q.y - p.y) < PREVIEW_H + 6)) continue;
        placed.push(p);
        out.push(r);
      }
      setPicked(out);
    };
    choose();
    map.on('moveend', choose);
    return () => {
      map.off('moveend', choose);
    };
  }, [map, rows]);

  // Position tiles on every frame of a move.
  useEffect(() => {
    if (!map) return;
    const place = () => {
      for (const r of picked) {
        const el = refs.current.get(String(r[IDX.id]));
        if (!el) continue;
        const p = map.project([r[IDX.lng] as number, r[IDX.lat] as number]);
        el.style.transform = `translate(${Math.round(p.x - PREVIEW_W / 2)}px, ${Math.round(p.y - PREVIEW_H - 14)}px)`;
      }
    };
    place();
    map.on('move', place);
    return () => {
      map.off('move', place);
    };
  }, [map, picked]);

  if (!map || !picked.length) return null;
  const videoIds = new Set(
    picked
      .filter((r) => autoplay && r[IDX.streamType] === 'mp4' && r[IDX.streamUrl])
      .slice(0, PREVIEW_MAX_VIDEO)
      .map((r) => String(r[IDX.id])),
  );
  return createPortal(
    <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden" data-testid="cctv-previews" aria-label="Camera previews">
      {picked.map((r) => {
        const cam = rowToCamera(r);
        // Refresh bucket: advances once per operator interval (≥ 15 s) while the tab is visible.
        const every = Math.max(1, Math.round(refreshSeconds(providers?.get(cam.providerId), STILL_REFRESH_MS / 1000) / (STILL_REFRESH_MS / 1000)));
        const bucket = autoplay ? Math.floor(tick / every) : 0;
        return (
          <PreviewTile
            key={cam.id}
            cam={cam}
            video={videoIds.has(cam.id)}
            bucket={bucket}
            health={health[cam.providerId]}
            tileRef={(el) => {
              if (el) refs.current.set(cam.id, el);
              else refs.current.delete(cam.id);
            }}
          />
        );
      })}
    </div>,
    map.getContainer(),
  );
}
