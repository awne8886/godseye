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

export type BasemapState = 'ok' | 'offline';

export interface BasemapHealth {
  state: BasemapState;
  /** Epoch ms of the last basemap tile that loaded, or null if none has yet. */
  lastGoodAt: number | null;
  /** Delay before the next retry while offline, else null. */
  retryInMs: number | null;
}

export function createBasemapHealth() {
  let failures = 0;
  let retries = 0;
  let lastGoodAt: number | null = null;
  const snapshot = (): BasemapHealth => {
    const offline = failures >= BASEMAP_OFFLINE_AFTER;
    return {
      state: offline ? 'offline' : 'ok',
      lastGoodAt,
      retryInMs: offline ? Math.min(BASEMAP_RETRY_MAX_MS, BASEMAP_RETRY_BASE_MS * 2 ** retries) : null,
    };
  };
  return {
    /** A basemap tile (or the source) failed to load. */
    tileError(): BasemapHealth {
      failures++;
      return snapshot();
    },
    /** A basemap tile loaded at `now`. */
    tileLoaded(now: number): BasemapHealth {
      failures = 0;
      retries = 0;
      lastGoodAt = now;
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
  if (h.state !== 'offline') return null;
  return h.lastGoodAt === null ? 'BASEMAP OFFLINE · RETRYING' : `BASEMAP OFFLINE · LAST TILE ${hhmm(h.lastGoodAt)} UTC · RETRYING`;
}
