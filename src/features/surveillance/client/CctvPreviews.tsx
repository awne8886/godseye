'use client';
/**
 * On-map camera preview tiles (OSIRIS parity, bounded): zoom ≥ 13, at most 8 tiles nearest the
 * view centre, at most 4 of them video (TfL latest-clip mp4 only; HLS tiles show the still to spare
 * operator bandwidth), 176×99 px, positioned by direct DOM transforms on every `move` (no React
 * re-render per frame). Stills refresh no faster than the operator's poll interval (≥ 15 s), only
 * while the tab is visible and only when previews autoplay is on (Settings). Frames come from the
 * same-origin stills proxy. Owner: layers-surveillance.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Cell } from '@/lib/columnar';
import { useMapInstanceStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { PREVIEW_H, PREVIEW_MAX_TILES, PREVIEW_MAX_VIDEO, PREVIEW_MIN_ZOOM, PREVIEW_W, stillPath } from '../shared';
import { IDX, rowToCamera } from './rows';
import { selectCamera } from './store';
import { refreshSeconds, useProviders } from './useProviders';

const STILL_REFRESH_MS = 15_000;

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

export default function CctvPreviews({ rows }: { rows: Cell[][] }) {
  // Previews only project points and read bounds, which work before the first `idle` (useMapInstance waits for it).
  const map = useMapInstanceStore((s) => s.map);
  const autoplay = useUiStore((s) => s.settings.previewAutoplay);
  const [picked, setPicked] = useState<Cell[][]>([]);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const tick = useVisibleClock(STILL_REFRESH_MS, autoplay);
  const providers = useProviders();

  // Choose tiles when the view settles.
  useEffect(() => {
    if (!map) return;
    const choose = () => {
      if (map.getZoom() < PREVIEW_MIN_ZOOM) return setPicked([]);
      const b = map.getBounds();
      const c = map.getCenter();
      const inView = rows.filter((r) => r[IDX.streamType] !== 'link' && r[IDX.stillUrl] && b.contains([r[IDX.lng] as number, r[IDX.lat] as number]));
      inView.sort((a, z) => ((a[IDX.lat] as number) - c.lat) ** 2 + ((a[IDX.lng] as number) - c.lng) ** 2 - (((z[IDX.lat] as number) - c.lat) ** 2 + ((z[IDX.lng] as number) - c.lng) ** 2));
      setPicked(inView.slice(0, PREVIEW_MAX_TILES));
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
        const video = videoIds.has(cam.id);
        // Refresh bucket: advances once per operator interval (≥ 15 s) while the tab is visible.
        const every = Math.max(1, Math.round(refreshSeconds(providers?.get(cam.providerId), STILL_REFRESH_MS / 1000) / (STILL_REFRESH_MS / 1000)));
        const bucket = autoplay ? Math.floor(tick / every) : 0;
        return (
          <button
            key={cam.id}
            ref={(el) => {
              if (el) refs.current.set(cam.id, el);
              else refs.current.delete(cam.id);
            }}
            type="button"
            onClick={() => selectCamera(cam)}
            className="pointer-events-auto absolute left-0 top-0 overflow-hidden rounded-md border border-[var(--map-cctv)] bg-[var(--bg-void)] shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
            style={{ width: PREVIEW_W, height: PREVIEW_H }}
            aria-label={`Open camera ${cam.name}`}
          >
            {video ? (
              // TfL sends no CORS headers: a plain <video src> (no crossOrigin) plays it.
              <video src={cam.streamUrl!} muted autoPlay loop playsInline className="h-full w-full object-cover" poster={stillPath(cam)} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- same-origin proxied frame, refreshed in place
              <img src={`${stillPath(cam)}&r=${bucket}`} alt={`Latest still from ${cam.name}`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
            )}
            <span className="absolute inset-x-0 bottom-0 truncate bg-[var(--bg-void)]/80 px-1 text-left font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-primary)]">{cam.name}</span>
          </button>
        );
      })}
    </div>,
    map.getContainer(),
  );
}
