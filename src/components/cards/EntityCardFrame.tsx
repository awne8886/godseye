'use client';
/**
 * Entity-card frame (§0.3, §7): kind + id header, freshness badge (entityFreshness over the layer's
 * observation cadence, never better than the feed), source line with attribution, observed-at time
 * kept separate from fetched-at, SOURCE OFFLINE with last-good time, and tabs Overview / Sources.
 * The body comes from the feature module registered for the entity kind. Owner: design-system-hud.
 */
import { X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { FRESHNESS_COLOR_TOKEN } from '@/lib/freshness';
import { getLayer } from '@/lib/layer-registry';
import type { LayerStatus, Selection } from '@/lib/layer-host';
import { statusAttribution } from '@/components/hud/LayerRows';
import { cardBadge } from '@/components/hud/status-logic';

const iso = (s: string | null) => (s ? `${s.slice(0, 10)} ${s.slice(11, 19)}Z` : '—');

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function FreshnessBadge({ selection, feed, now }: { selection: Selection; feed: LayerStatus | undefined; now?: number }) {
  const b = cardBadge({ layer: selection.layer, observedAt: selection.observedAt, feed, now });
  const color = `var(${FRESHNESS_COLOR_TOKEN[b.state]})`;
  return (
    <span className="instrument-chip inline-flex items-center gap-1" style={{ color }} data-state={b.state}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {b.label}
    </span>
  );
}

export default function EntityCardFrame({
  selection,
  feed,
  onClose,
  children,
}: {
  selection: Selection;
  feed: LayerStatus | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<'overview' | 'sources'>('overview');
  const now = useNow(15_000);
  const titleId = useId();
  const layer = selection.layer ? getLayer(selection.layer) : undefined;
  const badge = cardBadge({ layer: selection.layer, observedAt: selection.observedAt, feed, now });
  const attribution = feed ? statusAttribution(feed) : [];
  const offline = feed?.state === 'offline';
  const kindLabel = selection.kind.replace(/_/g, ' ');

  return (
    <section aria-labelledby={titleId} className="glass-panel instrument-grid instrument-corners relative flex max-h-full min-h-0 flex-col">
      <header className="relative flex items-center gap-2 px-4 pb-2 pt-3">
        <span className="instrument-accent" aria-hidden />
        <h2 id={titleId} className="hud-title min-w-0 flex-1 truncate">
          {kindLabel} <span className="text-[var(--text-secondary)]">· {selection.id}</span>
        </h2>
        <FreshnessBadge selection={selection} feed={feed} now={now} />
        <button type="button" onClick={onClose} aria-label="Close card" className="hud-control grid h-7 w-7 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)]">
          <X size={15} />
        </button>
      </header>
      <div className="instrument-rule mx-4" aria-hidden />
      <dl className="relative grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-4 pt-2 text-[12px]">
        <dt className="hud-micro text-[var(--text-muted)]">SOURCE</dt>
        <dd className="truncate text-[var(--text-primary)]">{selection.source}</dd>
        <dt className="hud-micro text-[var(--text-muted)]">OBSERVED</dt>
        <dd className="font-mono text-[var(--text-primary)] tabular-nums">
          {layer?.kind === 'reference' ? 'REFERENCE DATA' : iso(selection.observedAt)}
          {badge.age && <span className="ml-2 text-[var(--text-secondary)]">{badge.age}</span>}
        </dd>
        {offline && (
          <>
            <dt className="hud-micro text-[var(--alert-red)]">FEED</dt>
            <dd className="hud-micro text-[var(--alert-red)]">SOURCE OFFLINE · LAST GOOD {iso(feed?.lastGoodAt ?? null)}</dd>
          </>
        )}
      </dl>
      <div role="tablist" aria-label="Card sections" className="relative mt-2 flex gap-1 px-4">
        {(['overview', 'sources'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`hud-micro hud-control min-h-[28px] border px-2 ${tab === t ? 'border-[var(--border-active)] text-[var(--gold-light)]' : 'border-transparent text-[var(--text-secondary)]'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="hud-scroll relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === 'overview' ? (
          children
        ) : (
          <div className="space-y-2 text-[12px] text-[var(--text-secondary)]">
            <p>
              <span className="hud-micro text-[var(--text-muted)]">LAYER </span>
              {layer?.label ?? '—'} {layer?.kind === 'reference' && <span className="instrument-chip ml-1">REFERENCE</span>}
            </p>
            <p>
              <span className="hud-micro text-[var(--text-muted)]">PROVIDER </span>
              {selection.source}
            </p>
            {feed?.fetchedAt && (
              <p>
                <span className="hud-micro text-[var(--text-muted)]">FETCHED </span>
                <span className="font-mono">{iso(feed.fetchedAt)}</span>
              </p>
            )}
            {feed?.providers &&
              Object.entries(feed.providers).map(([name, p]) => (
                <p key={name} className="font-mono text-[11px]">
                  {name}: {p.ok ? 'OK' : 'FAILED'} · {p.count} · {p.ms} ms
                </p>
              ))}
            {attribution.map((a) =>
              a.url && /^https?:\/\//.test(a.url) ? (
                <a key={a.text} href={a.url} target="_blank" rel="noopener noreferrer" className="block underline decoration-[var(--border-active)] underline-offset-2 hover:text-[var(--gold-light)]">
                  {a.text}
                  {a.licence ? ` · ${a.licence}` : ''}
                </a>
              ) : (
                <p key={a.text}>
                  {a.text}
                  {a.licence ? ` · ${a.licence}` : ''}
                </p>
              ),
            )}
          </div>
        )}
      </div>
    </section>
  );
}
