/**
 * Concatenates every owner's FeatureModule list. Owner: lead (builders never edit this file;
 * they export from their own entry file listed in src/lib/feature-module.ts).
 */
import type { FeatureModule } from '@/lib/feature-module';
import type { LayerId } from '@/lib/layer-registry';
import type { PanelId } from '@/lib/tool-registry';
import type { EntityKind } from '@/lib/types';
import aviation from './aviation';
import space from './space';
import hazards from './hazards';
import surveillance from './surveillance';
import threats from './threats';
import network from './network';
import maritime from './maritime';
import flightPaths from './flight-paths';
import intelPanels from '@/components/panels/intel';
import reconPanels from '@/components/panels/recon';
import hudPanels from '@/components/hud/modules';

export const FEATURE_MODULES: readonly FeatureModule[] = [
  ...aviation,
  ...space,
  ...hazards,
  ...surveillance,
  ...threats,
  ...network,
  ...maritime,
  ...flightPaths,
  ...intelPanels,
  ...reconPanels,
  ...hudPanels,
];

export function modulesForLayers(active: ReadonlySet<LayerId>): { module: FeatureModule; active: Set<LayerId> }[] {
  const out: { module: FeatureModule; active: Set<LayerId> }[] = [];
  for (const m of FEATURE_MODULES) {
    if (!m.Layer) continue;
    const on = new Set(m.layers.filter((id) => active.has(id)));
    if (on.size) out.push({ module: m, active: on });
  }
  return out;
}

export function cardFor(kind: EntityKind) {
  for (const m of FEATURE_MODULES) {
    const c = m.cards?.[kind];
    if (c) return c;
  }
  return null;
}

export function panelFor(id: PanelId) {
  for (const m of FEATURE_MODULES) {
    const p = m.panels?.[id];
    if (p) return p;
  }
  return null;
}
