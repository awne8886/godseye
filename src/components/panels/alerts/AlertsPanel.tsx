'use client';
/**
 * LIVE ALERTS panel: Telegram channel posts + wire headlines, each labelled with the channel's
 * declared stance, kind (keyword rule), cross-post corroboration, views/forward/reply metadata and
 * its own publication time. Sources that failed are listed as SOURCE OFFLINE (e.g. ToI/TASS 403),
 * never hidden. All upstream text is rendered as text; links are http(s) only.
 * Owner: panels-alerts-markets-dossier-graph.
 */
import { useQuery } from '@tanstack/react-query';
import { Eye, ExternalLink, Forward, MapPin, Reply } from 'lucide-react';
import { useMemo, useState } from 'react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { formatAge } from '@/lib/freshness';
import { useUiStore } from '@/lib/store';
import type { AlertItem } from '@/lib/types';
import { AiReadout } from '../intel/AiReadout';
import { BLOC_SHORT, BLOC_TOKEN, FeedOfflineError, KIND_TOKEN, NEWS_QUERY_KEY, fetchNews, safeHref, useNow } from '../intel/client';

const KINDS = ['all', 'rocket', 'event', 'news'] as const;
const BLOCS = ['all', 'western', 'russian', 'regional', 'independent'] as const;

function Chip({ text, token }: { text: string; token: string }) {
  return (
    <span className="rounded-sm border px-1 py-px font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: `var(${token})`, borderColor: `var(${token})` }}>
      {text}
    </span>
  );
}

export function AlertRow({ it, now, onLocate }: { it: AlertItem; now: number; onLocate?: (it: AlertItem) => void }) {
  const link = safeHref(it.link);
  return (
    <li className="flex flex-col gap-1 border-b border-[var(--border-secondary)] py-2 last:border-b-0" data-testid="alert-row">
      <div className="flex flex-wrap items-center gap-1">
        <Chip text={it.kind} token={KIND_TOKEN[it.kind]!} />
        <Chip text={BLOC_SHORT[it.bloc]!} token={BLOC_TOKEN[it.bloc]!} />
        {it.breaking && <Chip text="Breaking (per channel)" token="--alert-red" />}
        <span className="ml-auto font-mono text-[10px] uppercase tabular-nums tracking-[0.16em] text-[var(--text-muted)]" title={it.publishedAt}>
          {formatAge(now - Date.parse(it.publishedAt))} ago
        </span>
      </div>
      <p className="font-sans text-[13px] leading-snug text-[var(--text-primary)]">{it.title}</p>
      {it.summary && <p className="line-clamp-3 font-sans text-[12px] leading-snug text-[var(--text-secondary)]">{it.summary}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
        <span title={it.lean}>
          {it.sourceName} · {it.lean}
        </span>
        {it.views !== null && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Eye aria-hidden className="h-3 w-3" /> {it.views.toLocaleString('en-US')}
          </span>
        )}
        {it.forwardedFrom && (
          <span className="inline-flex items-center gap-1">
            <Forward aria-hidden className="h-3 w-3" /> {it.forwardedFrom}
          </span>
        )}
        {safeHref(it.replyTo) && (
          <a href={safeHref(it.replyTo)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
            <Reply aria-hidden className="h-3 w-3" /> reply to
          </a>
        )}
        {it.alsoReportedBy.length > 0 && <span>Also: {it.alsoReportedBy.map((a) => a.sourceName).join(', ')}</span>}
        {it.place && onLocate && (
          <button type="button" onClick={() => onLocate(it)} className="inline-flex min-h-6 phone:min-h-11 items-center gap-1 text-[var(--cyan-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]">
            <MapPin aria-hidden className="h-3 w-3" /> {it.place.name} ({it.place.precision})
          </button>
        )}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[var(--cyan-primary)] hover:underline">
            Source <ExternalLink aria-hidden className="h-3 w-3" />
          </a>
        )}
      </div>
    </li>
  );
}

