'use client';
/**
 * Left layer rail (desktop): one button per registry group with a cyan count badge. Hover shows the
 * group's flyout; click pins it. Flyouts are disclosures (aria-expanded + aria-controls), not
 * dialogs. The rail bottom holds the rail-bottom launchers (Settings, Style Studio) and Ghost
 * Protocol. Owner: design-system-hud.
 */
import { AnimatePresence, m } from 'motion/react';
import { Ghost, Settings2, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LAYER_GROUPS, type LayerGroupId, type LayerId } from '@/lib/layer-registry';
import { useUiStore } from '@/lib/store';
import { useVisibleLayers } from './hooks';
import { useHudStore } from './hud-store';
import { iconFor } from './icons';
import { LayerList } from './LayerRows';

export default function LayerRail() {
  const [hover, setHover] = useState<LayerGroupId | null>(null);
  const pinned = useHudStore((s) => s.pinnedFlyout);
  const setPinned = useHudStore((s) => s.setPinnedFlyout);
  const active = useUiStore((s) => s.activeLayers);
  const setLayer = useUiStore((s) => s.setLayer);
  const openPanel = useUiStore((s) => s.openPanel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const ghost = useUiStore((s) => s.ghost);
  const setGhost = useUiStore((s) => s.setGhost);
  const layers = useVisibleLayers();
  const groups = LAYER_GROUPS.filter((g) => layers.some((l) => l.group === g.id));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const railRef = useRef<HTMLElement>(null);
  const shown = pinned ?? hover;

  // A pinned flyout closes on a click anywhere outside the rail (and on ESC via the key handler).
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setPinned(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pinned, setPinned]);

  const enter = (g: LayerGroupId) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(g), 120);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(null), 220);
  };

  return (
    <nav ref={railRef} aria-label="Map layers" className="glass-rail fixed bottom-7 left-0 top-0 z-[var(--z-rail)] hidden w-12 flex-col items-center gap-1 pb-3 pt-24 md:flex">
      {groups.map((g) => {
        const Icon = iconFor(g.icon);
        const inGroup = layers.filter((l) => l.group === g.id);
        const on = inGroup.filter((l) => active.has(l.id as LayerId) && !l.parent).length;
        const expanded = shown === g.id;
        const panelId = `flyout-${g.id}`;
        return (
          <div key={g.id} className="relative" onMouseEnter={() => enter(g.id)} onMouseLeave={leave}>
            <button
              type="button"
              aria-label={g.label}
              aria-expanded={expanded}
              aria-controls={panelId}
              title={g.label}
              onClick={() => setPinned(pinned === g.id ? null : g.id)}
              className={`hud-control relative grid h-10 w-10 place-items-center ${on ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'} ${pinned === g.id ? 'bg-[rgba(var(--gold-rgb),0.12)] text-[var(--gold-light)]' : ''} hover:text-[var(--gold-light)]`}
            >
              <Icon size={16} aria-hidden />
              {on > 0 && (
                <span className="absolute right-0 top-0 min-w-[14px] rounded-full bg-[var(--cyan-primary)] px-0.5 text-center font-mono text-[10px] leading-[14px] text-[var(--bg-void)]">
                  {on}
                </span>
              )}
            </button>
            <AnimatePresence>
              {expanded && (
                <m.div
                  id={panelId}
                  key={panelId}
                  initial={{ opacity: 0, x: -8, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="glass-panel instrument-corners absolute left-[52px] top-0 w-[320px] p-3"
                  role="region"
                  aria-label={`${g.label} layers`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="hud-title">{g.label}</span>
                    <button
                      type="button"
                      className="hud-micro hud-control min-h-[24px] px-2 text-[var(--gold-primary)] hover:bg-[rgba(var(--gold-rgb),0.08)]"
                      onClick={() => inGroup.forEach((l) => setLayer(l.id as LayerId, on === 0))}
                    >
                      {on === 0 ? 'ALL' : 'NONE'}
                    </button>
                  </div>
                  <LayerList layers={inGroup} />
                </m.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-1">
        <span aria-hidden className="mb-1 h-px w-6 bg-[var(--border-primary)]" />
        <button
          type="button"
          aria-label="Ghost Protocol"
          aria-pressed={ghost}
          title="Ghost Protocol — violet low-signature palette"
          onClick={() => setGhost(!ghost)}
          className="hud-control grid h-10 w-10 place-items-center"
          style={{ color: ghost ? 'var(--gold-primary)' : 'var(--text-secondary)' }}
        >
          <Ghost size={16} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Style Studio"
          aria-pressed={openPanel === 'style-studio'}
          title="Style Studio — live UI tokens"
          onClick={() => togglePanel('style-studio')}
          className="hud-control grid h-10 w-10 place-items-center"
          style={{ color: openPanel === 'style-studio' ? 'var(--gold-primary)' : 'var(--text-secondary)' }}
        >
          <SlidersHorizontal size={16} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Settings"
          aria-pressed={openPanel === 'settings'}
          title="Settings — units, motion, privacy"
          onClick={() => togglePanel('settings')}
          className="hud-control grid h-10 w-10 place-items-center"
          style={{ color: openPanel === 'settings' ? 'var(--gold-primary)' : 'var(--text-secondary)' }}
        >
          <Settings2 size={16} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
