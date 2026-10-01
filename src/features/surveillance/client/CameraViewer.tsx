'use client';
/**
 * CAMERA VIEWER panel. Resolves the open camera (/api/cctv/resolve) and plays exactly what the
 * operator publishes:
 *  - jpg  → same-origin still, refreshed no faster than the operator's interval (≥ 10 s), paused
 *           while the tab is hidden. Each frame shows its OWN time from the operator
 *           (X-Frame-Observed-At: published timestamp or the file's Last-Modified) and its age,
 *           separately from when the proxy fetched it (X-Frame-Fetched-At). With no operator time
 *           the frame is UNTIMED — never LIVE, never "0 s" — and the catalogue's older list time is
 *           not borrowed for it. A still is never called LIVE.
 *           A refused frame (the operator sent a web page, 404, no snapshot) is CAMERA OFFLINE with
 *           the reason and RETRY; a transient failure is FEED UNAVAILABLE + RETRY. No broken image.
 *  - hls  → hls.js (lazy) or native HLS, 20 s start timeout, then falls back to the still.
 *  - mp4  → plain <video src> (TfL sends no CORS headers, so no crossOrigin), badged LATEST CLIP.
 *  - link → link-out card (link-out-only providers and regions).
 * The header carries the camera tag, name and the provider's registry row (operator, licence,
 * attribution, terms); "Report / remove this camera" sits under the frame.
 * Owner: layers-surveillance.
 */
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePanelChip, type ChipTone } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import type { Camera, CameraResolveResponse, StreamStatusResponse } from '@/lib/types';
import { cameraTag, frameAge, frameHealthLabel, MIN_STILL_REFRESH_S, readFrameFailure, STREAM_LABEL, type FrameFailure } from '../shared';
import { isoShort, OutLink, ProviderBlock, ReportLink, Row } from './parts';
import { useSurveillanceUi } from './store';
import { refreshSeconds, useFrameHealth } from './useProviders';

type View = 'loading' | 'playing' | 'error';

/** What the proxy said about the frame on screen. */
export interface FrameInfo {
  /** Operator frame time (published timestamp or Last-Modified); null = not published. */
  observedAt: string | null;
  /** When the proxy fetched it from the operator. */
  fetchedAt: string | null;
  timeSource: 'operator' | 'last-modified' | 'none';
}

const NETWORK_FAILURE: FrameFailure = { state: 'unavailable', detail: 'network', message: 'The frame could not be loaded. Try again.' };

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

const TIME_SOURCES = new Set(['operator', 'last-modified', 'none']);
const isoOrNull = (v: string | null) => (v && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);

/** Frame metadata from the proxy's headers (unknown or malformed values read as "not published"). */
export function frameInfoFrom(h: Pick<Headers, 'get'>): FrameInfo {
  const observedAt = isoOrNull(h.get('x-frame-observed-at'));
  const src = h.get('x-frame-time-source') ?? '';
  const timeSource = observedAt === null ? 'none' : TIME_SOURCES.has(src) && src !== 'none' ? (src as FrameInfo['timeSource']) : 'last-modified';
  return { observedAt, fetchedAt: isoOrNull(h.get('x-frame-fetched-at')), timeSource };
}

/**
 * Panel chip for the still player. Never LIVE: a timed frame shows its age (orange once stale), an
 * untimed one says so; a refused frame is CAMERA OFFLINE, a transient failure FEED UNAVAILABLE.
 */
export function stillChip(view: View, failure: FrameFailure | null, frame: FrameInfo | null, cadenceS: number, now: number): { text: string; tone: ChipTone } {
  if (view === 'error') return failure?.state === 'offline' ? { text: 'CAMERA OFFLINE', tone: 'error' } : { text: 'FEED UNAVAILABLE', tone: 'error' };
  if (view === 'loading' || !frame) return { text: 'LOADING FRAME…', tone: 'busy' };
  const age = frameAge(frame.observedAt, cadenceS, now);
  return { text: `SNAPSHOT · ${age.label}`, tone: age.state === 'stale' ? 'warn' : 'idle' };
}

