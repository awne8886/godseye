'use client';
/**
 * Selection helpers for hazards layers. Deck picks and native MapLibre polygon clicks can both fire
 * for one click; the deck point (higher pickPriority) wins and the polygon handler backs off.
 * Owner: layers-hazards.
 */
import type { LayerId } from '@/lib/layer-registry';
import { useSelectionStore } from '@/lib/layer-host';
import type { EntityKind } from '@/lib/types';

let lastPointPick = 0;

export function selectEntity(
  kind: EntityKind,
  layer: LayerId,
  entity: { id: string; lat: number; lng: number; source: string; observedAt: string | null },
  data: Record<string, unknown>,
  fromPoint = true,
): void {
  if (fromPoint) lastPointPick = performance.now();
  useSelectionStore.getState().select({ kind, id: entity.id, layer, source: entity.source, observedAt: entity.observedAt, data, lngLat: [entity.lng, entity.lat] });
}

/** True when a point layer handled this same click (within one frame or so). */
export function pointJustPicked(): boolean {
  return performance.now() - lastPointPick < 80;
}
