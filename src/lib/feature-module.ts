/**
 * How features plug into the shell without touching shared files.
 *
 * Each owner exports ONE `FeatureModule[]` (default export) from its entry file:
 *   layers-aviation                      → src/features/aviation/index.ts
 *   layers-space                         → src/features/space/index.ts
 *   layers-hazards                       → src/features/hazards/index.ts
 *   layers-surveillance                  → src/features/surveillance/index.ts
 *   layers-threats-network               → src/features/{threats,network,maritime}/index.ts
 *   feature-flight-paths                 → src/features/flight-paths/index.ts
 *   panels-alerts-markets-dossier-graph  → src/components/panels/intel/index.ts
 *   panels-recon                         → src/components/panels/recon/index.ts
 *   design-system-hud                    → src/components/hud/modules.ts
 * src/features/registry.ts (lead) concatenates them. The map host (map-engine) mounts each
 * module's `Layer` component inside the map context while any of its layer ids is active;
 * the HUD resolves cards by entity kind and panels by panel id.
 */
import type { ComponentType } from 'react';
import type { LayerId } from './layer-registry';
import type { PanelId } from './tool-registry';
import type { EntityKind } from './types';
import type { Selection } from './layer-host';

export interface LayerComponentProps {
  /** The subset of this module's layer ids that are currently switched on. */
  active: ReadonlySet<LayerId>;
}

export interface CardProps {
  selection: Selection;
}

export interface PanelProps {
  onClose: () => void;
}

export interface FeatureModule {
  /** Unique module key, e.g. `aviation`. Also the deck layer-group key. */
  id: string;
  /** Layer ids this module renders (must exist in LAYERS). */
  layers: readonly LayerId[];
  /**
   * Rendered inside the map provider while any of `layers` is active. Fetches its own data
   * (react-query, polling per registry refreshMs, paused when hidden), publishes deck layers via
   * useDeckLayers(), manages native MapLibre layers via useMapInstance(), and reports status via
   * useLayerStatus(). Renders null or DOM overlays (preview tiles).
   * Mounted as soon as the map style is parsed, so its fetches overlap the GL start-up. Its GPU work
   * (deck device and classes, first draw of new native layer types) waits in the admission queue for
   * the basemap's first painted frame and is counted as pending meanwhile (RECEIVED + DRAWING).
   * Clickable entities never listen to `click` themselves: they register with the map's single
   * router in src/lib/map/picking.ts — a `toSelection(info)` prop on deck layers (or
   * `registerDeckPick(deckLayerId, fn)`), `registerNativePick(styleLayerId, fn)` for native layers,
   * `registerHitTester(id, (point, map) => PickCandidate[])` for CPU hit-tests — and the host
   * opens one card per click by registry pickPriority (far side of the globe excluded).
   */
  Layer?: ComponentType<LayerComponentProps>;
  /** Mounted once regardless of layer state (e.g. an SSE subscription feeding the Intel Feed). */
  Background?: ComponentType;
  /** Entity card bodies by kind (the HUD supplies the Overview/Track/Sources frame). */
  cards?: Partial<Record<EntityKind, ComponentType<CardProps>>>;
  /** Panels by id (right-rail tools and floating panels). Lazy-load heavy ones with next/dynamic. */
  panels?: Partial<Record<PanelId, ComponentType<PanelProps>>>;
}

export function defineModule(m: FeatureModule): FeatureModule {
  return m;
}
