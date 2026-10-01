/**
 * Map tile events → honest per-source tile health (`basemap-health.ts`), for the basemap and the
 * imagery overlays (Esri World Imagery, GIBS true colour, Black Marble night lights).
 *
 *  - every source: a failed tile (MapLibre reports non-404 failures with the tile) counts as a hole
 *    until it loads; repeated failures with nothing in between read SOURCE OFFLINE (with the last
 *    tile that really arrived); holes still in view are retried by tile id with backoff, never the
 *    whole viewport (R1r4-m2); a camera move forgets holes that left the view;
 *  - `firstPaint` (the basemap): `loading` from the moment the map exists until the first frame
 *    rendered after one of its tiles arrived (visual-qa round-4 m7 / round-5 m3: never a blank globe
 *    with no chip for 10 s);
 *  - `stall` (the basemap): tiles in view still loading after BASEMAP_STALL_MS read LOADING;
 *  - imagery overlays (visual-qa round-5 m10): their holes were silent; the host appends
 *    `· N TILES MISSING` / `· SOURCE OFFLINE` to their dated chips (`imageryChipText`).
 *
 * Pure wiring over a map-like object, unit-tested with a fake map and fake timers. Owner: map-engine.
 */
import { BASEMAP_STALL_MS, type BasemapHealth, createBasemapHealth, heldTileKeys, retryTargets, type TileId } from './basemap-health';

type Handler = (e?: unknown) => void;

/** The MapLibre `Map` subset this watches (a real map satisfies it). */
export interface TileWatchMap {
  on(type: 'error' | 'sourcedata' | 'moveend' | 'render', fn: Handler): unknown;
  off(type: 'error' | 'sourcedata' | 'moveend' | 'render', fn: Handler): unknown;
  getSource(id: string): unknown;
  isSourceLoaded(id: string): boolean;
  refreshTiles(id: string, tiles?: TileId[]): unknown;
  loaded(): boolean;
}

export interface WatchedSource {
  id: string;
  /** Report tiles in view still loading after BASEMAP_STALL_MS (BASEMAP LOADING). */
  stall?: boolean;
  /** Read `loading` until a frame with this source's tiles has been painted. */
  firstPaint?: boolean;
}

export interface TileWatchTimers {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  now(): number;
}

const realTimers: TileWatchTimers = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  now: () => Date.now(),
};

export interface TileWatch {
  /** Current health of a watched source. */
  get(id: string): BasemapHealth | null;
  /** Forget a source's holes and failures (it was switched off: none of them is on screen). */
  reset(id: string): void;
  dispose(): void;
}

/** How often the stall check looks at the sources that report stalls. */
export const STALL_CHECK_MS = 1000;

const tileKey = (e: unknown): string | undefined => {
  const c = (e as { tile?: { tileID?: { canonical?: { z: number; x: number; y: number } } } } | undefined)?.tile?.tileID?.canonical;
  return c ? `${c.z}/${c.x}/${c.y}` : undefined;
};

const minute = (ms: number | null) => (ms === null ? '' : String(Math.floor(ms / 60_000)));

/** What the chip shows changes only with these (the last tile time at minute precision). */
const shownKey = (h: BasemapHealth) => (h.state === 'ok' ? 'ok' : `${h.state}|${h.missing}|${minute(h.lastGoodAt)}`);

