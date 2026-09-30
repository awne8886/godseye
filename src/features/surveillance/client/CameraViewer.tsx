'use client';
/**
 * CAMERA VIEWER panel. Resolves the open camera (/api/cctv/resolve) and plays exactly what the
 * operator publishes:
 *  - jpg  → same-origin still, refreshed no faster than the operator's interval (≥ 10 s), paused
 *           while the tab is hidden; the badge shows the frame's own time (X-Frame-Observed-At) or
 *           "time not published by operator" — never a fake LIVE.
 *  - hls  → hls.js (lazy) or native HLS, 20 s start timeout, then falls back to the still.
 *  - mp4  → plain <video src> (TfL sends no CORS headers, so no crossOrigin), badged LATEST CLIP.
 *  - link → link-out card (link-out-only providers and regions).
 * The header carries operator, licence, attribution, terms, and "Report / remove this camera".
 * Owner: layers-surveillance.
 */
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePanelChip, type ChipTone } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { formatAge } from '@/lib/freshness';
import type { Camera, CameraResolveResponse, StreamStatusResponse } from '@/lib/types';
import { cameraTag, MIN_STILL_REFRESH_S, STREAM_LABEL } from '../shared';
import { isoShort, OutLink, ProviderBlock, ReportLink, Row } from './parts';
import { useSurveillanceUi } from './store';
import { refreshSeconds } from './useProviders';

type View = 'loading' | 'playing' | 'error';

