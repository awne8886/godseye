'use client';
/**
 * LIVE NEWS panel: the curated official channels with their checked live status; embeddable
 * channels play in a youtube-nocookie `live_stream` iframe (FRAME_HOSTS), the others open on
 * YouTube. Autoplay (muted) follows Settings → previews autoplay. Owner: layers-surveillance.
 */
import { Radio } from 'lucide-react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { useUiStore } from '@/lib/store';
import type { NewsChannel } from '@/lib/types';
import { liveLabel } from './cards';
import { OutLink } from './parts';
import { useSurveillanceUi } from './store';
import { useLiveNewsQuery } from './useLiveNewsQuery';

export function embedSrc(c: NewsChannel, autoplay: boolean): string | null {
  if (!c.embedAllowed || !c.embedUrl || !c.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/')) return null;
  const u = new URL(c.embedUrl);
  u.searchParams.set('autoplay', autoplay ? '1' : '0');
  u.searchParams.set('mute', '1');
  u.searchParams.set('playsinline', '1');
  u.searchParams.set('rel', '0');
  return u.toString();
}

export default function LiveNewsPanel(_: PanelProps) {
  const q = useLiveNewsQuery(true);
  const channel = useSurveillanceUi((s) => s.channel);
  const setChannel = useSurveillanceUi((s) => s.setChannel);
  const autoplay = useUiStore((s) => s.settings.previewAutoplay);
  const items = q.data?.ok ? q.data.body.items : [];
  const liveCount = items.filter((c) => c.live === true).length;
  usePanelChip(q.isPending ? 'LOADING' : q.data?.ok ? `${liveCount} LIVE · ${items.length} CHANNELS` : 'SOURCE OFFLINE', q.data?.ok ? 'live' : q.isPending ? 'busy' : 'error');
  const current = channel ?? items.find((c) => c.embedAllowed && c.live === true) ?? null;
  const src = current ? embedSrc(current, autoplay) : null;

  return (
    <div className="flex flex-col gap-3" data-testid="live-news-panel">
      {current && src ? (
        <figure className="flex flex-col gap-1">
          <div className="aspect-video w-full overflow-hidden rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)]">
            <iframe
              key={current.id}
              src={src}
              title={`${current.name} live stream`}
              className="h-full w-full"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              allowFullScreen
            />
          </div>
          <figcaption className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-secondary)]">
            {current.name} · {liveLabel(current.live)} · official channel
          </figcaption>
        </figure>
      ) : (
        <p className="font-sans text-[12px] text-[var(--text-secondary)]">Pick a channel. Channels whose broadcaster does not allow embedding open on YouTube.</p>
      )}
      <ul className="flex flex-col divide-y divide-white/5" aria-label="Live news channels">
        {items.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
            <div className="min-w-0">
              <p className="truncate font-mono text-[11px] uppercase tracking-[.08em] text-[var(--text-primary)]">{c.name}</p>
              <p className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-muted)]">
                {[c.city, c.country].filter(Boolean).join(', ')} · {c.live === true ? 'LIVE' : c.live === false ? 'NOT LIVE' : 'UNKNOWN'}
              </p>
            </div>
            {c.embedAllowed ? (
              <button
                type="button"
                onClick={() => setChannel(c)}
                aria-pressed={current?.id === c.id}
                className="inline-flex min-h-[32px] items-center gap-1 rounded border border-[var(--border-secondary)] px-2 font-mono text-[11px] uppercase tracking-[.08em] text-[var(--gold-primary)] hover:border-[var(--gold-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
              >
                <Radio size={12} aria-hidden /> Watch
              </button>
            ) : (
              <OutLink href={c.externalUrl}>YouTube</OutLink>
            )}
          </li>
        ))}
      </ul>
      {q.data && !q.data.ok && <p className="font-mono text-[11px] uppercase tracking-[.08em] text-[var(--alert-red)]">SOURCE OFFLINE</p>}
    </div>
  );
}
