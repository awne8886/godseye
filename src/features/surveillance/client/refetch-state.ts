/**
 * Freshness of data react-query kept after a failed refetch. When a refetch throws (a 502/500 from
 * a reverse proxy or the app, a network error, a region still pending after its retries),
 * react-query keeps the previous `data`, so the payload's `meta.state` is the previous answer's:
 * reading it would keep the layer LIVE for as long as the server stays unreachable (verification
 * round 8, BLOCKING). Such data is shown with its last-good time, but at best STALE.
 * Owner: layers-surveillance.
 */
import type { FreshnessState } from '@/lib/types';

const RANK: Record<FreshnessState, number> = { live: 0, reference: 0, recent: 1, stale: 2, offline: 3 };

/**
 * True when retained data no longer reflects the server: the last fetch failed for good
 * (`isError`) or the current one has already failed at least once and is waiting for a retry
 * (`failureCount` restarts at 0 with every new fetch and on success).
 */
export function lastFetchFailed(q: { data?: unknown; isError: boolean; failureCount: number }): boolean {
  return q.data !== undefined && (q.isError || q.failureCount > 0);
}

/** The state of retained data whose refresh failed: never fresher than STALE. */
export function atMostStale(state: FreshnessState): FreshnessState {
  return RANK[state] < RANK.stale ? 'stale' : state;
}

/** Worst (oldest) of several states; `live` for none. */
export function worstState(states: readonly FreshnessState[]): FreshnessState {
  return states.reduce<FreshnessState>((w, s) => (RANK[s] > RANK[w] ? s : w), 'live');
}
