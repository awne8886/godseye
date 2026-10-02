'use client';
/**
 * Entity-card frame (§0.3, §7): kind + display-name header, freshness badge (entityFreshness over the layer's
 * observation cadence, never better than the feed), source line with attribution, observed-at time
 * kept separate from fetched-at, SOURCE OFFLINE with last-good time, and tabs Overview / Sources.
 * The body comes from the feature module registered for the entity kind. The badge is computed
 * here only, once; a body that has the feed's own state or a newer observation reports it through
 * useCardFreshness (card-freshness.tsx) and renders this same badge (r8: header and body
 * disagreed). Owner: design-system-hud.
 */
import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { FRESHNESS_COLOR_TOKEN } from '@/lib/freshness';
import { getLayer } from '@/lib/layer-registry';
import type { LayerStatus, Selection } from '@/lib/layer-host';
import { statusAttribution } from '@/components/hud/LayerRows';
import { cardBadge, type CardBadge } from '@/components/hud/status-logic';
import { CardFreshnessContext, applyReport, sameReport, type CardFreshnessReport } from './card-freshness';
import { entityDisplayName } from './display-name';
import { sourceDisplayName } from './source-name';

const iso = (s: string | null) => (s ? `${s.slice(0, 10)} ${s.slice(11, 19)}Z` : '—');

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** The frame's badge chip (`badge` from cardBadge, or computed here from the selection and feed). */
export function FreshnessBadge({ selection, feed, now, badge }: { selection: Selection; feed: LayerStatus | undefined; now?: number; badge?: CardBadge }) {
  const b = badge ?? cardBadge({ layer: selection.layer, observedAt: selection.observedAt, feed, now });
  const color = `var(${FRESHNESS_COLOR_TOKEN[b.state]})`;
  return (
    <span className="instrument-chip inline-flex items-center gap-1" style={{ color }} data-state={b.state} data-testid="card-badge">
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
  // 1 s: the badge (header and body) and the "Ns ago" age read the same clock as the body's own.
  const now = useNow(1000);
  const titleId = useId();
  const layer = selection.layer ? getLayer(selection.layer) : undefined;
  const [reported, setReported] = useState<CardFreshnessReport | null>(null);
  const report = useCallback((r: CardFreshnessReport) => setReported((prev) => (sameReport(prev, r) ? prev : r)), []);
  const inputs = applyReport({ observedAt: selection.observedAt, feed }, reported);
  const badge = cardBadge({ layer: selection.layer, ...inputs, now });
  // Only bodies that report (useCardFreshness) read this; they re-render on the 1 s clock anyway.
  const freshness = { badge, report };
  const sourceName = sourceDisplayName(selection.source, selection.layer ?? undefined);
  const attribution = feed ? statusAttribution(feed) : [];
  const offline = feed?.state === 'offline';
  const kindLabel = selection.kind.replace(/_/g, ' ');
  const name = entityDisplayName(selection);

  return (
    <section aria-labelledby={titleId} className="glass-panel instrument-grid instrument-corners relative flex max-h-full min-h-0 flex-col">
      <header className="relative flex items-center gap-2 px-4 pb-2 pt-3">
        <span className="instrument-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="hud-title truncate">
            {kindLabel}
          </h2>
          {/* The record's display name (never its internal key, which is under SOURCES), wrapping
              to two lines rather than cutting a long place name mid-word (round 5 visual-qa m4). */}
          {name && (
            <p className="hud-micro line-clamp-2 break-words text-[var(--text-secondary)] normal-case tabular-nums" title={name} data-testid="card-name">
              {name}
            </p>
          )}
        </div>
        <FreshnessBadge selection={selection} feed={feed} badge={badge} />
        <button type="button" onClick={onClose} aria-label="Close card" className="hud-control grid h-7 w-7 shrink-0 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)] phone:h-11 phone:w-11">
          <X size={15} />
        </button>
      </header>
      <div className="instrument-rule mx-4" aria-hidden />
      <dl className="relative grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-4 pt-2 text-[12px]">
        <dt className="hud-micro text-[var(--text-muted)]">SOURCE</dt>
        <dd className="truncate text-[var(--text-primary)]" title={sourceName} data-testid="card-source">
          {sourceName}
        </dd>
        <dt className="hud-micro text-[var(--text-muted)]">OBSERVED</dt>
        <dd className="font-mono text-[var(--text-primary)] tabular-nums">
          {layer?.kind === 'reference' ? 'REFERENCE DATA' : iso(inputs.observedAt)}
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
            className={`hud-micro hud-control min-h-[28px] border px-2 phone:min-h-[44px] ${tab === t ?'border-[var(--border-active)] text-[var(--gold-light)]' : 'border-transparent text-[var(--text-secondary)]'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {/* The body stays mounted (hidden) on the Sources tab, so its queries and its freshness
          report keep running and the header badge does not change with the tab. */}
      <div role="tabpanel" hidden={tab !== 'overview'} className="hud-scroll relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <CardFreshnessContext value={freshness}>{children}</CardFreshnessContext>
      </div>
      {tab === 'sources' && (
        <div role="tabpanel" className="hud-scroll relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="space-y-2 text-[12px] text-[var(--text-secondary)]">
            <p className="break-all">
              <span className="hud-micro text-[var(--text-muted)]">ID </span>
              <span className="font-mono" data-testid="card-id">
                {selection.id}
              </span>
            </p>
            <p>
              <span className="hud-micro text-[var(--text-muted)]">LAYER </span>
              {layer?.label ?? '—'} {layer?.kind === 'reference' && <span className="instrument-chip ml-1">REFERENCE</span>}
            </p>
            <p>
              <span className="hud-micro text-[var(--text-muted)]">PROVIDER </span>
              {sourceName}
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
                  {sourceDisplayName(name)}: {p.skipped ? `NOT ENABLED (${p.skipped})` : `${p.ok ? 'OK' : 'FAILED'} · ${p.count} · ${p.ms} ms`}
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
        </div>
      )}
    </section>
  );
}
