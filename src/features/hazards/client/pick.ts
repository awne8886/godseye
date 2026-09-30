'use client';
/**
 * The Selection for a hazards entity (the HUD resolves the card by kind). Hit-testers return it
 * as a pick candidate; the map's single click router opens the winner. Owner: layers-hazards.
 */
import type { LayerId } from '@/lib/layer-registry';
import { type Selection, useSelectionStore } from '@/lib/layer-host';
import type { EntityKind } from '@/lib/types';

type Entity = { id: string; lat: number; lng: number; source: string; observedAt: string | null };

export function entitySelection(kind: EntityKind, layer: LayerId, entity: Entity, data: Record<string, unknown>): Selection {
  return { kind, id: entity.id, layer, source: entity.source, observedAt: entity.observedAt, data, lngLat: [entity.lng, entity.lat] };
}

/** Open a hazards entity's card directly (lists and panels; map clicks go through the router). */
export function selectEntity(kind: EntityKind, layer: LayerId, entity: Entity, data: Record<string, unknown>): void {
  useSelectionStore.getState().select(entitySelection(kind, layer, entity, data));
}
