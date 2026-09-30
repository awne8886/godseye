/**
 * Upstream snapshot caching (§4). `sourceCache(key, fetcher, opts)`:
 *  - TTL with stale-while-revalidate: stale data is served immediately while ONE refresh runs;
 *  - in-flight dedupe per key (single-flight), plus a cross-instance lock (SET NX PX with an owner
 *    token, compare-and-delete release) when the SnapshotStore is shared (Redis), so only one writer
 *    refreshes an upstream; every fetch gets an AbortSignal and a hard deadline below the lock TTL;
 *  - stale-on-error: a failed refresh keeps the last good data and is not retried for 60 s — this
 *    back-off also applies to `refresh()` and the feed poller (`dueForRefresh()`), only
 *    `refresh({force: true})` bypasses it;
 *  - feed snapshots (`pin`, default for keys starting `feed:`) are never LRU-evicted by per-query
 *    caches (OSINT, aircraft lookups, geocoder), so user traffic cannot erase last-good data;
 *  - "empty result is a failed refresh" unless `isEmpty` says empty is legitimate;
 *  - conditional GET support (the fetcher receives the previous ETag/Last-Modified);
 *  - an in-memory L1 with an LRU cap in front of the SnapshotStore (memory / filesystem / Redis).
 * Owner: lead. Server-only.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, errorReason } from './http';

export interface StoredSnapshot<T> {
  data: T;
  /** ms epoch of the last successful fetch (or 304 revalidation). */
  fetchedAt: number;
  /** ms epoch of the last attempt, successful or not. */
  lastAttemptAt: number;
  /** Reason the last attempt failed, or null if it succeeded. */
  error: string | null;
  etag?: string | null;
  lastModified?: string | null;
  /** Free-form metadata stored with the data (providers, observedAt…). */
  meta?: Record<string, unknown>;
}

export interface SetOptions {
  /** Never evict this entry to make room (feed snapshots). */
  pinned?: boolean;
}

export interface SnapshotStore {
  readonly kind: 'memory' | 'filesystem' | 'redis';
  get<T>(key: string): Promise<StoredSnapshot<T> | null>;
  set<T>(key: string, value: StoredSnapshot<T>, retentionMs: number, opts?: SetOptions): Promise<void>;
  delete(key: string): Promise<void>;
  /** Try to become the single writer for `key` for `ttlMs`. Returns an owner token, or null. */
  acquire(key: string, ttlMs: number): Promise<string | null>;
  /** Release the lock only if `token` still owns it (a late finisher never frees another's lock). */
  release(key: string, token: string): Promise<void>;
}

// ── Memory ──────────────────────────────────────────────────────────────────────
type Entry = { v: StoredSnapshot<unknown>; expires: number };

/** In-process locks with owner tokens (shared by MemoryStore and FileStore). */
class LocalLocks {
  private readonly locks = new Map<string, { token: string; until: number }>();
  acquire(key: string, ttlMs: number): string | null {
    const now = Date.now();
    const held = this.locks.get(key);
    if (held && held.until > now) return null;
    if (this.locks.size > 10_000) for (const [k, l] of this.locks) if (l.until <= now) this.locks.delete(k);
    const token = randomUUID();
    this.locks.set(key, { token, until: now + ttlMs });
    return token;
  }
  release(key: string, token: string): void {
    if (this.locks.get(key)?.token === token) this.locks.delete(key);
  }
}

export class MemoryStore implements SnapshotStore {
  readonly kind = 'memory' as const;
  /** LRU-evictable entries (per-query caches). */
  private readonly map = new Map<string, Entry>();
  /** Pinned entries (feed snapshots): bounded only by the number of feeds. */
  private readonly pinned = new Map<string, Entry>();
  private readonly locks = new LocalLocks();
  constructor(private readonly maxEntries = 1000) {}

  async get<T>(key: string) {
    const pinned = this.pinned.get(key);
    const e = pinned ?? this.map.get(key);
    if (!e) return null;
    if (e.expires < Date.now()) {
      this.map.delete(key);
      this.pinned.delete(key);
      return null;
    }
    if (!pinned) {
      this.map.delete(key);
      this.map.set(key, e); // LRU touch
    }
    return e.v as StoredSnapshot<T>;
  }
  async set<T>(key: string, value: StoredSnapshot<T>, retentionMs: number, opts: SetOptions = {}) {
    const entry = { v: value as StoredSnapshot<unknown>, expires: Date.now() + retentionMs };
    this.map.delete(key);
    this.pinned.delete(key);
    if (opts.pinned) {
      this.pinned.set(key, entry);
      return;
    }
    this.map.set(key, entry);
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value!);
  }
  async delete(key: string) {
    this.map.delete(key);
    this.pinned.delete(key);
  }
  async acquire(key: string, ttlMs: number) {
    return this.locks.acquire(key, ttlMs);
  }
  async release(key: string, token: string) {
    this.locks.release(key, token);
  }
  get size() {
    return this.map.size + this.pinned.size;
  }
}

