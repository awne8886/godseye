/**
 * Honest rail status for the aviation layers (MAJOR-C): how many aircraft per bucket are past the
 * 60 s dead-reckoning cap (drawn frozen and dimmed), and the layer state derived from that share.
 * A layer whose positions are mostly older than the cap must not read LIVE.
 */
import type { FreshnessState } from '@/lib/types';
import type { Bucket } from '../classify';
import { BUCKETS, MAX_DEAD_RECKON_S } from '../codec';

/** Above this share of positions past the cap a LIVE feed reads RECENT (age shown, gold). */
export const STALE_MAJORITY = 0.5;
/** At or above this share the layer reads STALE. */
export const STALE_MOSTLY = 0.9;

export type StaleCounts = Record<Bucket, number>;

/**
 * Aircraft past the cap per bucket, from the frame's per-record observation times (s epoch) and
 * bucket indices (into BUCKETS). Allocation-free apart from the result object.
 */
export function countStaleByBucket(seen: Float64Array, bucket: Uint8Array, nowMs: number): StaleCounts {
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as StaleCounts;
  const cutoff = nowMs / 1000 - MAX_DEAD_RECKON_S;
  for (let i = 0; i < seen.length; i++) {
    if (seen[i]! < cutoff) out[BUCKETS[bucket[i]!]!]++;
  }
  return out;
}

export function staleKey(c: StaleCounts): string {
  return BUCKETS.map((b) => c[b]).join(',');
}

const RANK: Record<FreshnessState, number> = { live: 0, reference: 0, recent: 1, stale: 2, offline: 3 };

/**
 * Layer state from the feed state and the stale share: never better than the feed's own state;
 * a majority past the cap downgrades LIVE to RECENT, ≥ 90 % to STALE.
 */
export function deriveLayerState(feedState: FreshnessState, total: number, stale: number): FreshnessState {
  if (total <= 0) return feedState;
  const share = stale / total;
  const own: FreshnessState = share >= STALE_MOSTLY ? 'stale' : share > STALE_MAJORITY ? 'recent' : 'live';
  return RANK[own] > RANK[feedState] ? own : feedState;
}