const btn =
  'inline-flex min-h-[32px] items-center gap-1.5 rounded border border-[var(--border-secondary)] px-2.5 font-mono text-[11px] uppercase tracking-[.08em] text-[var(--text-primary)] hover:border-[var(--gold-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]';

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Still player: fetches the frame as a blob so it can read the operator's frame time header. */
function StillPlayer({ url, everyS, onState, onFrameTime, name }: { url: string; everyS: number; onState: (v: View) => void; onFrameTime: (t: string | null) => void; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const last = useRef<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${url}${url.includes('?') ? '&' : '?'}r=${n}`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`HTTP ${res.status}`);
        onFrameTime(res.headers.get('x-frame-observed-at'));
        const obj = URL.createObjectURL(await res.blob());
        if (last.current) URL.revokeObjectURL(last.current);
        last.current = obj;
        setSrc(obj);
        onState('playing');
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') onState('error');
      });
    return () => ac.abort();
  }, [url, n, onState, onFrameTime]);
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) setN((x) => x + 1);
    }, everyS * 1000);
    return () => clearInterval(t);
  }, [everyS]);
  useEffect(() => () => {
    if (last.current) URL.revokeObjectURL(last.current);
  }, []);
  // eslint-disable-next-line @next/next/no-img-element -- blob URL of a same-origin proxied frame
  return src ? <img src={src} alt={`Latest still from ${name}`} className="h-full w-full object-contain" /> : null;
}

function HlsPlayer({ url, onState }: { url: string; onState: (v: View) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let destroyed = false;
    let hls: { destroy: () => void } | null = null;
    const timeout = setTimeout(() => !destroyed && onState('error'), 20_000);
    const playing = () => {
      clearTimeout(timeout);
      onState('playing');
    };
    video.addEventListener('playing', playing);
    (async () => {
      const { default: Hls } = await import('hls.js');
      if (destroyed) return;
      if (Hls.isSupported()) {
        const h = new Hls({ enableWorker: false, lowLatencyMode: false, capLevelToPlayerSize: true, maxBufferLength: 10 });
        hls = h;
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            clearTimeout(timeout);
            onState('error');
          }
        });
        h.loadSource(url);
        h.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      } else {
        onState('error');
      }
      video.play().catch(() => undefined);
    })().catch(() => onState('error'));
    return () => {
      destroyed = true;
      clearTimeout(timeout);
      video.removeEventListener('playing', playing);
      hls?.destroy();
    };
  }, [url, onState]);
  return <video ref={ref} muted playsInline controls className="h-full w-full object-contain" aria-label="Live camera video" />;
}

function statusText(s: StreamStatusResponse | undefined, pending: boolean): { text: string; tone: ChipTone } {
  if (pending) return { text: 'PROBING…', tone: 'busy' };
  if (!s) return { text: 'NOT CHECKED', tone: 'idle' };
  return s.status === 'online' ? { text: 'SOURCE ONLINE', tone: 'live' } : s.status === 'offline' ? { text: 'CAMERA OFFLINE', tone: 'error' } : { text: 'STATUS UNKNOWN', tone: 'warn' };
}

export function CameraViewerBody({ camera }: { camera: Camera }) {
  const [view, setView] = useState<View>('loading');
  const [frameAt, setFrameAt] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const now = useNow(5_000);

  const resolved = useQuery({
    queryKey: ['cctv-resolve', camera.id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/cctv/resolve?id=${encodeURIComponent(camera.id)}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as CameraResolveResponse;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const status = useQuery({
    queryKey: ['cctv-status', camera.id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/cctv/stream-status?id=${encodeURIComponent(camera.id)}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as StreamStatusResponse;
    },
    staleTime: 60_000,
    retry: 0,
  });

  const onState = useCallback((v: View) => setView(v), []);
  const retry = () => {
    setView('loading');
    setFrameAt(null);
    setFallback(false);
    setAttempt((a) => a + 1);
  };
  const provider = resolved.data?.provider ?? null;
  const playable = resolved.data?.playable ?? null;
  const cam = resolved.data?.camera ?? camera;
  const everyS = Math.max(MIN_STILL_REFRESH_S, refreshSeconds(provider));
  const stillUrl = playable?.type === 'jpg' ? playable.url : cam.stillUrl && provider?.proxy_allowed ? `/api/cctv/${cam.providerId === 'txdot' ? 'texas/snapshot' : 'proxy'}?id=${encodeURIComponent(cam.id)}` : null;
  const mode = !playable ? 'link' : fallback && stillUrl ? 'jpg' : playable.type;

  // HLS start timeout or fatal error → fall back to the still when one exists.
  const onHlsState = useCallback(
    (v: View) => {
      if (v === 'error' && stillUrl) {
        setFallback(true);
        setView('loading');
      } else setView(v);
    },
    [stillUrl],
  );

  const shownAt = frameAt ?? cam.observedAt;
  const chip =
    resolved.isPending || (view === 'loading' && mode !== 'link')
      ? { text: 'DECRYPTING FEED…', tone: 'busy' as ChipTone }
      : resolved.isError
        ? { text: 'FEED UNAVAILABLE', tone: 'error' as ChipTone }
        : mode === 'link'
          ? { text: 'HOSTED OFF-PLATFORM', tone: 'idle' as ChipTone }
          : view === 'error'
            ? { text: 'FEED UNAVAILABLE', tone: 'error' as ChipTone }
            : mode === 'hls'
              ? { text: 'LIVE VIDEO', tone: 'live' as ChipTone }
              : mode === 'mp4'
                ? { text: 'LATEST CLIP', tone: 'idle' as ChipTone }
                : { text: shownAt ? `SNAPSHOT · ${formatAge(Math.max(0, now - Date.parse(shownAt)))}` : 'SNAPSHOT', tone: 'idle' as ChipTone };
  usePanelChip(chip.text, chip.tone);
  const st = statusText(status.data, status.isFetching);

  return (
    <div className="flex flex-col gap-3" data-testid="camera-viewer">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[.08em] tabular-nums text-[var(--gold-primary)]">{cameraTag(cam.lat, cam.lng)}</span>
          <span className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-secondary)]">{STREAM_LABEL[mode]}</span>
        </div>
        <p className="font-sans text-[13px] text-[var(--text-heading)]" data-testid="camera-name">
          {cam.name}
        </p>
      </header>

      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)]" aria-live="polite">
        {mode === 'jpg' && stillUrl && <StillPlayer key={`${stillUrl}:${attempt}`} url={stillUrl} everyS={everyS} onState={onState} onFrameTime={setFrameAt} name={cam.name} />}
        {mode === 'hls' && playable && <HlsPlayer key={`${playable.url}:${attempt}`} url={playable.url} onState={onHlsState} />}
        {mode === 'mp4' && playable && (
          // TfL JamCam clips: no CORS headers, so no crossOrigin attribute.
          <video key={`${playable.url}:${attempt}`} src={playable.url} muted autoPlay loop playsInline controls onPlaying={() => onState('playing')} onError={() => onState('error')} className="h-full w-full object-contain" aria-label="Latest camera clip" />
        )}
        {mode === 'link' && !resolved.isPending && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[.08em] text-[var(--text-secondary)]">This operator&apos;s feed opens on its own site</p>
            <OutLink href={cam.externalUrl ?? provider?.terms_url ?? null}>Open at operator</OutLink>
          </div>
        )}
        {(resolved.isPending || (view === 'loading' && mode !== 'link')) && (
          <p className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-[.08em] text-[var(--cyan-primary)]">{resolved.isPending ? 'ACQUIRING UPLINK' : 'DECRYPTING FEED…'}</p>
        )}
        {(view === 'error' || resolved.isError) && mode !== 'link' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--bg-void)]/90">
            <p className="font-mono text-[11px] uppercase tracking-[.08em] text-[var(--alert-red)]">FEED UNAVAILABLE</p>
            <button type="button" className={btn} onClick={() => (resolved.isError ? void resolved.refetch() : retry())}>
              <RefreshCw size={12} aria-hidden /> Retry
            </button>
          </div>
        )}
      </div>

      <dl>
        <Row label="Image time" testId="viewer-observed">
          {mode === 'hls' ? 'Live stream (no frame time)' : shownAt ? `${isoShort(shownAt)}` : 'Time not published by operator'}
        </Row>
        {mode === 'jpg' && <Row label="Refresh">{`every ${everyS} s (operator minimum)`}</Row>}
        <Row label="Stream check">
          <span className="inline-flex items-center gap-2">
            <span data-testid="viewer-status">{st.text}</span>
            <button type="button" className={btn} onClick={() => void status.refetch()} aria-label="Re-check stream status">
              <Activity size={12} aria-hidden />
            </button>
          </span>
        </Row>
        {status.data && <Row label="Checked">{isoShort(status.data.checkedAt)}</Row>}
      </dl>

      <ProviderBlock provider={provider} />
      <div className="flex flex-wrap items-center gap-3">
        {cam.externalUrl && mode !== 'link' && <OutLink href={cam.externalUrl}>Operator page</OutLink>}
        <OutLink href={`https://www.openstreetmap.org/?mlat=${cam.lat}&mlon=${cam.lng}#map=17/${cam.lat}/${cam.lng}`}>Map target</OutLink>
        <a href="/cameras-notice" className="font-mono text-[11px] uppercase tracking-[.08em] text-[var(--text-secondary)] underline-offset-2 hover:underline">
          Cameras notice
        </a>
      </div>
      <ReportLink camera={cam} provider={provider} />
      <p className="font-sans text-[12px] text-[var(--text-secondary)]">Frames are relayed live from the operator and never recorded, archived or analysed (no face, plate or object recognition).</p>
    </div>
  );
}

function Standby() {
  usePanelChip('STANDBY', 'idle');
  return <p className="font-sans text-[13px] text-[var(--text-secondary)]">Select a camera on the map (CCTV layer) and choose Open viewer.</p>;
}

export default function CameraViewerPanel(_: PanelProps) {
  const camera = useSurveillanceUi((s) => s.camera);
  return camera ? <CameraViewerBody key={camera.id} camera={camera} /> : <Standby />;
}
