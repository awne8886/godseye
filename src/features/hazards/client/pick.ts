'use client';
/** Opens an entity card for a hazards entity (the HUD resolves the card by kind). Owner: layers-hazards. */
import type { LayerId } from '@/lib/layer-registry';
import { useSelectionStore } from '@/lib/layer-host';
import type { EntityKind } from '@/lib/types';

export function selectEntity(
  kind: EntityKind,
  layer: LayerId,
  entity: { id: string; lat: number; lng: number; source: string; observedAt: string | null },
  data: Record<string, unknown>,
): void {
  useSelectionStore.getState().select({ kind, id: entity.id, layer, source: entity.source, observedAt: entity.observedAt, data, lngLat: [entity.lng, entity.lat] });
}
