/**
 * Honest basemap state (R1-m2, §0.1). The vector basemap is fetched by the browser from
 * OpenFreeMap; when its tiles keep failing the globe would silently go blank. This tracker turns
 * the map's tile events into a BASEMAP OFFLINE state with the last time a tile actually arrived
 * (never a fabricated time) and a retry schedule with exponential backoff. The host shows the
 * chip, sets `data-basemap-state` and, when a retry is due, asks MapLibre again for the failed tiles
 * only (`retryTargets`: `map.refreshTiles(source, ids)`), never the whole viewport: OpenFreeMap is
 * a donation-funded host (R1r4-m2). Owner: map-engine. Pure and unit-tested.
 */

/** Consecutive tile failures (no tile in between) before the basemap is reported offline. */
export const BASEMAP_OFFLINE_AFTER = 3;
export const BASEMAP_RETRY_BASE_MS = 2000;
export const BASEMAP_RETRY_MAX_MS = 60_000;

/**
 * - `offline`: consecutive failures with no tile in between (the host is down);
 * - `incomplete`: some tiles in view failed while others loaded (holes in the globe: R3-m8);
 * - `stalled`: the tiles in view have not finished loading for `BASEMAP_STALL_MS` (nothing failed,
 *   nothing painted: R3-M2). Never an empty globe without a chip.
 */
export type BasemapState = 'ok' | 'offline' | 'incomplete' | 'stalled';

/** Tiles in view still loading after this long → BASEMAP LOADING chip. */
export const BASEMAP_STALL_MS = 10_000;

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/**
 * What a due retry re-requests: the failed tiles by id, or (only when the host is offline and no
 * tile id was reported, i.e. a source-level error) the whole source. `null` = nothing to retry.
 */
export function retryTargets(h: BasemapHealth, failed: TileId[]): TileId[] | 'source' | null {
  if (failed.length) return failed;
  return h.state === 'offline' ? 'source' : null;
}

const parseKey = (k: string): TileId | null => {
  const [z, x, y] = k.split('/').map(Number);
  return Number.isInteger(z) && Number.isInteger(x) && Number.isInteger(y) ? { z: z!, x: x!, y: y! } : null;
};

export interface BasemapHealth {
  state: BasemapState;
  /** Epoch ms of the last basemap tile that loaded, or null if none has yet. */
  lastGoodAt: number | null;
  /** Delay before the next retry while offline, else null. */
  retryInMs: number | null;
  /** Failed tiles not loaded since (distinct tile keys). */
  missing: number;
}

export function createBasemapHealth() {
  let failures = 0;
  let retries = 0;
  let lastGoodAt: number | null = null;
  let stalled = false;
  const failed = new Set<string>();
  const snapshot = (): BasemapHealth => {
    const state: BasemapState = failures >= BASEMAP_OFFLINE_AFTER ? 'offline' : failed.size ? 'incomplete' : stalled ? 'stalled' : 'ok';
    return {
      state,
      lastGoodAt,
      retryInMs: state === 'offline' || state === 'incomplete' ? Math.min(BASEMAP_RETRY_MAX_MS, BASEMAP_RETRY_BASE_MS * 2 ** retries) : null,
      missing: failed.size,
    };
  };
  return {
    /** A basemap tile (`key` = z/x/y when known) or the source failed to load. */
    tileError(key?: string): BasemapHealth {
      failures++;
      if (key) failed.add(key);
      return snapshot();
    },
    /** A basemap tile loaded at `now`. */
    tileLoaded(now: number, key?: string): BasemapHealth {
      failures = 0;
      if (key) failed.delete(key);
      if (!failed.size) retries = 0;
      lastGoodAt = now;
      return snapshot();
    },
    /** Whether the tiles in view have been loading for longer than BASEMAP_STALL_MS. */
    setStalled(on: boolean): BasemapHealth {
      stalled = on;
      return snapshot();
    },
    /**
     * The camera moved: forget the failed tiles. MapLibre requests the tiles newly in view by
     * itself, so nothing is reloaded here. Prefer `keepInView` when the tiles in view are known.
     */
    forgetMissing(): BasemapHealth {
      failed.clear();
      return snapshot();
    },
    /**
     * The camera moved: keep only the failed tiles MapLibre still holds for the view (`z/x/y`
     * keys); a failed tile that is still in view is still a hole and stays reported and retried.
     */
    keepInView(inView: ReadonlySet<string>): BasemapHealth {
      for (const k of failed) if (!inView.has(k)) failed.delete(k);
      if (!failed.size && failures < BASEMAP_OFFLINE_AFTER) retries = 0;
      return snapshot();
    },
    /** A retry was issued (the next one waits twice as long). */
    retried(): BasemapHealth {
      retries++;
      return snapshot();
    },
    /** The failed tiles not loaded since (`z/x/y` keys parsed), for a targeted refresh. */
    failedTiles(): TileId[] {
      return [...failed].map(parseKey).filter((t): t is TileId => t !== null);
    },
    get: snapshot,
  };
}

interface HeldTilesMap {
  style?: {
    tileManagers?: Record<string, { getIds(): string[]; getTileByID(id: string): { tileID?: { canonical?: TileId } } | undefined } | undefined>;
  };
}

/**
 * `z/x/y` keys of the tiles MapLibre currently holds for `sourceId` (the view plus retained
 * parents/children), or null when the tile manager is not reachable (then the caller forgets).
 */
export function heldTileKeys(map: unknown, sourceId: string): Set<string> | null {
  try {
    const tm = (map as HeldTilesMap | null)?.style?.tileManagers?.[sourceId];
    if (!tm) return null;
    const out = new Set<string>();
    for (const id of tm.getIds()) {
      const c = tm.getTileByID(id)?.tileID?.canonical;
      if (c) out.add(`${c.z}/${c.x}/${c.y}`);
    }
    return out;
  } catch {
    return null;
  }
}

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** Chip text: SOURCE OFFLINE wording with the last observed tile time, never a guessed one. */
export function basemapChipText(h: BasemapHealth): string | null {
  const last = h.lastGoodAt === null ? '' : ` · LAST TILE ${hhmm(h.lastGoodAt)} UTC`;
  switch (h.state) {
    case 'offline':
      return `BASEMAP OFFLINE${last} · RETRYING`;
    case 'incomplete':
      return `BASEMAP INCOMPLETE · ${h.missing} TILE${h.missing === 1 ? '' : 'S'} MISSING · RETRYING`;
    case 'stalled':
      return `BASEMAP LOADING${last}`;
    default:
      return null;
  }
}
