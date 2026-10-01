/**
 * Honest basemap state (R1-m2, §0.1). The vector basemap is fetched by the browser from
 * OpenFreeMap; when its tiles keep failing the globe would silently go blank. This tracker turns
 * the map's tile events into a BASEMAP OFFLINE state with the last time a tile actually arrived
 * (never a fabricated time) and a retry schedule with exponential backoff. The host shows the
 * chip, sets `data-basemap-state` and calls `map.refreshTiles(source)` when a retry is due.
 * Owner: map-engine. Pure and unit-tested.
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
    /** The camera moved: forget the failed tiles (the host re-requests the tiles now in view). */
    forgetMissing(): BasemapHealth {
      failed.clear();
      return snapshot();
    },
    /** A retry was issued (the next one waits twice as long). */
    retried(): BasemapHealth {
      retries++;
      return snapshot();
    },
    get: snapshot,
  };
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
