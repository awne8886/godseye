'use client';
/**
 * Right tool strip (desktop): one button per TOOLS entry whose panel is registered, tooltips
 * verbatim from the registry, accent token when open, separators, World Remote only with Web
 * Bluetooth. Panel code is warmed on hover/focus and, after boot, on idle (preload.ts), so a first
 * open never waits for its chunk (R1 m9). Owner: design-system-hud.
 */
import { useEffect } from 'react';
import { panelFor } from '@/features/registry';
import { TOOLS, type PanelId } from '@/lib/tool-registry';
import { useUiStore } from '@/lib/store';
import { isPanelAvailable, useHasBluetooth } from './hooks';
import { iconFor } from './icons';
import { preloadComponent, preloadWhenIdle } from './preload';

/** Panels opened from the strip, the rail bottom and the palette shortcut: warmed after boot. */
const WARM_AFTER_BOOT: readonly PanelId[] = [...TOOLS.map((t) => t.id), 'layers', 'settings', 'style-studio', 'palette'];

export default function ToolStrip() {
  const openPanel = useUiStore((s) => s.openPanel);
  const pinned = useUiStore((s) => s.pinnedPanels);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const splashDone = useUiStore((s) => s.splashDone);
  const bt = useHasBluetooth();
  const tools = TOOLS.filter((t) => isPanelAvailable(t.id, bt));
  useEffect(() => (splashDone ? preloadWhenIdle(WARM_AFTER_BOOT.map((id) => panelFor(id))) : undefined), [splashDone]);
  if (!tools.length) return null;
  return (
    <nav
      aria-label="Tools"
      className="glass-1 fixed right-2 top-1/2 z-[var(--z-tool-strip)] hidden -translate-y-1/2 flex-col items-center gap-1 rounded-[var(--radius-panel)] border border-[var(--border-secondary)] p-1 md:flex"
    >
      {tools.map((t, i) => {
        const Icon = iconFor(t.icon);
        const on = openPanel === t.id || pinned.includes(t.id);
        const sep = 'separatorBefore' in t && t.separatorBefore && i > 0;
        return (
          <div key={t.id} className="flex flex-col items-center">
            {sep && <span aria-hidden className="my-1 h-px w-6 bg-[var(--border-primary)]" />}
            <button
              type="button"
              aria-label={t.label}
              aria-pressed={on}
              title={t.tooltip}
              onClick={() => togglePanel(t.id)}
              onPointerEnter={() => preloadComponent(panelFor(t.id))}
              onFocus={() => preloadComponent(panelFor(t.id))}
              className="group hud-control relative grid h-11 w-11 place-items-center transition-colors"
              style={{
                color: on ? `var(${t.accentToken})` : 'var(--text-secondary)',
                background: on ? 'rgba(var(--gold-rgb), 0.08)' : undefined,
                boxShadow: on ? `inset 2px 0 0 var(${t.accentToken})` : undefined,
              }}
            >
              <Icon size={17} aria-hidden />
              <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap rounded-[var(--radius-chip)] border border-[var(--border-primary)] bg-[var(--glass-3)] px-2 py-1 text-left group-hover:block group-focus-visible:block">
                <span className="hud-micro block text-[var(--gold-light)]">{t.label}</span>
                <span className="block font-sans text-[12px] normal-case text-[var(--text-secondary)]">{t.tooltip}</span>
              </span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