export function AlertsPanel(_: PanelProps) {
  const now = useNow(30_000);
  const q = useQuery({ queryKey: NEWS_QUERY_KEY, queryFn: ({ signal }) => fetchNews({ signal }), refetchInterval: 120_000, staleTime: 60_000 });
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all');
  const [bloc, setBloc] = useState<(typeof BLOCS)[number]>('all');
  const [thread, setThread] = useState<Set<string> | null>(null);
  const requestFlyTo = useUiStore((s) => s.requestFlyTo);
  const setLayer = useUiStore((s) => s.setLayer);
  const items = useMemo(
    () => (q.data?.items ?? []).filter((it) => (kind === 'all' || it.kind === kind) && (bloc === 'all' || it.bloc === bloc) && (!thread || thread.has(it.id))),
    [q.data, kind, bloc, thread],
  );
  const offline = q.error instanceof FeedOfflineError ? q.error : null;
  const state = q.data?.meta.state;
  usePanelChip(q.data ? `${items.length} RESULTS` : q.isPending ? 'PLOTTING' : 'SOURCE OFFLINE', q.data ? (state === 'live' ? 'live' : 'warn') : q.isPending ? 'busy' : 'error');
  const failed = (q.data?.sources ?? []).filter((s) => !s.ok);

  return (
    <div className="flex flex-col gap-3" data-testid="alerts-panel">
      <AiReadout path="/api/ai/overview" body={{ scope: 'alerts' }} label="Read-out" onThread={(ids) => setThread(ids ? new Set(ids) : null)} />
      <div className="flex flex-col gap-1.5">
        {[
          ['Kind', KINDS, kind, setKind],
          ['Stance', BLOCS, bloc, setBloc],
        ].map(([label, opts, value, set]) => (
          <div key={label as string} role="group" aria-label={`Filter by ${(label as string).toLowerCase()}`} className="flex flex-wrap items-center gap-1">
            <span className="w-12 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label as string}</span>
            {(opts as readonly string[]).map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={value === o}
                onClick={() => (set as (v: string) => void)(o)}
                className="min-h-7 phone:min-h-11 rounded-sm border px-1.5 font-mono text-[10px] uppercase tracking-[0.16em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
                style={{ borderColor: value === o ? 'var(--gold-primary)' : 'var(--border-secondary)', color: value === o ? 'var(--gold-primary)' : 'var(--text-secondary)' }}
              >
                {o === 'all' ? 'All' : (BLOC_SHORT[o] ?? o)}
              </button>
            ))}
          </div>
        ))}
      </div>
      <p aria-live="polite" className="font-mono text-[11px] uppercase tabular-nums tracking-[0.08em] text-[var(--text-secondary)]">
        {q.data ? `${items.length} of ${q.data.items.length} alerts${thread ? ' · thread filter' : ''}` : q.isPending ? 'Acquiring feed…' : 'Source offline'}
      </p>
      {offline && (
        <p className="font-sans text-[12px] text-[var(--alert-red)]">
          SOURCE OFFLINE — no channel or wire answered{offline.meta?.lastGoodAt ? `; last good ${offline.meta.lastGoodAt.slice(11, 16)} UTC` : ''}.
        </p>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col">
          {items.map((it) => (
            <AlertRow
              key={it.id}
              it={it}
              now={now}
              onLocate={(a) => {
                if (!a.place) return;
                setLayer('alert_pins', true);
                requestFlyTo({ lng: a.place.lng, lat: a.place.lat, zoom: a.place.precision === 'country' ? 4 : 7 });
              }}
            />
          ))}
        </ul>
      )}
      {q.data && (
        <details className="font-sans text-[12px] text-[var(--text-secondary)]" open={failed.length > 0}>
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em]">
            Sources · {q.data.sources.length - failed.length} answering{failed.length ? ` · ${failed.length} offline` : ''}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {q.data.sources.map((s) => (
              <li key={s.handle} className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: s.ok ? 'var(--alert-green)' : 'var(--alert-red)' }}>
                  {s.ok ? `${s.count} items` : 'Source offline'}
                </span>
                <span>
                  {s.name} ({s.kind}) — {s.lean}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="font-sans text-[12px] text-[var(--text-muted)]">
        Posts are claims from partisan channels, shown with their declared stance; not verified. Kind and pins come from keyword rules (precision shown).
      </p>
    </div>
  );
}
