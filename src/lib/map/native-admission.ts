/**
 * First draw of each MapLibre layer type added after the basemap (perf B2). MapLibre links a
 * layer type's shader program the first time a layer of that type is drawn, synchronously inside
 * its render frame; on a software GPU a link behind queued frames blocks for seconds. Feature
 * modules add native layers (`circle`, `heatmap`, `fill-extrusion`, `raster`, …) whenever their data
 * arrives, so several new programs could land in one frame.
 *
 * `installNativeAdmission` wraps the map's `addLayer`/`setLayoutProperty`/`getLayoutProperty`/
 * `removeLayer`: a visible layer whose type has never been drawn is added with
 * `visibility: 'none'` (hidden layers draw nothing and link nothing) and its intended visibility is
 * kept; `admitNext()` (called by the admission scheduler in a quiet slot) reveals every waiting
 * layer of one type, so one new program per slot. Layers of a type already drawn (the basemap's
 * fill/line/symbol, or an admitted type) pass straight through, as do deck's `custom` layers
 * (admitted by the deck host) and `background`. Callers still see their own visibility through
 * `getLayoutProperty`; nothing is dropped. Owner: map-engine. Pure and unit-tested.
 */

type Visibility = 'visible' | 'none';

interface LayerSpecLike {
  id: string;
  type: string;
  layout?: { visibility?: unknown } & Record<string, unknown>;
}

/** The MapLibre `Map` subset this wraps (a real map or a test double). */
export interface NativeMapLike {
  addLayer(layer: never, beforeId?: string): unknown;
  removeLayer(id: string): unknown;
  setLayoutProperty(id: string, name: string, value: unknown, options?: unknown): unknown;
  getLayoutProperty(id: string, name: string): unknown;
  getLayer(id: string): { type: string } | undefined;
  getStyle(): { layers?: readonly LayerSpecLike[] } | undefined;
}

export interface NativeAdmission {
  /** Layer types waiting for their first draw (first-seen order). */
  pendingTypes(): string[];
  /** Reveal every waiting layer of the oldest waiting type; returns that type (null if none). */
  admitNext(): string | null;
  /** Restore the map's own methods and reveal anything still waiting. */
  uninstall(): void;
}

/** Never gated: deck's interleaved layers (deck admits its own classes) and plain backgrounds. */
const PASS_TYPES = new Set(['custom', 'background']);

const asVisibility = (v: unknown): Visibility => (v === 'none' ? 'none' : 'visible');

export function installNativeAdmission(map: NativeMapLike, onChange: () => void): NativeAdmission {
  const orig = {
    addLayer: map.addLayer,
    removeLayer: map.removeLayer,
    setLayoutProperty: map.setLayoutProperty,
    getLayoutProperty: map.getLayoutProperty,
  };
  const admitted = new Set<string>();
  /** id → {type, intended visibility} for layers held hidden. */
  const held = new Map<string, { type: string; visibility: Visibility }>();
  const order: string[] = [];

  /** A type counts as drawn once admitted, or if some visible style layer of it is not held. */
  const drawn = (type: string): boolean => {
    if (PASS_TYPES.has(type) || admitted.has(type)) return true;
    const layers = map.getStyle()?.layers ?? [];
    if (layers.some((l) => l.type === type && !held.has(l.id) && asVisibility(l.layout?.visibility) === 'visible')) {
      admitted.add(type);
      return true;
    }
    return false;
  };
  const hold = (id: string, type: string, visibility: Visibility) => {
    held.set(id, { type, visibility });
    if (!order.includes(type)) order.push(type);
  };
  const prune = () => {
    for (let i = order.length - 1; i >= 0; i--) if (![...held.values()].some((h) => h.type === order[i])) order.splice(i, 1);
  };

  map.addLayer = function (this: unknown, layer: never, beforeId?: string) {
    const spec = layer as unknown as LayerSpecLike;
    if (!spec || typeof spec.type !== 'string' || asVisibility(spec.layout?.visibility) === 'none' || drawn(spec.type)) {
      return orig.addLayer.call(map, layer, beforeId);
    }
    const out = orig.addLayer.call(map, { ...spec, layout: { ...spec.layout, visibility: 'none' } } as never, beforeId);
    hold(spec.id, spec.type, 'visible');
    onChange();
    return out;
  } as NativeMapLike['addLayer'];

  map.setLayoutProperty = function (this: unknown, id: string, name: string, value: unknown, options?: unknown) {
    if (name === 'visibility') {
      const h = held.get(id);
      if (h) {
        h.visibility = asVisibility(value);
        return map;
      }
      const type = map.getLayer(id)?.type;
      if (type && asVisibility(value) === 'visible' && !drawn(type)) {
        hold(id, type, 'visible');
        onChange();
        return map;
      }
    }
    return orig.setLayoutProperty.call(map, id, name, value, options);
  } as NativeMapLike['setLayoutProperty'];

  map.getLayoutProperty = function (this: unknown, id: string, name: string) {
    const h = name === 'visibility' ? held.get(id) : undefined;
    return h ? h.visibility : orig.getLayoutProperty.call(map, id, name);
  } as NativeMapLike['getLayoutProperty'];

  map.removeLayer = function (this: unknown, id: string) {
    if (held.delete(id)) {
      prune();
      onChange();
    }
    return orig.removeLayer.call(map, id);
  } as NativeMapLike['removeLayer'];

  const reveal = (type: string) => {
    admitted.add(type);
    for (const [id, h] of [...held]) {
      if (h.type !== type) continue;
      held.delete(id);
      if (h.visibility === 'visible' && map.getLayer(id)) orig.setLayoutProperty.call(map, id, 'visibility', 'visible');
    }
    prune();
  };

  return {
    pendingTypes: () => [...order],
    admitNext() {
      const type = order[0];
      if (type === undefined) return null;
      reveal(type);
      onChange();
      return type;
    },
    uninstall() {
      map.addLayer = orig.addLayer;
      map.removeLayer = orig.removeLayer;
      map.setLayoutProperty = orig.setLayoutProperty;
      map.getLayoutProperty = orig.getLayoutProperty;
      for (const type of [...order]) reveal(type);
    },
  };
}
