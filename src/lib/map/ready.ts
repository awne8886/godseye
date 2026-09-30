/**
 * Map readiness without waiting for `idle`. `idle` needs every tile settled and nothing
 * animating, so a permanently failing tile host or a 1 Hz animated layer can postpone it forever;
 * `load` + `isStyleLoaded()` is the honest "style, sprite and sources are in" signal that feature
 * modules need before adding sources and layers. Owner: map-engine. Unit-tested with a fake map.
 */

export interface ReadyMap {
  isStyleLoaded: () => boolean | void;
  on: (type: 'styledata' | 'sourcedata' | 'data', fn: () => void) => unknown;
  off: (type: 'styledata' | 'sourcedata' | 'data', fn: () => void) => unknown;
}

/**
 * Call `onReady` once, as soon as `map.isStyleLoaded()` is true (immediately when it already is,
 * which is the normal case right after `load`). Returns a cancel function.
 */
export function onceStyleLoaded(map: ReadyMap, onReady: () => void): () => void {
  if (map.isStyleLoaded()) {
    onReady();
    return () => undefined;
  }
  let done = false;
  const check = () => {
    if (done || !map.isStyleLoaded()) return;
    cancel();
    onReady();
  };
  const cancel = () => {
    done = true;
    map.off('styledata', check);
    map.off('sourcedata', check);
  };
  map.on('styledata', check);
  map.on('sourcedata', check);
  return cancel;
}

/**
 * True once MapLibre has parsed the style JSON (sources and layers exist and can be added to),
 * even while tiles, sprite or glyphs are still loading. Reads the style's internal `_loaded` flag:
 * `style.load` may already have fired before a late subscriber attached.
 */
export function styleParsed(map: unknown): boolean {
  const style = (map as { style?: { _loaded?: boolean } } | null)?.style;
  return !!style?._loaded;
}
