/**
 * Splash readiness (§7): map idle + the first two core feeds answered (or every active feed layer
 * when fewer than two are on), with a hard cap. Pure for unit tests. Owner: design-system-hud.
 */
import { getLayer } from '@/lib/layer-registry';

export const SPLASH_MIN_MS = 2200;
export const SPLASH_CAP_MS = 7000;
/** Exit: opacity 0 + scale 1.04 (base.css `.splash-screen[data-exiting]`). */
export const SPLASH_EXIT_MS = 700;
export const SPLASH_STAGES = ['ESTABLISHING UPLINK…', 'INITIALIZING FEEDS…', 'CALIBRATING SENSORS…', 'SYSTEM READY'] as const;

/** Active layers that fetch a feed (a route), whose first answer counts toward readiness. */
export function feedLayers(active: Iterable<string>): string[] {
  return [...active].filter((id) => getLayer(id)?.route);
}

/** How many feed layers have answered at least once (live, stale, offline… anything but idle/loading). */
export function answered(ids: readonly string[], status: Partial<Record<string, { state: string }>>): number {
  return ids.filter((id) => {
    const s = status[id]?.state;
    return s !== undefined && s !== 'idle' && s !== 'loading';
  }).length;
}

export function feedsReady(active: Iterable<string>, status: Partial<Record<string, { state: string }>>): boolean {
  const ids = feedLayers(active);
  return answered(ids, status) >= Math.min(2, ids.length);
}

/** 0 uplink → 1 feeds → 2 sensors (map idle) → 3 ready (map idle + feeds). */
export function splashStage(o: { elapsedMs: number; mapReady: boolean; feedsReady: boolean }): 0 | 1 | 2 | 3 {
  if (o.mapReady && o.feedsReady && o.elapsedMs >= SPLASH_MIN_MS) return 3;
  if (o.mapReady) return 2;
  return o.elapsedMs >= 1100 ? 1 : 0;
}
