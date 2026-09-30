/**
 * Feeds: the single-writer upstream poller (§4). A feed is defined once (server-side) with its
 * TTL, attribution and a `run()` that calls its providers through httpJson(). Route handlers only
 * call `feed.get()`; they never fetch upstreams directly and never fetch other routes over HTTP.
 *
 * Scheduling: the first read starts a background refresh loop (every `pollMs`, default TTL) that
 * keeps running while the feed has readers within `idleStopMs`; `eager` feeds are started from
 * src/instrumentation.ts. One loop per process; with Redis the cache lock makes one writer
 * across instances. Every response reports `providers: {name: {ok, count, ms, age_s}}`.
 * Owner: lead. Server-only.
 */
import { errorReason } from './http';
import { sourceCache, type SourceCache } from './cache';
import { freshnessState, toIso } from './freshness';
import type { Attribution, DataKind, FeedMeta, ProviderStatus, Providers } from './types';

export interface ProviderRun {
  status: ProviderStatus;
  /** ms epoch the provider's data was fetched (for age_s at response time). */
  okAt: number | null;
}

export interface FeedContext<T> {
  previous: T | null;
  etag: string | null;
  lastModified: string | null;
  /** Aborted when the refresh deadline passes: pass it to httpJson({signal}). */
  signal: AbortSignal;
}

export interface FeedData<T> {
  data: T;
  providers: Record<string, ProviderRun>;
  /** Newest observation contained in `data` (ms epoch), if known. */
  observedAt?: number | null;
  etag?: string | null;
  lastModified?: string | null;
}

export interface FeedDef<T> {
  key: string;
  ttlMs: number;
  kind: DataKind;
  attribution: Attribution[];
  note?: string;
  run: (ctx: FeedContext<T>) => Promise<FeedData<T> | { notModified: true }>;
  /** Count of entities for /api/stats and the rail badge. */
  count: (data: T) => number;
  /** Return true when this data must be treated as a failed refresh (default: count === 0). */
  isEmpty?: (data: T) => boolean;
  pollMs?: number;
  idleStopMs?: number;
  /** Start polling at boot (core feeds: quakes, news, weather, markets). */
  eager?: boolean;
  /** Retry delay after a failure (default 60 s). The poller honours it too. */
  retryAfterErrorMs?: number;
  /** Hard deadline for one run() (default 25 s); raise it for large downloads (FIRMS, OurAirports). */
  deadlineMs?: number;
  /**
   * An upstream that keeps answering 200 with frozen data is not LIVE: when the newest observation
   * (FeedData.observedAt) is older than this, the feed state is capped at `stale`.
   */
  maxObservationAgeMs?: number;
}

export interface FeedResult<T> {
  data: T | null;
  meta: FeedMeta;
  providers: Providers;
}

export interface FeedHealth {
  state: FeedMeta['state'] | 'idle';
  fetchedAt: string | null;
  lastGoodAt: string | null;
  count: number;
  providers: Providers;
}

export interface Feed<T> {
  readonly key: string;
  readonly def: FeedDef<T>;
  get(opts?: { waitForFresh?: boolean }): Promise<FeedResult<T>>;
  peek(): FeedResult<T>;
  /** Refresh now; honours the error back-off unless `force`. */
  refresh(opts?: { force?: boolean }): Promise<FeedResult<T>>;
  health(): FeedHealth;
  start(): void;
  stop(): void;
}

interface Registry {
  feeds: Map<string, Feed<unknown>>;
  timers: Map<string, ReturnType<typeof setInterval>>;
  lastRead: Map<string, number>;
}

const G = globalThis as unknown as { __godseyeFeeds?: Registry };
const registry: Registry = (G.__godseyeFeeds ??= { feeds: new Map(), timers: new Map(), lastRead: new Map() });

/**
 * Measure one provider call. `count` extracts how many records it contributed. Zero records is a
 * failure (`error: 'empty'`) unless `allowEmpty`: set it only for upstreams where "none right now"
 * is a truthful answer (NHC with no active storms, no emergency squawks, no space-weather alerts).
 */
export async function runProvider<R>(
  fn: () => Promise<R>,
  count: (r: R) => number,
  opts: { allowEmpty?: boolean } = {},
): Promise<{ result: R | null; run: ProviderRun }> {
  const t0 = Date.now();
  try {
    const result = await fn();
    const n = count(result);
    const ok = n > 0 || opts.allowEmpty === true;
    return { result, run: { status: { ok, count: n, ms: Date.now() - t0, age_s: ok ? 0 : null, ...(ok ? {} : { error: 'empty' }) }, okAt: ok ? Date.now() : null } };
  } catch (e) {
    return { result: null, run: { status: { ok: false, count: 0, ms: Date.now() - t0, age_s: null, error: errorReason(e) }, okAt: null } };
  }
}

/** A provider that did not run (missing key, licence gate, disabled). */
export function skippedProvider(reason: NonNullable<ProviderStatus['skipped']>): ProviderRun {
  return { status: { ok: false, count: 0, ms: 0, age_s: null, skipped: reason }, okAt: null };
}