export function watchTileSources(
  map: TileWatchMap,
  sources: readonly WatchedSource[],
  onChange: (id: string, h: BasemapHealth) => void,
  timers: TileWatchTimers = realTimers,
): TileWatch {
  interface Entry {
    spec: WatchedSource;
    health: ReturnType<typeof createBasemapHealth>;
    timer: unknown;
    shown: string;
    tileSeen: boolean;
    loadingSince: number | null;
  }
  const alreadyLoaded = (() => {
    try {
      return map.loaded();
    } catch {
      return false;
    }
  })();
  const entries = new Map<string, Entry>();
  const fresh = (spec: WatchedSource, painted: boolean): Entry => ({
    spec,
    health: createBasemapHealth({ painted }),
    timer: null,
    shown: '',
    tileSeen: false,
    loadingSince: null,
  });
  const publish = (e: Entry, h: BasemapHealth) => {
    const key = shownKey(h);
    if (key === e.shown) return;
    e.shown = key;
    onChange(e.spec.id, h);
  };
  const clearRetry = (e: Entry) => {
    if (e.timer !== null) timers.clearTimeout(e.timer);
    e.timer = null;
  };
  // Ask again for the failed tiles only: a whole-viewport reload re-downloads every tile in view.
  const retry = (e: Entry, h: BasemapHealth) => {
    if (h.retryInMs === null || e.timer !== null) return;
    e.timer = timers.setTimeout(() => {
      e.timer = null;
      const targets = retryTargets(e.health.get(), e.health.failedTiles());
      e.health.retried();
      if (!targets || !map.getSource(e.spec.id)) return;
      if (targets === 'source') map.refreshTiles(e.spec.id);
      else map.refreshTiles(e.spec.id, targets);
    }, h.retryInMs);
  };
  for (const spec of sources) {
    const e = fresh(spec, !spec.firstPaint || alreadyLoaded);
    entries.set(spec.id, e);
    publish(e, e.health.get());
  }

  const onError: Handler = (ev) => {
    const e = entries.get((ev as { sourceId?: string } | undefined)?.sourceId ?? '');
    if (!e) return;
    const h = e.health.tileError(tileKey(ev));
    publish(e, h);
    retry(e, h);
  };
  const onData: Handler = (ev) => {
    const d = ev as { sourceId?: string; tile?: unknown } | undefined;
    const e = entries.get(d?.sourceId ?? '');
    if (!e || !d?.tile) return;
    e.tileSeen = true;
    const h = e.health.tileLoaded(timers.now(), tileKey(ev));
    if (h.retryInMs === null) clearRetry(e);
    publish(e, h);
  };
  // The first frame rendered after a tile of the source arrived: it is on screen now.
  const onRender: Handler = () => {
    for (const e of entries.values()) {
      if (!e.tileSeen || e.health.isPainted()) continue;
      publish(e, e.health.markPainted());
    }
  };
  // Failed tiles out of view no longer matter (MapLibre requests the new view itself); failed
  // tiles still in view stay reported and are retried by id on the next tick.
  const onMoveEnd: Handler = () => {
    for (const e of entries.values()) {
      if (e.health.get().missing === 0) continue;
      const held = heldTileKeys(map, e.spec.id);
      const h = held ? e.health.keepInView(held) : e.health.forgetMissing();
      publish(e, h);
      retry(e, h);
    }
  };
  const stallers = [...entries.values()].filter((e) => e.spec.stall);
  const stallCheck = stallers.length
    ? timers.setInterval(() => {
        const now = timers.now();
        for (const e of stallers) {
          let busy = false;
          try {
            busy = !!map.getSource(e.spec.id) && !map.isSourceLoaded(e.spec.id);
          } catch {
            busy = false;
          }
          e.loadingSince = busy ? (e.loadingSince ?? now) : null;
          publish(e, e.health.setStalled(e.loadingSince !== null && now - e.loadingSince >= BASEMAP_STALL_MS));
        }
      }, STALL_CHECK_MS)
    : null;
  map.on('error', onError);
  map.on('sourcedata', onData);
  map.on('render', onRender);
  map.on('moveend', onMoveEnd);

  return {
    get: (id) => entries.get(id)?.health.get() ?? null,
    reset(id) {
      const old = entries.get(id);
      if (!old) return;
      clearRetry(old);
      const e = fresh(old.spec, true);
      e.shown = old.shown;
      entries.set(id, e);
      const i = stallers.indexOf(old);
      if (i >= 0) stallers[i] = e;
      publish(e, e.health.get());
    },
    dispose() {
      for (const e of entries.values()) clearRetry(e);
      if (stallCheck !== null) timers.clearInterval(stallCheck);
      map.off('error', onError);
      map.off('sourcedata', onData);
      map.off('render', onRender);
      map.off('moveend', onMoveEnd);
    },
  };
}
