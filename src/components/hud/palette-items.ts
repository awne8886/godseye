'use client';
/**
 * Command palette entries: tools, panels, layers, region presets and map actions (incl. "Dossier
 * at map centre"). Pure over its inputs so the list is unit-tested. Owner: design-system-hud.
 */
import { KEY_BINDINGS, type KeyAction } from '@/lib/keyboard';
import type { LayerDef, LayerId } from '@/lib/layer-registry';
import { REGION_PRESETS } from '@/lib/presets';
import { PANELS, TOOLS, type PanelId } from '@/lib/tool-registry';
import { useUiStore } from '@/lib/store';
import { mapCentre, runKeyAction } from './actions';

export interface PaletteItem {
  id: string;
  group: 'TOOLS' | 'PANELS' | 'LAYERS' | 'REGIONS' | 'ACTIONS';
  label: string;
  hint?: string;
  keywords: string[];
  run: () => void;
}

/** Panels that need an entity or map context are opened from cards/map gestures, not the palette. */
const CONTEXT_PANELS = new Set<PanelId>(['dossier', 'graph', 'flight-watch', 'camera', 'live-news', 'satellite', 'palette']);

const keyFor = (action: KeyAction) => KEY_BINDINGS.find((b) => b.action === action)?.display;

export function paletteItems(ctx: { available: (id: PanelId) => boolean; layers: LayerDef[]; active: ReadonlySet<string> }): PaletteItem[] {
  const ui = () => useUiStore.getState();
  const items: PaletteItem[] = [];
  for (const t of TOOLS) {
    if (!ctx.available(t.id)) continue;
    items.push({ id: `tool:${t.id}`, group: 'TOOLS', label: t.label, hint: t.tooltip, keywords: [t.id, t.tooltip], run: () => ui().setOpenPanel(t.id) });
  }
  for (const p of PANELS) {
    if (CONTEXT_PANELS.has(p.id) || !ctx.available(p.id)) continue;
    items.push({ id: `panel:${p.id}`, group: 'PANELS', label: p.label, keywords: [p.id], run: () => ui().setOpenPanel(p.id) });
  }
  for (const l of ctx.layers) {
    const on = ctx.active.has(l.id);
    items.push({
      id: `layer:${l.id}`,
      group: 'LAYERS',
      label: `${on ? 'Hide' : 'Show'} ${l.label}`,
      hint: l.description,
      keywords: [l.id, l.group, 'layer', 'toggle'],
      run: () => ui().toggleLayer(l.id as LayerId),
    });
  }
  for (const r of REGION_PRESETS) {
    items.push({
      id: `region:${r.id}`,
      group: 'REGIONS',
      label: `Fly to ${r.label}`,
      keywords: [r.id, 'region', 'preset', 'fly'],
      run: () => ui().requestFlyTo({ lat: r.lat, lng: r.lng, zoom: r.zoom }),
    });
  }
  items.push(
    { id: 'action:dossier', group: 'ACTIONS', label: 'Dossier at map centre', keywords: ['dossier', 'region', 'brief', 'centre', 'center'], run: () => ui().openDossier(mapCentre()) },
    { id: 'action:projection', group: 'ACTIONS', label: 'Toggle globe / flat map', hint: keyFor('toggle-projection'), keywords: ['globe', '2d', '3d', 'projection'], run: () => runKeyAction('toggle-projection') },
    { id: 'action:reset', group: 'ACTIONS', label: 'Reset view', hint: keyFor('reset-view'), keywords: ['home', 'reset'], run: () => runKeyAction('reset-view') },
    { id: 'action:fullscreen', group: 'ACTIONS', label: 'Toggle fullscreen', hint: keyFor('toggle-fullscreen'), keywords: ['fullscreen'], run: () => runKeyAction('toggle-fullscreen') },
    { id: 'action:basemap', group: 'ACTIONS', label: 'Toggle satellite imagery', keywords: ['sat', 'imagery', 'basemap', 'map'], run: () => ui().setBasemap(ui().basemap === 'dark' ? 'satellite' : 'dark') },
    { id: 'action:ghost', group: 'ACTIONS', label: 'Toggle Ghost Protocol', keywords: ['ghost', 'theme', 'violet'], run: () => ui().setGhost(!ui().ghost) },
    { id: 'action:sensor-crt', group: 'ACTIONS', label: 'Sensor mode: CRT', hint: keyFor('sensor-crt'), keywords: ['sensor', 'crt'], run: () => runKeyAction('sensor-crt') },
    { id: 'action:sensor-nvg', group: 'ACTIONS', label: 'Sensor mode: NVG', hint: keyFor('sensor-nvg'), keywords: ['sensor', 'night', 'nvg'], run: () => runKeyAction('sensor-nvg') },
    { id: 'action:sensor-flir', group: 'ACTIONS', label: 'Sensor mode: FLIR', hint: keyFor('sensor-flir'), keywords: ['sensor', 'thermal', 'flir'], run: () => runKeyAction('sensor-flir') },
    { id: 'action:sensor-noir', group: 'ACTIONS', label: 'Sensor mode: Noir', hint: keyFor('sensor-noir'), keywords: ['sensor', 'noir', 'mono'], run: () => runKeyAction('sensor-noir') },
    { id: 'action:sensor-none', group: 'ACTIONS', label: 'Sensor mode: off', hint: keyFor('sensor-none'), keywords: ['sensor', 'off'], run: () => runKeyAction('sensor-none') },
  );
  return items;
}
