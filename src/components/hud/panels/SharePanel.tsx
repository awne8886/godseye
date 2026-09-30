'use client';
/**
 * Share: a restorable URL for the current view (camera, layers, theme, projection, pinned panels,
 * route, flight, dossier) from buildShareUrl(); copy and native share. Owner: design-system-hud.
 */
import { Check, Copy, Share2 } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PanelProps } from '@/lib/feature-module';
import { useUiStore } from '@/lib/store';
import { buildShareUrl } from '@/lib/url-state';
import { usePanelChip } from '../PanelChrome';

const noop = () => () => {};

export function useShareUrl(): string {
  const s = useUiStore(
    useShallow((st) => ({
      camera: st.camera,
      layers: st.activeLayers,
      theme: st.theme,
      pinned: st.pinnedPanels,
      route: st.plannedRoute,
      flight: st.flightIdent,
      dossier: st.dossierTarget,
      projection: st.projection,
    })),
  );
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => 'http://localhost');
  return useMemo(
    () =>
      buildShareUrl(origin, {
        camera: s.camera,
        layers: [...s.layers],
        theme: s.theme === 'HORUS' ? null : s.theme,
        pinned: [...s.pinned],
        route: s.route,
        flight: s.flight,
        dossier: s.dossier,
        projection: s.projection,
      }),
    [origin, s],
  );
}

export default function SharePanel(_: PanelProps) {
  const url = useShareUrl();
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const canShare = useSyncExternalStore(noop, () => typeof navigator.share === 'function', () => false);
  usePanelChip(copied === 'ok' ? 'COPIED' : 'READY', copied === 'ok' ? 'live' : 'idle');

  useEffect(() => {
    if (copied === 'idle') return;
    const t = setTimeout(() => setCopied('idle'), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <div className="space-y-3">
      <p className="font-sans text-[13px] text-[var(--text-secondary)]">This link restores the camera, layers, theme, projection and open context for anyone who opens it.</p>
      <label className="block">
        <span className="hud-micro mb-1 block text-[var(--text-muted)]">LINK</span>
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="hud-control w-full border border-[var(--border-primary)] bg-[rgba(0,0,0,0.3)] px-2 py-2 font-mono text-[11px] text-[var(--text-primary)]"
          aria-label="Share link"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="hud-micro hud-control flex min-h-[36px] flex-1 items-center justify-center gap-2 border border-[var(--border-active)] bg-[rgba(var(--gold-rgb),0.1)] text-[var(--gold-light)]"
        >
          {copied === 'ok' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied === 'ok' ? 'COPIED' : copied === 'failed' ? 'COPY BLOCKED — SELECT THE LINK' : 'COPY LINK'}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() => void navigator.share({ url, title: 'GODSEYE view' }).catch(() => undefined)}
            className="hud-micro hud-control flex min-h-[36px] items-center gap-2 border border-[var(--border-primary)] px-3 text-[var(--text-primary)]"
          >
            <Share2 size={14} aria-hidden /> SHARE
          </button>
        )}
      </div>
      <p role="status" className="sr-only">
        {copied === 'ok' ? 'Link copied' : ''}
      </p>
    </div>
  );
}
