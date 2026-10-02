/**
 * Map readiness without waiting for tiles or `idle` (R1r3-M1). `idle` needs every tile settled and
 * nothing animating, and `load`/`isStyleLoaded()` stay false while ANY tile of ANY source is still
 * loading, so one hung tile host or a 1 Hz animated layer could postpone them forever. The host's
 * ready signal is therefore "style JSON parsed" (`style.load`, or `styleParsed()` for a style that
 * finished before we subscribed): sources and layers can be added from then on. That is what
 * `useMapInstance()`, `data-map-ready` and `data-style-ready` mean; tiles may still be loading
 * (the basemap health chip reports that). `onceBasemapPainted` is the separate, capped "first
 * frame with basemap tiles" signal that gates the data layers' GPU start-up (their fetches start
 * with the map host, perf L96); `onceFirstFrame` ("a globe frame
 * has been drawn") gates the user's own focus layers (`focus.ts`). Owner: map-engine. Unit-tested
 * with a fake map.
 */

export interface StyleEventsMap {
  once(type: 'style.load' | 'load', fn: () => void): unknown;
  off(type: 'style.load' | 'load', fn: () => void): unknown;
}

/**
 * Call `onReady` once, as soon as the style is parsed: immediately when it already is, else on
 * `style.load` (or `load`, whichever comes first). Never waits for tiles. Returns cancel.
 */
export function onceStyleParsed(map: StyleEventsMap, onReady: () => void): () => void {
  let done = false;
  const fire = () => {
    if (done) return;
    cancel();
    onReady();
  };
  const cancel = () => {
    done = true;
    map.off('style.load', fire);
    map.off('load', fire);
  };
  if (styleParsed(map)) {
    fire();
    return cancel;
  }
  map.once('style.load', fire);
  map.once('load', fire);
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

/** The part of the map-instance store `publishMapReady` touches. */
export interface ReadyHost {
  map: unknown;
  setReady: (ready: boolean) => void;
}

/**
 * Publish the parsed map as ready for feature modules (`useMapInstance()`, `data-map-ready`), once
 * the admission queue that holds their native layers' first draws is installed (perf L96: the
 * modules are mounted before the map exists, so their feeds load during start-up, and add native
 * layers the moment the map is ready). Only for the map the store holds: a WebGL retry's stale
 * effect publishes nothing. Returns whether it published.
 */
export function publishMapReady(host: ReadyHost, map: unknown, el: HTMLElement | null | undefined): boolean {
  if (!map || host.map !== map) return false;
  host.setReady(true);
  if (el) el.dataset.mapReady = 'true';
  return true;
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
 * data layers back). The data layers' GPU set-up (deck device, native layer types) waits for this
 * so it does not starve the globe's first frame (visual-qa R2-M6). Returns cancel.
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

/**
 * Call `cb` once the map has rendered a frame after this call (the globe's first frame needs the
 * parsed style only, no tiles), immediately when everything has loaded, and never later than
 * `capMs` (a still map renders nothing new). Focus work (the user's route) waits for this instead
 * of the basemap's first painted tile: it must not starve the first globe frame (visual-qa R2-M6),
 * but it need not wait for a tile host either. Returns cancel.
 */
export function onceFirstFrame(map: PaintMap, cb: () => void, capMs: number, timers: PaintTimers = realPaintTimers): () => void {
  let done = false;
  let timer: unknown = null;
  const cancel = () => {
    done = true;
    if (timer !== null) timers.clearTimeout(timer);
    map.off('render', finish);
    map.off('load', finish);
  };
  function finish() {
    if (done) return;
    cancel();
    cb();
  }
  if (map.loaded()) {
    finish();
    return cancel;
  }
  timer = timers.setTimeout(finish, capMs);
  map.on('render', finish);
  map.on('load', finish);
  return cancel;
}
