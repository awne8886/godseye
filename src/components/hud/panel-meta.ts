/**
 * Panel metadata helpers over the lead's TOOLS / PANELS / MOBILE_SHEETS registries.
 * Owner: design-system-hud.
 */
import { MOBILE_SHEETS, MOBILE_TABS, PANELS, TOOLS, type PanelId } from '@/lib/tool-registry';

/** Panels rendered as modal dialogs (focus trap + aria-modal) instead of the side column. */
export const MODAL_PANELS: ReadonlySet<PanelId> = new Set<PanelId>(['palette', 'help', 'style-studio']);

const LABELS = new Map<string, string>([...TOOLS.map((t) => [t.id, t.label] as const), ...PANELS.map((p) => [p.id, p.label] as const)]);

export function panelLabel(id: PanelId): string {
  return LABELS.get(id) ?? id.toUpperCase();
}

export const ALL_PANEL_IDS: readonly PanelId[] = [...TOOLS.map((t) => t.id), ...PANELS.map((p) => p.id)];

export type MobileTab = (typeof MOBILE_TABS)[number];

/** The bottom-nav tab whose sheet contains this panel (null for card/map-launched panels). */
export function tabForPanel(id: PanelId | null): MobileTab | null {
  if (!id) return null;
  for (const tab of MOBILE_TABS) if ((MOBILE_SHEETS[tab] as readonly PanelId[]).includes(id)) return tab;
  return null;
}

/** Every panel reachable from the mobile nav (tabs + their sheets). */
export function mobileReachable(): Set<PanelId> {
  const out = new Set<PanelId>(MOBILE_TABS);
  for (const tab of MOBILE_TABS) for (const p of MOBILE_SHEETS[tab]) out.add(p);
  return out;
}
