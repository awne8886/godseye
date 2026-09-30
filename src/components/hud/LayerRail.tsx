'use client';
/**
 * Left layer rail: one button per registry group with a cyan count badge; click opens the group's
 * flyout with ALL/NONE and 28×14 toggles. (design-system-hud adds hover flyouts, pinning,
 * freshness LEDs, Style Studio and Ghost Protocol.) Owner: design-system-hud.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LAYER_GROUPS, visibleLayers, type LayerDef, type LayerGroupId, type LayerId } from '@/lib/layer-registry';
import { useLayerStatusStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { iconFor } from './icons';

type Caps = Record<string, { enabled: boolean }>;

function Toggle({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`relative inline-block h-[14px] w-[28px] rounded-full border transition-colors ${on ? 'border-[var(--gold-primary)] bg-[rgba(212,175,55,0.35)]' : 'border-white/25 bg-white/5'}`}>
      <span className={`absolute top-[1px] h-[10px] w-[10px] rounded-full transition-[left] ${on ? 'left-[15px] bg-[var(--gold-light)]' : 'left-[1px] bg-white/40'}`} />
    </span>
  );
}

export default function LayerRail() {
  const [open, setOpen] = useState<LayerGroupId | null>(null);
  const active = useUiStore((s) => s.activeLayers);
  const setLayer = useUiStore((s) => s.setLayer);
  const status = useLayerStatusStore((s) => s.status);
  const caps = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await (await fetch('/api/health')).json()) as { capabilities: Caps },
    select: (h) => h.capabilities,
  });
  const layers = visibleLayers(caps.data ?? {});
  const groups = LAYER_GROUPS.filter((g) => layers.some((l) => l.group === g.id));

  return (
    <nav aria-label="Map layers" className="glass-rail absolute bottom-7 left-0 top-0 z-[var(--z-rail)] hidden w-12 flex-col items-center gap-1 pt-24 md:flex">
      {groups.map((g) => {
        const Icon = iconFor(g.icon);
        const inGroup = layers.filter((l) => l.group === g.id);
        const on = inGroup.filter((l) => active.has(l.id as LayerId) && !l.parent).length;
        return (
          <div key={g.id} className="relative">
            <button
              type="button"
              aria-label={g.label}
              aria-expanded={open === g.id}
              onClick={() => setOpen(open === g.id ? null : g.id)}
              className={`grid h-10 w-10 place-items-center rounded-lg ${on ? 'text-white/80' : 'text-white/35'} hover:text-white/70`}
            >
              <Icon size={16} />
              {on > 0 && (
                <span className="absolute right-0.5 top-0.5 min-w-[13px] rounded-full bg-[rgba(0,229,255,0.9)] px-0.5 font-mono text-[9px] leading-[13px] text-[var(--bg-void)]">{on}</span>
              )}
            </button>
            {open === g.id && (
              <div role="dialog" aria-label={g.label} className="glass-panel absolute left-[52px] top-0 min-w-[240px] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="hud-micro text-[var(--text-heading)]">{g.label}</span>
                  <button
                    type="button"
                    className="hud-micro text-[var(--gold-primary)]"
                    onClick={() => inGroup.forEach((l: LayerDef) => setLayer(l.id as LayerId, on === 0))}
                  >
                    {on === 0 ? 'ALL' : 'NONE'}
                  </button>
                </div>
                <ul className="space-y-1">
                  {inGroup.map((l) => {
                    const isOn = active.has(l.id as LayerId);
                    const count = status[l.id as LayerId]?.count;
                    return (
                      <li key={l.id} className={l.parent ? 'pl-5' : ''}>
                        <button
                          type="button"
                          aria-pressed={isOn}
                          onClick={() => setLayer(l.id as LayerId, !isOn)}
                          className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-white/5"
                        >
                          <Toggle on={isOn} />
                          <span className="flex-1">
                            <span className={`hud-text block text-[11px] ${isOn ? 'text-white/80' : 'text-white/50'}`}>{l.label}</span>
                            {l.description && <span className="block font-sans text-[10px] text-[var(--text-muted)]">{l.description}</span>}
                          </span>
                          {typeof count === 'number' && <span className="font-mono text-[10px] text-[var(--text-secondary)]">{count.toLocaleString('en-US')}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