// ── Filesystem (single host, survives restarts) ─────────────────────────────────
export class FileStore implements SnapshotStore {
  readonly kind = 'filesystem' as const;
  private readonly locks = new LocalLocks();
  constructor(private readonly dir: string) {}

  private file(key: string) {
    return path.join(this.dir, `${createHash('sha1').update(key).digest('hex')}.json`);
  }
  async get<T>(key: string) {
    try {
      const file = this.file(key);
      const raw = JSON.parse(await readFile(file, 'utf8')) as { key: string; expires: number; v: StoredSnapshot<T> };
      if (raw.key !== key) return null;
      if (raw.expires < Date.now()) {
        await rm(file, { force: true }); // expired entries never accumulate on disk
        return null;
      }
      return raw.v;
    } catch {
      return null;
    }
  }
  async set<T>(key: string, value: StoredSnapshot<T>, retentionMs: number) {
    await mkdir(this.dir, { recursive: true });
    const target = this.file(key);
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify({ key, expires: Date.now() + retentionMs, v: value }));
    await rename(tmp, target);
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
  async acquire(key: string, ttlMs: number) {
    return this.locks.acquire(key, ttlMs);
  }
  async release(key: string, token: string) {
    this.locks.release(key, token);
  }
}

// ── Redis (multi-instance: shared cache + single-writer lock) ───────────────────
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** Delete KEYS[1] only when it still holds ARGV[1] (the owner token). */
const COMPARE_AND_DELETE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

export class RedisStore implements SnapshotStore {
  readonly kind = 'redis' as const;
  private client: Promise<RedisLike> | null = null;
  constructor(
    private readonly connect: () => Promise<RedisLike>,
    private readonly prefix = 'godseye:',
  ) {}
  private redis() {
    if (!this.client) {
      const p = this.connect();
      // A failed connect is retried on the next call instead of being cached forever.
      p.catch(() => {
        if (this.client === p) this.client = null;
      });
      this.client = p;
    }
    return this.client;
  }
  async get<T>(key: string) {
    try {
      const raw = await (await this.redis()).get(`${this.prefix}snap:${key}`);
      return raw ? (JSON.parse(raw) as StoredSnapshot<T>) : null;
    } catch {
      return null;
    }
  }
  async set<T>(key: string, value: StoredSnapshot<T>, retentionMs: number) {
    // Redis evicts by its own maxmemory policy; `pinned` has no meaning here.
    await (await this.redis()).set(`${this.prefix}snap:${key}`, JSON.stringify(value), 'PX', Math.max(1000, Math.round(retentionMs)));
  }
  async delete(key: string) {
    await (await this.redis()).del(`${this.prefix}snap:${key}`);
  }
  async acquire(key: string, ttlMs: number) {
    const token = randomUUID();
    try {
      const ok = await (await this.redis()).set(`${this.prefix}lock:${key}`, token, 'PX', Math.max(1000, Math.round(ttlMs)), 'NX');
      return ok === 'OK' ? token : null;
    } catch {
      // Redis unreachable: fall back to refreshing locally rather than never refreshing.
      return token;
    }
  }
  async release(key: string, token: string) {
    try {
      await (await this.redis()).eval(COMPARE_AND_DELETE, 1, `${this.prefix}lock:${key}`, token);
    } catch {
      /* lock expires on its own */
    }
  }
}

/** Lazily connect with ioredis (only imported when REDIS_URL is set). Also used by ratelimit.ts. */
export function redisConnector(url: string): () => Promise<RedisLike> {
  return async () => {
    const { Redis } = await import('ioredis');
    return new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: true }) as unknown as RedisLike;
  };
}

const G = globalThis as unknown as { __godseyeStore?: SnapshotStore };

/**
 * Process-wide store: Redis when REDIS_URL is set, filesystem when SNAPSHOT_DIR is set,
 * otherwise memory. `SNAPSHOT_STORE=memory|filesystem|redis` forces a backend.
 */
