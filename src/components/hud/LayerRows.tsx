'use client';
/**
 * Layer toggle rows shared by the rail flyouts and the LAYERS panel: 28×14 sliding toggle
 * (aria-pressed), count badge, refresh interval, freshness LED + label, and the feed's source
 * line (providers / attribution, several credits behind a SOURCES (N) disclosure; SOURCE OFFLINE
 * with last-good time). Owner: design-system-hud.
 */
import { useId } from 'react';
import { freshnessLabel, FRESHNESS_COLOR_TOKEN } from '@/lib/freshness';
import type { LayerDef, LayerId } from '@/lib/layer-registry';
import { useLayerStatus, type LayerStatus } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import type { Attribution } from '@/lib/types';
import { refreshLabel, zoomGateLabel } from './status-logic';
import { hhmmUtc, isTimelineLayer, useTimeCursor, useTimelineCoverage } from './timeline';

/** The knob slides with a CSS transition (base.css), so this module stays free of motion (perf m-d). */
export function Toggle({ on }: { on: boolean }) {
  return (
    <span aria-hidden className="hud-toggle" data-on={on}>
      <span className="hud-toggle-knob" />
    </span>
  );
}

/** The feed's attribution (meta.attribution) as reported by the feature module. */
export function statusAttribution(st: LayerStatus): Attribution[] {
  return (st.attribution ?? []).filter((a) => typeof a?.text === 'string' && a.text.trim() !== '');
}

const hhmm = (iso: string | null) => (iso ? `${new Date(iso).toISOString().slice(11, 16)}Z` : '—');

/** `omitReference`: the row already shows a REFERENCE chip, so a healthy reference feed adds nothing (n4). */
export function FreshnessLed({ layer, status, omitReference = false }: { layer: LayerDef; status: LayerStatus; omitReference?: boolean }) {
  const cursor = useTimeCursor();
  const gate = zoomGateLabel(status);
  if (gate) return <span className="hud-micro text-[var(--text-secondary)]">{gate}</span>;
  if (status.state === 'idle') return null;
  if (status.state === 'loading')
    return (
      <span className="hud-micro flex items-center gap-1 text-[var(--cyan-primary)]">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full border border-[var(--cyan-primary)]" />
        ACQUIRING
      </span>
    );
  const state = layer.kind === 'reference' && status.state !== 'offline' ? 'reference' : status.state;
  if (state === 'reference' && omitReference) return null;
  // Timeline replay: a replayed layer shows the cursor, never its live freshness (offline still says so).
  if (cursor !== null && state !== 'offline' && isTimelineLayer(layer.id))
    return (
      <span className="hud-micro flex items-center gap-1 text-[var(--gold-light)]" data-testid={`replay-${layer.id}`}>
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--gold-light)]" />
        REPLAY {hhmmUtc(cursor)}Z
      </span>
    );
  const at = status.observedAt ?? status.fetchedAt;
  const color = `var(${FRESHNESS_COLOR_TOKEN[state]})`;
  return (
    <span className="hud-micro flex items-center gap-1" style={{ color }}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {freshnessLabel(state, at ? Date.parse(at) : null)}
    </span>
  );
}

/** One attribution line; links only for http(s) URLs, always rel="noopener noreferrer". */
export function AttributionLine({ a }: { a: Attribution }) {
  const text = `${a.text}${a.licence ? ` · ${a.licence}` : ''}`;
  return a.url && /^https?:\/\//.test(a.url) ? (
    <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline decoration-[var(--border-active)] underline-offset-2 hover:text-[var(--gold-light)]">
      {text}
    </a>
  ) : (
    <span>{text}</span>
  );
}

/**
 * The row's source credit. One credit stays inline; several collapse to a SOURCES (N) disclosure
 * (r7 m: CCTV's ~45 lines of licence links pushed the rest of SURVEILLANCE two screens down). The
 * full wording is still one click away here and always listed in the Sources & Licences panel.
 */
