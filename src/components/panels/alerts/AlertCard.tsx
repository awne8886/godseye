'use client';
/**
 * Card body for an `alert` pin (the HUD frame supplies source, observed-at and freshness). Shows the
 * claim as text with its channel stance, the pin's geoparse precision/method and the keyword-count
 * risk score with the matched keywords. Owner: panels-alerts-markets-dossier-graph.
 */
import type { CardProps } from '@/lib/feature-module';
import type { AlertItem } from '@/lib/types';
import { AlertRow } from './AlertsPanel';
import { useNow } from '../intel/client';

export function AlertCard({ selection }: CardProps) {
  const now = useNow(30_000);
  const it = selection.data as unknown as AlertItem;
  if (!it?.title) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="alert-card">
      <ul>
        <AlertRow it={it} now={now} />
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] tracking-[0.08em]">
        <dt className="uppercase text-[var(--text-muted)]">Pin</dt>
        <dd className="text-[var(--text-primary)]">{it.place ? `${it.place.name} · ${it.place.precision} (${it.place.method})` : '—'}</dd>
        <dt className="uppercase text-[var(--text-muted)]">Risk</dt>
        <dd className="text-[var(--text-primary)] tabular-nums">
          {it.risk.score}/10 · keyword count{it.risk.keywords.length ? ` (${it.risk.keywords.join(', ')})` : ''}
        </dd>
        <dt className="uppercase text-[var(--text-muted)]">Stance</dt>
        <dd className="text-[var(--text-primary)]">{it.lean}</dd>
      </dl>
      <p className="font-sans text-[12px] text-[var(--text-muted)]">
        {it.place?.precision === 'country' ? 'Country-level pin: the post names the country only; this is not the event location. ' : ''}A post is a claim, not a verification.
      </p>
    </div>
  );
}
