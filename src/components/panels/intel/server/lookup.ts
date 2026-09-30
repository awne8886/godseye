/**
 * Keyed lookups (dossier by point, entity expansion, market history) cached with sourceCache and
 * reported with `providers` (+ a FeedMeta for feed-style routes). Owner:
 * panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { sourceCache, type SourceCache } from '@/lib/cache';
import type { FeedData, FeedResult, ProviderRun } from '@/lib/feeds';
import { freshnessState, toIso } from '@/lib/freshness';
import type { Attribution, FeedMeta, Providers } from '@/lib/types';

export interface LookupDef<T> {
  feed: string;
  ttlMs: number;
  attribution: Attribution[];
  note?: string;
  /** Treat as a failed lookup (every provider failed). */
  isEmpty?: (d: T) => boolean;
  deadlineMs?: number;
  run: (signal: AbortSignal) => Promise<FeedData<T>>;
}

const G = globalThis as unknown as { __godseyeIntelLookups?: Map<string, SourceCache<unknown>> };
const CACHES = (G.__godseyeIntelLookups ??= new Map());

export function providersOf(runs: Record<string, ProviderRun> | undefined, now = Date.now()): Providers {
  const out: Providers = {};
  for (const [name, run] of Object.entries(runs ?? {})) out[name] = { ...run.status, age_s: run.okAt ? Math.round((now - run.okAt) / 1000) : null };
  return out;
}

export async function lookup<T>(key: string, def: LookupDef<T>): Promise<FeedResult<T>> {
  let cache = CACHES.get(key) as SourceCache<T> | undefined;
  if (!cache) {
    cache = sourceCache<T>(
      `lookup:${key}`,
      async (_prev, signal) => {
        const out = await def.run(signal);
        return { data: out.data, meta: { providers: out.providers, observedAt: out.observedAt ?? null } };
      },
      { ttlMs: def.ttlMs, isEmpty: def.isEmpty ?? (() => false), deadlineMs: def.deadlineMs, pin: false },
    );
    CACHES.set(key, cache as SourceCache<unknown>);
    if (CACHES.size > 400) CACHES.delete(CACHES.keys().next().value!);
  }
  const r = await cache.get();
  const now = Date.now();
  const hasData = r.data !== null && r.fetchedAt !== null && r.fetchedAt > 0;
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
  return { data: hasData ? r.data : null, meta, providers: providersOf(r.meta.providers as Record<string, ProviderRun> | undefined, now) };
}

/** Test hook. */
export function clearLookups(): void {
  CACHES.clear();
}