export function SourcesLine({ layerId, attribution }: { layerId: string; attribution: Attribution[] }) {
  if (attribution.length === 1)
    return (
      <p className="font-sans text-[12px] text-[var(--text-muted)]" data-testid={`attribution-${layerId}`}>
        <AttributionLine a={attribution[0]!} />
      </p>
    );
  return (
    <details className="group" data-testid={`sources-${layerId}`}>
      <summary className="hud-micro hud-control flex min-h-6 cursor-pointer list-none items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--gold-light)] phone:min-h-11 [&::-webkit-details-marker]:hidden">
        SOURCES ({attribution.length})
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
      </summary>
      <ul className="mt-0.5 space-y-0.5 font-sans text-[12px] text-[var(--text-muted)]" data-testid={`attribution-${layerId}`}>
        {attribution.map((a) => (
          <li key={`${a.text}|${a.url ?? ''}`}>
            <AttributionLine a={a} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * A layer toggle. The button holds only what names it (toggle, label, REFERENCE chip, count), so
 * its accessible name contains the visible label (WCAG 2.5.3); description, refresh interval,
 * freshness and the source line sit beside it and are linked with aria-describedby.
 */
export function LayerRow({ layer, parentOn = true }: { layer: LayerDef; parentOn?: boolean }) {
  const id = layer.id as LayerId;
  const on = useUiStore((s) => s.activeLayers.has(id));
  const toggle = useUiStore((s) => s.toggleLayer);
  const status = useLayerStatus(id);
  const attribution = statusAttribution(status);
  const providers = status.providers ? Object.keys(status.providers) : [];
  // Providers the server skipped for want of a key (e.g. TfL cameras on a keyless instance).
  const needsKey = status.providers ? Object.entries(status.providers).filter(([, p]) => p.skipped === 'not-configured').map(([name]) => name) : [];
  const offline = status.state === 'offline';
  const descId = useId();
  // Timeline replay: the count is what the map draws at the cursor.
  const cursor = useTimeCursor();
  const replay = useTimelineCoverage((s) => (cursor !== null && isTimelineLayer(id) ? s.coverage[id] : undefined));
  const count = replay ? replay.shown : status.count;
  return (
    <li className={layer.parent ? 'pl-5' : ''} style={layer.parent && !parentOn ? { opacity: 0.6 } : undefined}>
      <button
        type="button"
        aria-pressed={on}
        aria-describedby={descId}
        onClick={() => toggle(id)}
        className="hud-control flex min-h-[32px] w-full items-center gap-2 px-1.5 pt-1.5 text-left hover:bg-[rgba(var(--gold-rgb),0.06)]"
      >
        <Toggle on={on} />
        <span className={`hud-text truncate text-[11px] ${on ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{layer.label}</span>
        {layer.kind === 'reference' && <span className="instrument-chip text-[var(--text-secondary)]">REFERENCE</span>}
        <span className="flex-1" />
        {on && typeof count === 'number' && (
          <span data-testid={`layer-count-${layer.id}`} title={replay ? `${count} of ${replay.total} held, at the timeline cursor` : undefined} className="hud-micro rounded-[var(--radius-chip)] bg-[rgba(var(--cyan-rgb),0.12)] px-1.5 py-0.5 text-[var(--cyan-primary)]">
            {count.toLocaleString('en-US')}
          </span>
        )}
      </button>
      <div id={descId} className="pb-1.5 pl-[44px] pr-1.5">
        {layer.description && <p className="font-sans text-[12px] leading-snug text-[var(--text-muted)]">{layer.description}</p>}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="hud-micro text-[var(--text-muted)]" title="Refresh interval">
            {refreshLabel(layer.refreshMs, layer.transport)}
          </span>
          {on && <FreshnessLed layer={layer} status={status} />}
        </p>
        {on && offline && <p className="hud-micro text-[var(--alert-red)]">SOURCE OFFLINE · LAST GOOD {hhmm(status.lastGoodAt)}</p>}
        {on && typeof status.staleCount === 'number' && status.staleCount > 0 && (
          <p className="hud-micro text-[var(--text-muted)] tabular-nums" data-testid={`stale-${layer.id}`}>
            {status.staleCount.toLocaleString('en-US')} OLDER THAN 60 S
          </p>
        )}
        {on && typeof status.unplacedCount === 'number' && status.unplacedCount > 0 && (
          <p className="hud-micro text-[var(--text-muted)] tabular-nums" data-testid={`unplaced-${layer.id}`}>
            {status.unplacedCount.toLocaleString('en-US')} ALERTS AWAITING ZONE OUTLINES
          </p>
        )}
        {on && needsKey.length > 0 && (
          <p className="hud-micro text-[var(--text-muted)]" data-testid={`needs-key-${layer.id}`}>
            NEEDS KEY · {needsKey.join(', ').toUpperCase()}
          </p>
        )}
        {on && attribution.length > 0 && <SourcesLine layerId={layer.id} attribution={attribution} />}
        {on && attribution.length === 0 && providers.length > 0 && <p className="font-sans text-[12px] text-[var(--text-muted)]">Source: {providers.join(', ')}</p>}
      </div>
    </li>
  );
}

export function LayerList({ layers }: { layers: LayerDef[] }) {
  const active = useUiStore((s) => s.activeLayers);
  return (
    <ul className="space-y-0.5">
      {layers.map((l) => (
        <LayerRow key={l.id} layer={l} parentOn={!l.parent || active.has(l.parent as LayerId)} />
      ))}
    </ul>
  );
}
