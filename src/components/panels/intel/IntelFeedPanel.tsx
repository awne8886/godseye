'use client';
/**
 * Desktop INTEL FEED: the events every active layer publishes to useFeedEventStore (newest first,
 * each with its own observation time), filterable by layer and minimum severity. Selecting a row
 * with coordinates flies the map there. Owner: panels-alerts-markets-dossier-graph.
 */
import { useMemo, useState } from 'react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { formatAge } from '@/lib/freshness';
import { useFeedEventStore } from '@/lib/layer-host';
import { LAYERS } from '@/lib/layer-registry';
import { useUiStore } from '@/lib/store';
import type { FeedEvent } from '@/lib/types';
import { useNow } from './client';

const SEVERITIES: FeedEvent['severity'][] = ['info', 'low', 'medium', 'high', 'critical'];
const SEV_TOKEN: Record<FeedEvent['severity'], string> = {
  info: '--text-secondary',
  low: '--cyan-primary',
  medium: '--gold-primary',
  high: '--alert-orange',
  critical: '--alert-red',
};

const layerLabel = (id: string) => (LAYERS as readonly { id: string; label: string }[]).find((l) => l.id === id)?.label ?? id;

export function filterEvents(events: readonly FeedEvent[], layer: string, minSeverity: FeedEvent['severity']): FeedEvent[] {
  const min = SEVERITIES.indexOf(minSeverity);
  return events.filter((e) => (layer === 'all' || e.layer === layer) && SEVERITIES.indexOf(e.severity) >= min);
}

export function IntelFeedPanel(_: PanelProps) {
  const events = useFeedEventStore((s) => s.events);
  const requestFlyTo = useUiStore((s) => s.requestFlyTo);
  const [layer, setLayer] = useState('all');
  const [minSev, setMinSev] = useState<FeedEvent['severity']>('info');
  const now = useNow(15_000);
  const layers = useMemo(() => [...new Set(events.map((e) => e.layer))].sort(), [events]);
  const shown = useMemo(() => filterEvents(events, layer, minSev).slice(0, 200), [events, layer, minSev]);
  usePanelChip(events.length ? `${shown.length} RESULTS` : 'STANDBY', events.length ? 'live' : 'idle');

  return (
    <div className="flex flex-col gap-3" data-testid="intel-panel">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Layer
          <select
            value={layer}
            onChange={(e) => setLayer(e.target.value)}
            className="min-h-8 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)] px-1 font-mono text-[11px] text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
          >
            <option value="all">All layers</option>
            {layers.map((l) => (
              <option key={l} value={l}>
                {layerLabel(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Min severity
          <select
            value={minSev}
            onChange={(e) => setMinSev(e.target.value as FeedEvent['severity'])}
            className="min-h-8 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)] px-1 font-mono text-[11px] text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p aria-live="polite" className="font-mono text-[11px] uppercase tabular-nums tracking-[0.08em] text-[var(--text-secondary)]">
        {events.length ? `${shown.length} of ${events.length} events` : 'No events yet — switch on layers that publish to the feed (earthquakes, alerts, incidents…).'}
      </p>
      <ul className="flex flex-col">
        {shown.map((e) => (
          <li key={`${e.layer}:${e.id}`} className="border-b border-[var(--border-secondary)] last:border-b-0">
            <button
              type="button"
              disabled={e.lat === undefined || e.lng === undefined}
              onClick={() => e.lat !== undefined && e.lng !== undefined && requestFlyTo({ lat: e.lat, lng: e.lng, zoom: 6 })}
              className="flex w-full flex-col gap-0.5 py-1.5 text-left hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)] disabled:cursor-default"
            >
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
                <span style={{ color: `var(${SEV_TOKEN[e.severity]})` }}>{e.severity}</span>
                <span className="text-[var(--text-secondary)]">{layerLabel(e.layer)}</span>
                <span className="ml-auto tabular-nums text-[var(--text-muted)]" title={e.observedAt}>
                  {formatAge(now - Date.parse(e.observedAt))} ago
                </span>
              </span>
              <span className="font-sans text-[13px] leading-snug text-[var(--text-primary)]">{e.title}</span>
              {e.detail && <span className="font-sans text-[12px] text-[var(--text-secondary)]">{e.detail}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