export function getStore(): SnapshotStore {
  if (G.__godseyeStore) return G.__godseyeStore;
  const forced = process.env.SNAPSHOT_STORE;
  const redisUrl = process.env.REDIS_URL;
  if ((forced === 'redis' || (!forced && redisUrl)) && redisUrl) {
    G.__godseyeStore = new RedisStore(redisConnector(redisUrl));
  } else if (forced === 'filesystem' || (!forced && process.env.SNAPSHOT_DIR)) {
    G.__godseyeStore = new FileStore(process.env.SNAPSHOT_DIR || path.join(process.cwd(), '.data', 'snapshots'));
  } else {
    G.__godseyeStore = new MemoryStore();
  }
  return G.__godseyeStore;
}

/** Test hook. */
export function setStore(store: SnapshotStore | undefined): void {
  G.__godseyeStore = store;
}

// ── sourceCache ─────────────────────────────────────────────────────────────────
export type FetchOutcome<T> =
  | { data: T; etag?: string | null; lastModified?: string | null; meta?: Record<string, unknown> }
  | { notModified: true; meta?: Record<string, unknown> };

export interface CacheOptions<T> {
  ttlMs: number;
  /** After a failed refresh, wait this long before trying again (default 60 s). */
  retryAfterErrorMs?: number;
  /** Treat this data as a failed refresh (default: null/undefined/empty array). */
  isEmpty?: (data: T) => boolean;
  /** How long last-good data is retained in the store (default max(24 h, 20 × ttl)). */
  retentionMs?: number;
  /** Hard deadline for one fetch (default 25 s). The cross-instance lock outlives it by 5 s. */
  deadlineMs?: number;
  /** Never LRU-evict (default: true for keys starting `feed:`). */
  pin?: boolean;
  store?: SnapshotStore;
}

export interface CacheResult<T> {
  data: T | null;
  fetchedAt: number | null;
  lastAttemptAt: number | null;
  /** Past TTL, or the last refresh failed. */
  stale: boolean;
  error: string | null;
  meta: Record<string, unknown>;
}

export interface SourceCache<T> {
  readonly key: string;
  /** Fresh → cached; stale → cached now + one background refresh; empty → await the refresh. */
  get(opts?: { waitForFresh?: boolean }): Promise<CacheResult<T>>;
  /** Refresh now (single-flight). Honours the error back-off unless `force`. */
  refresh(opts?: { force?: boolean }): Promise<CacheResult<T>>;
  /** True when a poller should refresh: never fetched, past TTL, or the error back-off elapsed. */
  dueForRefresh(now?: number): boolean;
  /** Current L1 value without triggering a fetch. */
  peek(): CacheResult<T>;
  seed(data: T, fetchedAt?: number, meta?: Record<string, unknown>): void;
  isStale(now?: number): boolean;
  clear(): Promise<void>;
}

const MAX_L1 = 500;
// On globalThis like the other registries, so Next dev HMR keeps one L1 per process.
const GL = globalThis as unknown as {
  __godseyeL1?: { l1: Map<string, StoredSnapshot<unknown>>; inflight: Map<string, Promise<void>>; pinned: Set<string> };
};
const { l1: L1, inflight: INFLIGHT, pinned: PINNED } = (GL.__godseyeL1 ??= { l1: new Map(), inflight: new Map(), pinned: new Set() });

function l1Set(key: string, v: StoredSnapshot<unknown>) {
  L1.delete(key);
  L1.set(key, v);
  if (L1.size - PINNED.size <= MAX_L1) return;
  for (const k of L1.keys()) {
    if (L1.size - PINNED.size <= MAX_L1) break;
    if (!INFLIGHT.has(k) && !PINNED.has(k)) L1.delete(k);
  }
}

function withDeadline<R>(p: Promise<R>, ms: number, ac: AbortController, key: string): Promise<R> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new HttpError(`Refresh of ${key} exceeded ${ms} ms`, 'timeout', key));
    }, ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

const defaultIsEmpty = (d: unknown) => d == null || (Array.isArray(d) && d.length === 0);

