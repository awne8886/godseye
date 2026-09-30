'use client';
/**
 * Layer toggle rows shared by the rail flyouts and the LAYERS panel: 28×14 spring toggle
 * (aria-pressed), count badge, refresh interval, freshness LED + label, and the feed's source
 * line (providers / attribution; SOURCE OFFLINE with last-good time). Owner: design-system-hud.
 */
import { motion } from 'motion/react';
import { freshnessLabel, FRESHNESS_COLOR_TOKEN } from '@/lib/freshness';
import type { LayerDef, LayerId } from '@/lib/layer-registry';
import { useLayerStatus, type LayerStatus } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import type { Attribution } from '@/lib/types';
import { refreshLabel } from './status-logic';

export function Toggle({ on }: { on: boolean }) {
  return (
    <span aria-hidden className="hud-toggle" data-on={on}>
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="block h-[10px] w-[10px] rounded-full"
        style={{ background: on ? 'var(--gold-light)' : 'rgba(255,255,255,0.4)' }}
      />
    </span>
  );
}

/** Attribution a feature module may attach to its status (from the feed's meta.attribution). */
export function statusAttribution(st: LayerStatus): Attribution[] {
  const a = (st as LayerStatus & { attribution?: unknown }).attribution;
  return Array.isArray(a) ? (a.filter((x) => x && typeof (x as Attribution).text === 'string') as Attribution[]) : [];
}

const hhmm = (iso: string | null) => (iso ? `${new Date(iso).toISOString().slice(11, 16)}Z` : '—');

export function FreshnessLed({ layer, status }: { layer: LayerDef; status: LayerStatus }) {
  if (status.state === 'idle') return null;
  if (status.state === 'loading')
    return (
      <span className="hud-micro flex items-center gap-1 text-[var(--cyan-primary)]">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full border border-[var(--cyan-primary)]" />
        ACQUIRING
      </span>
    );
  const state = layer.kind === 'reference' && status.state !== 'offline' ? 'reference' : status.state;
  const at = status.observedAt ?? status.fetchedAt;
  const color = `var(${FRESHNESS_COLOR_TOKEN[state]})`;
  return (
    <span className="hud-micro flex items-center gap-1" style={{ color }}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {freshnessLabel(state, at ? Date.parse(at) : null)}
    </span>
  );
}

export function LayerRow({ layer, parentOn = true }: { layer: LayerDef; parentOn?: boolean }) {
  const id = layer.id as LayerId;
  const on = useUiStore((s) => s.activeLayers.has(id));
  const toggle = useUiStore((s) => s.toggleLayer);
  const status = useLayerStatus(id);
  const attribution = statusAttribution(status);
  const providers = status.providers ? Object.keys(status.providers) : [];
  const offline = status.state === 'offline';
  return (
    <li className={layer.parent ? 'pl-5' : ''} style={layer.parent && !parentOn ? { opacity: 0.6 } : undefined}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={layer.label}
        onClick={() => toggle(id)}
        className="hud-control flex min-h-[32px] w-full items-start gap-2 px-1.5 py-1.5 text-left hover:bg-[rgba(var(--gold-rgb),0.06)]"
      >
        <span className="mt-0.5">
          <Toggle on={on} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`hud-text truncate text-[11px] ${on ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{layer.label}</span>
            {layer.kind === 'reference' && <span className="instrument-chip text-[var(--text-secondary)]">REFERENCE</span>}
          </span>
          {layer.description && <span className="block font-sans text-[12px] leading-snug text-[var(--text-muted)]">{layer.description}</span>}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="hud-micro text-[var(--text-muted)]" title="Refresh interval">
              {refreshLabel(layer.refreshMs, layer.transport)}
            </span>
            {on && <FreshnessLed layer={layer} status={status} />}
          </span>
          {on && offline && (
            <span className="hud-micro block text-[var(--alert-red)]">SOURCE OFFLINE · LAST GOOD {hhmm(status.lastGoodAt)}</span>
          )}
          {on && (attribution.length > 0 || providers.length > 0) && (
            <span className="block truncate font-sans text-[12px] text-[var(--text-muted)]" title={attribution.map((a) => a.text).join(' · ') || providers.join(', ')}>
              {attribution.length ? attribution.map((a) => a.text).join(' · ') : `Source: ${providers.join(', ')}`}
            </span>
          )}
        </span>
        {on && typeof status.count === 'number' && (
          <span className="hud-micro rounded-[var(--radius-chip)] bg-[rgba(var(--cyan-rgb),0.12)] px-1.5 py-0.5 text-[var(--cyan-primary)]">
            {status.count.toLocaleString('en-US')}
          </span>
        )}
      </button>
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
