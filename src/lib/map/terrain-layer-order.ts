/**
 * While terrain is attached, MapLibre drapes background/fill/line/raster/hillshade/color-relief
 * layers onto the terrain texture. Interleaving them with overlays makes it render the terrain
 * mesh in several passes, so batch the ground layers below every overlay and restore the original
 * order on release (newly added layers keep their insertion anchors). Port of OSIRIS
 * terrain-layer-order.ts. Owner: map-engine. Unit-tested with a fake map.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';

export const DRAPED_TYPES = new Set(['background', 'fill', 'line', 'raster', 'hillshade', 'color-relief']);

export type LayerOrderMap = Pick<MapLibreMap, 'getLayersOrder' | 'getLayer' | 'moveLayer' | 'on' | 'off'>;

/** Desired order: ground (draped) layers first, overlays after, stable within each group. */
export function drapedOrder(ids: readonly string[], typeOf: (id: string) => string | undefined): string[] {
  const ground: string[] = [];
  const overlays: string[] = [];
  for (const id of ids) (DRAPED_TYPES.has(typeOf(id) ?? '') ? ground : overlays).push(id);
  return [...ground, ...overlays];
}

export function batchTerrainLayers(map: LayerOrderMap): () => void {
  let originalOrder = map.getLayersOrder();
  let lastOrder: string[] = [];
  let reordering = false;
  let disposed = false;

  const rememberAddedLayers = (current: string[]) => {
    const surviving = new Set(current);
    originalOrder = originalOrder.filter((id) => surviving.has(id));
    const known = new Set(originalOrder);
    for (let i = current.length - 1; i >= 0; i--) {
      const id = current[i]!;
      if (known.has(id)) continue;
      const before = i + 1 < current.length ? originalOrder.indexOf(current[i + 1]!) : -1;
      originalOrder.splice(before < 0 ? originalOrder.length : before, 0, id);
      known.add(id);
    }
  };

  const applyOrder = (desired: string[], current: string[]) => {
    const order = [...current];
    for (let i = desired.length - 1; i >= 0; i--) {
      const id = desired[i]!;
      const index = order.indexOf(id);
      if (index < 0) continue;
      const before = desired[i + 1];
      if (order[index + 1] === before) continue;
      map.moveLayer(id, before);
      order.splice(index, 1);
      order.splice(before ? order.indexOf(before) : order.length, 0, id);
    }
  };

  const refresh = () => {
    if (disposed || reordering) return;
    const current = map.getLayersOrder();
    if (current.length === lastOrder.length && current.every((id, i) => id === lastOrder[i])) return;
    rememberAddedLayers(current);
    lastOrder = drapedOrder(current, (id) => map.getLayer(id)?.type);
    reordering = true;
    try {
      applyOrder(lastOrder, current);
    } finally {
      reordering = false;
    }
  };

  map.on('styledata', refresh);
  refresh();

  return () => {
    if (disposed) return;
    disposed = true;
    map.off('styledata', refresh);
    const current = map.getLayersOrder();
    rememberAddedLayers(current);
    applyOrder(originalOrder, current);
  };
}