export function sourceCache<T>(
  key: string,
  fetcher: (previous: StoredSnapshot<T> | null, signal: AbortSignal) => Promise<FetchOutcome<T>>,
  opts: CacheOptions<T>,
): SourceCache<T> {
  const ttl = opts.ttlMs;
  const retryAfterError = opts.retryAfterErrorMs ?? 60_000;
  const isEmpty = opts.isEmpty ?? defaultIsEmpty;
  const retention = opts.retentionMs ?? Math.max(24 * 3600_000, ttl * 20);
  const deadlineMs = opts.deadlineMs ?? 25_000;
  const lockMs = deadlineMs + 5_000;
  const pin = opts.pin ?? key.startsWith('feed:');
  if (pin) PINNED.add(key);
  const store = () => opts.store ?? getStore();

  const current = () => (L1.get(key) as StoredSnapshot<T> | undefined) ?? null;
  const toResult = (s: StoredSnapshot<T> | null, now = Date.now()): CacheResult<T> =>
    s
      ? { data: s.data, fetchedAt: s.fetchedAt || null, lastAttemptAt: s.lastAttemptAt, stale: s.error !== null || now - s.fetchedAt >= ttl, error: s.error, meta: s.meta ?? {} }
      : { data: null, fetchedAt: null, lastAttemptAt: null, stale: true, error: null, meta: {} };

  async function loadL2() {
    if (current()) return;
    const s = await store().get<T>(key);
    if (s && !current()) l1Set(key, s as StoredSnapshot<unknown>);
  }

  async function doRefresh(): Promise<void> {
    const s = store();
    const token = await s.acquire(key, lockMs);
    if (!token) {
      // Another instance is refreshing: poll the shared store briefly for its result.
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const shared = await s.get<T>(key);
        if (shared && shared.lastAttemptAt > (current()?.lastAttemptAt ?? 0)) {
          l1Set(key, shared as StoredSnapshot<unknown>);
          return;
        }
      }
      return;
    }
    const prev = current();
    const now = () => Date.now();
    let next: StoredSnapshot<T>;
    try {
      const ac = new AbortController();
      const out = await withDeadline(fetcher(prev, ac.signal), deadlineMs, ac, key);
      if ('notModified' in out) {
        next = prev
          ? { ...prev, fetchedAt: now(), lastAttemptAt: now(), error: null, meta: { ...prev.meta, ...out.meta } }
          : // A 304 without data to revalidate is a failed attempt (recorded, so the back-off applies).
            ({ data: null as T, fetchedAt: 0, lastAttemptAt: now(), error: 'not_modified_without_data' } as StoredSnapshot<T>);
      } else if (isEmpty(out.data)) {
        next = prev
          ? { ...prev, lastAttemptAt: now(), error: 'empty' }
          : { data: out.data, fetchedAt: 0, lastAttemptAt: now(), error: 'empty', meta: out.meta };
      } else {
        next = { data: out.data, fetchedAt: now(), lastAttemptAt: now(), error: null, etag: out.etag ?? null, lastModified: out.lastModified ?? null, meta: out.meta };
      }
    } catch (e) {
      const reason = errorReason(e);
      next = prev ? { ...prev, lastAttemptAt: now(), error: reason } : ({ data: null as T, fetchedAt: 0, lastAttemptAt: now(), error: reason } as StoredSnapshot<T>);
    }
    try {
      l1Set(key, next as StoredSnapshot<unknown>);
      await s.set(key, next, retention, { pinned: pin });
    } finally {
      await s.release(key, token);
    }
  }

  function refreshOnce(): Promise<void> {
    let p = INFLIGHT.get(key);
    if (!p) {
      p = doRefresh()
        .catch(() => undefined)
        .finally(() => INFLIGHT.delete(key));
      INFLIGHT.set(key, p);
    }
    return p;
  }

  return {
    key,
    async get({ waitForFresh = false } = {}) {
      await loadL2();
      const now = Date.now();
      const s = current();
      if (s && s.error === null && now - s.fetchedAt < ttl) return toResult(s, now);
      if (s && s.error !== null && now - s.lastAttemptAt < retryAfterError) return toResult(s, now);
      const hasData = s !== null && s.fetchedAt > 0;
      const p = refreshOnce();
      if (hasData && !waitForFresh) return toResult(s, now);
      await p;
      return toResult(current());
    },
    async refresh({ force = false } = {}) {
      await loadL2();
      const s = current();
      if (!force && s && s.error !== null && Date.now() - s.lastAttemptAt < retryAfterError) return toResult(s);
      await refreshOnce();
      return toResult(current());
    },
    dueForRefresh(now = Date.now()) {
      const s = current();
      if (!s) return true;
      if (s.error !== null) return now - s.lastAttemptAt >= retryAfterError;
      return now - s.fetchedAt >= ttl;
    },
    peek: () => toResult(current()),
    seed(data, fetchedAt = Date.now(), meta) {
      l1Set(key, { data, fetchedAt, lastAttemptAt: fetchedAt, error: null, meta } as StoredSnapshot<unknown>);
    },
    isStale(now = Date.now()) {
      const s = current();
      return !s || s.error !== null || now - s.fetchedAt >= ttl;
    },
    async clear() {
      L1.delete(key);
      await store().delete(key);
    },
  };
}

/** Test hook: drop every L1 entry. */
export function clearL1(): void {
  L1.clear();
  INFLIGHT.clear();
}