function providersAt(runs: Record<string, ProviderRun> | undefined, now: number): Providers {
  const out: Providers = {};
  for (const [name, r] of Object.entries(runs ?? {})) {
    out[name] = { ...r.status, age_s: r.okAt ? Math.round((now - r.okAt) / 1000) : null };
  }
  return out;
}

export function defineFeed<T>(def: FeedDef<T>): Feed<T> {
  const existing = registry.feeds.get(def.key) as Feed<T> | undefined;
  if (existing) return existing; // HMR / duplicate import: keep one writer

  const isEmpty = def.isEmpty ?? ((d: T) => def.count(d) === 0);
  const cache: SourceCache<T> = sourceCache<T>(
    `feed:${def.key}`,
    async (prev, signal) => {
      const out = await def.run({ previous: prev?.data ?? null, etag: prev?.etag ?? null, lastModified: prev?.lastModified ?? null, signal });
      if ('notModified' in out) {
        // The providers that answered before just revalidated: their age restarts now.
        const before = (prev?.meta?.providers ?? {}) as Record<string, ProviderRun>;
        const now = Date.now();
        const providers = Object.fromEntries(Object.entries(before).map(([k, r]) => [k, r.okAt ? { ...r, okAt: now } : r]));
        return { notModified: true, meta: { providers } };
      }
      return { data: out.data, etag: out.etag, lastModified: out.lastModified, meta: { providers: out.providers, observedAt: out.observedAt ?? null } };
    },
    { ttlMs: def.ttlMs, isEmpty, retryAfterErrorMs: def.retryAfterErrorMs, deadlineMs: def.deadlineMs, pin: true },
  );

  const toResult = (r: ReturnType<SourceCache<T>['peek']>): FeedResult<T> => {
    const now = Date.now();
    const lastGood = r.fetchedAt;
    const hasData = r.data !== null && lastGood !== null && lastGood > 0;
    const observedAt = (r.meta.observedAt as number | null | undefined) ?? null;
    let state = hasData
      ? freshnessState({ kind: def.kind, at: lastGood, cadenceMs: def.ttlMs, failed: r.error !== null, now })
      : 'offline';
    if ((state === 'live' || state === 'recent') && def.maxObservationAgeMs && observedAt !== null && now - observedAt > def.maxObservationAgeMs) {
      state = 'stale';
    }
    const meta: FeedMeta = {
      feed: def.key,
      kind: def.kind,
      state,
      fetchedAt: toIso(lastGood),
      observedAt: toIso(observedAt),
      lastGoodAt: toIso(lastGood),
      stale: r.stale,
      ttlSeconds: Math.max(1, Math.round(def.ttlMs / 1000)),
      attribution: def.attribution,
      ...(def.note ? { note: def.note } : {}),
    };
    return { data: hasData ? r.data : null, meta, providers: providersAt(r.meta.providers as Record<string, ProviderRun> | undefined, now) };
  };

  const feed: Feed<T> = {
    key: def.key,
    def,
    async get(opts) {
      registry.lastRead.set(def.key, Date.now());
      feed.start();
      return toResult(await cache.get(opts));
    },
    peek: () => toResult(cache.peek()),
    async refresh(opts) {
      return toResult(await cache.refresh(opts));
    },
    health() {
      const r = feed.peek();
      const running = registry.timers.has(def.key);
      return {
        state: r.data === null && !running && r.meta.lastGoodAt === null ? 'idle' : r.meta.state,
        fetchedAt: r.meta.fetchedAt,
        lastGoodAt: r.meta.lastGoodAt,
        count: r.data !== null ? def.count(r.data) : 0,
        providers: r.providers,
      };
    },
    start() {
      if (registry.timers.has(def.key)) return;
      const pollMs = def.pollMs ?? def.ttlMs;
      const idleStop = def.idleStopMs ?? 10 * 60_000;
      const timer = setInterval(() => {
        const last = registry.lastRead.get(def.key) ?? 0;
        if (!def.eager && Date.now() - last > idleStop) {
          feed.stop();
          return;
        }
        // dueForRefresh honours the error back-off, so a failing upstream is not hit every poll.
        if (cache.dueForRefresh()) void cache.refresh();
      }, pollMs);
      timer.unref?.();
      registry.timers.set(def.key, timer);
    },
    stop() {
      const t = registry.timers.get(def.key);
      if (t) clearInterval(t);
      registry.timers.delete(def.key);
    },
  };
  registry.feeds.set(def.key, feed as Feed<unknown>);
  return feed;
}

export function allFeeds(): Feed<unknown>[] {
  return [...registry.feeds.values()];
}

export function getFeed(key: string): Feed<unknown> | undefined {
  return registry.feeds.get(key);
}

/** Start every eager feed and prime it once (called from instrumentation). */
export function startEagerFeeds(): void {
  for (const f of registry.feeds.values()) {
    if (!f.def.eager) continue;
    registry.lastRead.set(f.key, Date.now());
    f.start();
    void f.refresh();
  }
}

/** Test hook. */
export function resetFeeds(): void {
  for (const t of registry.timers.values()) clearInterval(t);
  registry.feeds.clear();
  registry.timers.clear();
  registry.lastRead.clear();
}
