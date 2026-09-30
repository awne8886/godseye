'use client';
/**
 * LAYERS panel (L key, mobile LAYERS tab): every deployable layer grouped as in the rail, with the
 * same rows (count, refresh interval, freshness, source). Owner: design-system-hud.
 */
import type { PanelProps } from '@/lib/feature-module';
import { LAYER_GROUPS, type LayerId } from '@/lib/layer-registry';
import { useLayerStatusStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { useVisibleLayers } from '../hooks';
import { iconFor } from '../icons';
import { LayerList } from '../LayerRows';
import { usePanelChip } from '../PanelChrome';

export default function LayersPanel(_: PanelProps) {
  const layers = useVisibleLayers();
  const active = useUiStore((s) => s.activeLayers);
  const liveCount = useLayerStatusStore((s) => layers.filter((l) => active.has(l.id as LayerId) && s.status[l.id as LayerId]?.state === 'live').length);
  const on = layers.filter((l) => active.has(l.id as LayerId)).length;
  usePanelChip(liveCount > 0 ? `${liveCount} LIVE` : `${on} ON`, liveCount > 0 ? 'live' : 'idle');
  return (
    <div className="space-y-4">
      {LAYER_GROUPS.map((g) => {
        const inGroup = layers.filter((l) => l.group === g.id);
        if (!inGroup.length) return null;
        const Icon = iconFor(g.icon);
        return (
          <section key={g.id} aria-label={g.label}>
            <h3 className="hud-micro mb-1 flex items-center gap-2 text-[var(--text-secondary)]">
              <Icon size={12} aria-hidden className="text-[var(--gold-primary)]" />
              {g.label}
            </h3>
            <LayerList layers={inGroup} />
          </section>
        );
      })}
    </div>
  );
}