/** Still player: fetches the frame as a blob so it can read the frame's time headers and refusals. */
function StillPlayer({
  url,
  everyS,
  onState,
  onFrame,
  onFail,
  name,
}: {
  url: string;
  everyS: number;
  onState: (v: View) => void;
  onFrame: (f: FrameInfo) => void;
  onFail: (f: FrameFailure) => void;
  name: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const last = useRef<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    const drop = () => {
      if (last.current) URL.revokeObjectURL(last.current);
      last.current = null;
      setSrc(null);
    };
    fetch(`${url}${url.includes('?') ? '&' : '?'}r=${n}`, { signal: ac.signal })
      .then(async (res) => {
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.startsWith('image/')) {
          // The proxy refused the operator's answer (e.g. an HTML page): no image is drawn.
          const body = type.includes('json') ? await res.json().catch(() => null) : null;
          drop();
          onFail(readFrameFailure(res.status, body));
          onState('error');
          return;
        }
        const info = frameInfoFrom(res.headers);
        const obj = URL.createObjectURL(await res.blob());
        if (last.current) URL.revokeObjectURL(last.current);
        last.current = obj;
        setSrc(obj);
        onFrame(info);
        onState('playing');
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError') return;
        drop();
        onFail(NETWORK_FAILURE);
        onState('error');
      });
    return () => ac.abort();
  }, [url, n, onState, onFrame, onFail]);
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
  return src ? <img src={src} alt={`Latest still from ${name}`} className="h-full w-full object-contain" data-testid="viewer-frame" /> : null;
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

const REASON_LABEL: Record<string, string> = { not_an_image: 'NOT AN IMAGE', upstream_404: 'NO FRAME (404)', upstream_410: 'NO FRAME (410)', no_snapshot: 'NO SNAPSHOT', timeout: 'TIMEOUT' };

export function statusText(s: StreamStatusResponse | undefined, pending: boolean): { text: string; tone: ChipTone } {
  if (pending) return { text: 'PROBING…', tone: 'busy' };
  if (!s) return { text: 'NOT CHECKED', tone: 'idle' };
  if (s.status === 'online') return { text: 'SOURCE ONLINE', tone: 'live' };
  if (s.status === 'offline') return { text: s.reason && REASON_LABEL[s.reason] ? `CAMERA OFFLINE · ${REASON_LABEL[s.reason]}` : 'CAMERA OFFLINE', tone: 'error' };
  return { text: 'STATUS UNKNOWN', tone: 'warn' };
}

const TIME_SOURCE_LABEL: Record<FrameInfo['timeSource'], string> = { operator: 'Operator timestamp', 'last-modified': 'File Last-Modified', none: 'Not published' };

