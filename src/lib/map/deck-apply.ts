/**
 * Hand deck its layers without waiting for every basemap tile (visual-qa R3-M2).
 *
 * `MapLibreOverlay.setProps({layers})` in interleaved mode inserts one MapLibre custom layer
 * ("layer group") per `beforeId`, but only when `map.isStyleLoaded()` is true, and that is false
 * while ANY tile of ANY source is loading, retrying or hung. Its own retry runs on `styledata`
 * only, which a tile finishing does not emit. So a single slow basemap tile (common on the globe at
 * z ≥ 3, where many tiles are in view) left every deck layer outside the style: instantiated and
 * counted, never drawn. Adding a custom layer only needs the style to be parsed, so for the
 * duration of that call `isStyleLoaded` answers "style parsed" (`styleParsed`). Nothing else on
 * the map sees the override.
 *
 * `missingDeckGroups` lists the groups deck needs that are not in the style yet: the host treats
 * the layers behind them as not drawn (the header must not count them). Owner: map-engine. Pure and
 * unit-tested.
 */
import { styleParsed } from './ready';

/** The map surface used here (a real MapLibre map satisfies it). */
export interface ApplyMap {
  isStyleLoaded: () => boolean | void;
  getLayer: (id: string) => unknown;
}

/** deck's group id for a layer (same rule as @deck.gl/maplibre `getMapLibreLayerGroupId`). */
export function deckGroupId(layer: { props: object }): string {
  const before = (layer.props as { beforeId?: unknown }).beforeId;
  return typeof before === 'string' && before ? `deck-maplibre-layer-group-before:${before}` : 'deck-maplibre-layer-group-last';
}

/** Run `fn` (an overlay `setProps`) with `isStyleLoaded` meaning "style parsed". */
export function withParsedStyle<T>(map: ApplyMap | null | undefined, fn: () => T): T {
  if (!map) return fn();
  const own = Object.prototype.hasOwnProperty.call(map, 'isStyleLoaded');
  const prev = map.isStyleLoaded;
  map.isStyleLoaded = () => styleParsed(map);
  try {
    return fn();
  } finally {
    if (own) map.isStyleLoaded = prev;
    else delete (map as Partial<ApplyMap>).isStyleLoaded;
  }
}

/** Group ids the given deck layers need that the style does not contain yet. */
export function missingDeckGroups(map: Pick<ApplyMap, 'getLayer'> | null | undefined, layers: readonly { props: object }[]): string[] {
  if (!map) return [];
  const out: string[] = [];
  for (const l of layers) {
    const id = deckGroupId(l);
    if (!out.includes(id) && !map.getLayer(id)) out.push(id);
  }
  return out;
}
