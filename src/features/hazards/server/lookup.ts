/**
 * Keyed lookups (air quality by bbox, gpsjam by date, Sentinel scenes by point) cached with
 * sourceCache and reported with the same `meta` + `providers` envelope as feeds, so routes can
 * answer through feedJson (503 SOURCE OFFLINE when nothing was ever obtained). The cache is
 * bounded by sourceCache's L1 LRU. Owner: layers-hazards. Server-only.
 */
import 'server-only';
import { sourceCache, type SourceCache } from '@/lib/cache';
import type { CapabilityId } from '@/lib/capabilities';
import type { FeedData, FeedResult, ProviderRun } from '@/lib/feeds';
import { freshnessState, toIso } from '@/lib/freshness';
import type { Attribution, FeedMeta, Providers } from '@/lib/types';

export interface LookupDef<T> {
  /** Feed-like name reported in meta.feed, e.g. `air-quality`. */
  feed: string;
  ttlMs: number;
  attribution: Attribution[];
  note?: string;
  /** Treat as a failed lookup (default: never; use for "every provider failed"). */
  isEmpty?: (d: T) => boolean;
  deadlineMs?: number;
  /** Capabilities of the gated providers in run(): a snapshot fetched under another gate state is never served. */
  gates?: readonly CapabilityId[];
  run: (signal: AbortSignal) => Promise<FeedData<T>>;
}

const CACHES = new Map<string, SourceCache<unknown>>();

export async function lookup<T>(key: string, def: LookupDef<T>): Promise<FeedResult<T>> {
  let cache = CACHES.get(key) as SourceCache<T> | undefined;
  if (!cache) {
    cache = sourceCache<T>(
      `lookup:${key}`,
      async (_prev, signal) => {
        const out = await def.run(signal);
        return { data: out.data, meta: { providers: out.providers, observedAt: out.observedAt ?? null } };
      },
      { ttlMs: def.ttlMs, isEmpty: def.isEmpty ?? (() => false), deadlineMs: def.deadlineMs, pin: false, gates: def.gates },
    );
    CACHES.set(key, cache as SourceCache<unknown>);
    // Keep the handle map bounded like the L1 it fronts.
    if (CACHES.size > 400) CACHES.delete(CACHES.keys().next().value!);
  }
  const r = await cache.get();
  const now = Date.now();
  const hasData = r.data !== null && r.fetchedAt !== null && r.fetchedAt > 0;
  const runs = (r.meta.providers ?? {}) as Record<string, ProviderRun>;
  const providers: Providers = {};
  for (const [name, run] of Object.entries(runs)) providers[name] = { ...run.status, age_s: run.okAt ? Math.round((now - run.okAt) / 1000) : null };
  const observedAt = (r.meta.observedAt as number | null | undefined) ?? null;
  const meta: FeedMeta = {
    feed: def.feed,
    kind: 'live',
    state: hasData ? freshnessState({ kind: 'live', at: r.fetchedAt, cadenceMs: def.ttlMs, failed: r.error !== null, now }) : 'offline',
    fetchedAt: toIso(r.fetchedAt),
    observedAt: toIso(observedAt),
    lastGoodAt: toIso(r.fetchedAt),
    stale: r.stale,
    ttlSeconds: Math.max(1, Math.round(def.ttlMs / 1000)),
    attribution: def.attribution,
    ...(def.note ? { note: def.note } : {}),
  };
  return { data: hasData ? r.data : null, meta, providers };
}

/** Test hook. */
export function resetLookups(): void {
  CACHES.clear();
}