export function CameraViewerBody({ camera }: { camera: Camera }) {
  const [view, setView] = useState<View>('loading');
  const [frame, setFrame] = useState<FrameInfo | null>(null);
  const [failure, setFailure] = useState<FrameFailure | null>(null);
  const [fallback, setFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const now = useNow(5_000);
  const frames = useFrameHealth();

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
  const onFrame = useCallback((f: FrameInfo) => {
    setFrame(f);
    setFailure(null);
  }, []);
  const onFail = useCallback((f: FrameFailure) => {
    setFrame(null);
    setFailure(f);
  }, []);
  const retry = () => {
    setView('loading');
    setFrame(null);
    setFailure(null);
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

  const offline = view === 'error' && mode === 'jpg' && failure?.state === 'offline';
  const chip =
    resolved.isPending || (view === 'loading' && mode !== 'link')
      ? { text: 'LOADING FRAME…', tone: 'busy' as ChipTone }
      : resolved.isError
        ? { text: 'FEED UNAVAILABLE', tone: 'error' as ChipTone }
        : mode === 'link'
          ? { text: 'HOSTED OFF-PLATFORM', tone: 'idle' as ChipTone }
          : mode === 'jpg'
            ? stillChip(view, failure, frame, everyS, now)
            : view === 'error'
              ? { text: 'FEED UNAVAILABLE', tone: 'error' as ChipTone }
              : mode === 'hls'
                ? { text: 'LIVE VIDEO', tone: 'live' as ChipTone }
                : { text: 'LATEST CLIP', tone: 'idle' as ChipTone };
  usePanelChip(chip.text, chip.tone);
  const st = statusText(status.data, status.isFetching);
  const age = mode === 'jpg' && frame ? frameAge(frame.observedAt, everyS, now) : null;
  const opFrames = frames[cam.providerId];
  const opLabel = opFrames && (opFrames.state === 'unavailable' || opFrames.state === 'failing') ? frameHealthLabel(opFrames) : null;

  const frameTimeText =
    mode === 'hls'
      ? 'Live stream (no frame time)'
      : mode === 'jpg'
        ? frame
          ? frame.observedAt
            ? isoShort(frame.observedAt)
            : 'Not published by operator'
          : view === 'error'
            ? 'No frame'
            : 'Awaiting frame'
        : cam.observedAt
          ? isoShort(cam.observedAt)
          : 'Time not published by operator';

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
        {/* §5: the provider's registry row (operator · licence · attribution · terms) in the header. */}
        <ProviderBlock provider={provider} />
      </header>

      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)]" aria-live="polite">
        {mode === 'jpg' && stillUrl && <StillPlayer key={`${stillUrl}:${attempt}`} url={stillUrl} everyS={everyS} onState={onState} onFrame={onFrame} onFail={onFail} name={cam.name} />}
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
          <p className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-[.08em] text-[var(--cyan-primary)]">{resolved.isPending ? 'ACQUIRING UPLINK' : 'LOADING FRAME…'}</p>
        )}
        {(view === 'error' || resolved.isError) && mode !== 'link' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--bg-void)] p-4 text-center" data-testid="viewer-unavailable" data-state={offline ? 'offline' : 'unavailable'}>
            <p className="font-mono text-[11px] uppercase tracking-[.08em] text-[var(--alert-red)]">{offline ? 'CAMERA OFFLINE' : 'FEED UNAVAILABLE'}</p>
            {mode === 'jpg' && failure && !resolved.isError && <p className="max-w-[36ch] font-sans text-[12px] text-[var(--text-secondary)]">{failure.message}</p>}
            <button type="button" className={btn} onClick={() => (resolved.isError ? void resolved.refetch() : retry())}>
              <RefreshCw size={12} aria-hidden /> Retry
            </button>
          </div>
        )}
      </div>

      <dl>
        <Row label="Frame time" testId="viewer-observed">
          {frameTimeText}
        </Row>
        {mode === 'jpg' && frame && (
          <>
            <Row label="Time source" testId="viewer-time-source">{TIME_SOURCE_LABEL[frame.timeSource]}</Row>
            <Row label="Frame age" testId="viewer-age">{age && age.state !== 'unknown' ? age.label : 'Unknown'}</Row>
            {frame.fetchedAt && <Row label="Fetched" testId="viewer-fetched">{isoShort(frame.fetchedAt)}</Row>}
          </>
        )}
        {mode === 'jpg' && <Row label="Refresh">{`every ${everyS} s (operator minimum)`}</Row>}
        {opLabel && (
          <Row label="Operator frames" testId="viewer-operator-frames">
            <span className={opLabel.tone === 'error' ? 'text-[var(--alert-red)]' : 'text-[var(--alert-orange)]'}>{opLabel.text}</span>
          </Row>
        )}
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

      <div className="flex flex-wrap items-center gap-3">
        {cam.externalUrl && mode !== 'link' && <OutLink href={cam.externalUrl}>Operator page</OutLink>}
        <OutLink href={`https://www.openstreetmap.org/?mlat=${cam.lat}&mlon=${cam.lng}#map=17/${cam.lat}/${cam.lng}`}>Map target</OutLink>
        <a href="/cameras-notice" className="font-mono text-[11px] uppercase tracking-[.08em] text-[var(--text-secondary)] underline-offset-2 hover:underline">
          Cameras notice
        </a>
      </div>
      <ReportLink camera={cam} provider={provider} />
      <p className="font-sans text-[12px] text-[var(--text-secondary)]">Frames are relayed from the operator and never recorded, archived or analysed (no face, plate or object recognition).</p>
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
