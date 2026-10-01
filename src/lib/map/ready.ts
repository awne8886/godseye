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

type PaintEvent = { sourceId?: string; tile?: unknown };

export interface PaintMap {
  on(type: 'sourcedata' | 'render' | 'load', fn: (e?: PaintEvent) => void): unknown;
  off(type: 'sourcedata' | 'render' | 'load', fn: (e?: PaintEvent) => void): unknown;
  loaded(): boolean;
}

export interface PaintTimers {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const realPaintTimers: PaintTimers = {
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * Call `cb` once the basemap has been painted: the first frame rendered after a tile of
 * `sourceId` arrived (or `load`), and never later than `capMs` (a hung tile host must not hold the
 * data layers back). Feature start-up (fetch, parse, GPU set-up) waits for this so it does not
 * starve the globe's first frame (visual-qa R2-M6). Returns cancel.
 */
export function onceBasemapPainted(map: PaintMap, sourceId: string, cb: () => void, capMs: number, timers: PaintTimers = realPaintTimers): () => void {
  let done = false;
  let tileSeen = false;
  let timer: unknown = null;
  const cancel = () => {
    done = true;
    if (timer !== null) timers.clearTimeout(timer);
    map.off('sourcedata', onData);
    map.off('render', onRender);
    map.off('load', finish);
  };
  function finish() {
    if (done) return;
    cancel();
    cb();
  }
  function onData(e?: PaintEvent) {
    if (e?.sourceId === sourceId && e.tile) tileSeen = true;
  }
  function onRender() {
    if (tileSeen) finish();
  }
  if (map.loaded()) {
    finish();
    return cancel;
  }
  timer = timers.setTimeout(finish, capMs);
  map.on('sourcedata', onData);
  map.on('render', onRender);
  map.on('load', finish);
  return cancel;
}
