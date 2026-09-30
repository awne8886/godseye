'use client';
/**
 * Phone bottom nav: the seven MOBILE_TABS (44 px targets, safe-area inset). A tab opens its first
 * available sheet panel; the sheet lists the tab's siblings from MOBILE_SHEETS so every tool is
 * reachable. Owner: design-system-hud.
 */
import { Layers, type LucideIcon } from 'lucide-react';
import { MOBILE_SHEETS, MOBILE_TABS, TOOLS, type PanelId } from '@/lib/tool-registry';
import { useUiStore } from '@/lib/store';
import { isPanelAvailable, useHasBluetooth } from './hooks';
import { iconFor } from './icons';
import { panelLabel, tabForPanel, type MobileTab } from './panel-meta';

const TAB_ICON: Partial<Record<MobileTab, LucideIcon>> = { layers: Layers };

function iconForTab(tab: MobileTab): LucideIcon {
  if (TAB_ICON[tab]) return TAB_ICON[tab];
  const tool = TOOLS.find((t) => t.id === tab);
  return iconFor(tool?.icon ?? (tab === 'intel' ? 'Newspaper' : 'Radar'));
}

export default function MobileNav() {
  const openPanel = useUiStore((s) => s.openPanel);
  const setOpenPanel = useUiStore((s) => s.setOpenPanel);
  const bt = useHasBluetooth();
  const activeTab = tabForPanel(openPanel);
  const tabs = MOBILE_TABS.map((tab) => ({ tab, first: (MOBILE_SHEETS[tab] as readonly PanelId[]).find((p) => isPanelAvailable(p, bt)) ?? null })).filter(
    (t): t is { tab: MobileTab; first: PanelId } => t.first !== null,
  );
  if (!tabs.length) return null;
  return (
    <nav
      aria-label="Main"
      className="glass-1 fixed inset-x-0 bottom-0 z-[var(--z-mobile-nav)] flex border-t border-[var(--border-primary)] md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(({ tab, first }) => {
        const Icon = iconForTab(tab);
        const on = activeTab === tab;
        return (
          <button
            key={tab}
            type="button"
            aria-pressed={on}
            aria-label={panelLabel(tab === 'layers' ? 'layers' : (tab as PanelId))}
            onClick={() => setOpenPanel(on ? null : first)}
            className="flex min-h-[56px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1"
            style={{ color: on ? 'var(--gold-light)' : 'var(--text-secondary)' }}
          >
            <Icon size={18} aria-hidden />
            <span className="font-mono text-[9px] uppercase tracking-[0.16em]">{tab}</span>
          </button>
        );
      })}
    </nav>
  );
}
