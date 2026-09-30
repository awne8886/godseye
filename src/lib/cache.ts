/**
 * Upstream snapshot caching (§4). `sourceCache(key, fetcher, opts)`:
 *  - TTL with stale-while-revalidate: stale data is served immediately while ONE refresh runs;
 *  - in-flight dedupe per key (single-flight), plus a cross-instance lock (SET NX PX) when the
 *    SnapshotStore is shared (Redis), so only one writer refreshes an upstream;
 *  - stale-on-error: a failed refresh keeps the last good data and is not retried for 60 s;
 *  - "empty result is a failed refresh" unless `isEmpty` says empty is legitimate;
 *  - conditional GET support (the fetcher receives the previous ETag/Last-Modified);
 *  - an in-memory L1 with an LRU cap in front of the SnapshotStore (memory / filesystem / Redis).
 * Owner: lead. Server-only.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { errorReason } from './http';

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

export interface SnapshotStore {
  readonly kind: 'memory' | 'filesystem' | 'redis';
  get<T>(key: string): Promise<StoredSnapshot<T> | null>;
  set<T>(key: string, value: StoredSnapshot<T>, retentionMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Try to become the single writer for `key` for `ttlMs`. */
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

// ── Memory ──────────────────────────────────────────────────────────────────────
export class MemoryStore implements SnapshotStore {
  readonly kind = 'memory' as const;
  private readonly map = new Map<string, { v: StoredSnapshot<unknown>; expires: number }>();
  private readonly locks = new Map<string, number>();
  constructor(private readonly maxEntries = 1000) {}

  async get<T>(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expires < Date.now()) {
      this.map.delete(key);
      return null;
    }
    this.map.delete(key);
    this.map.set(key, e); // LRU touch
    return e.v as StoredSnapshot<T>;
  }
  async set<T>(key: string, value: StoredSnapshot<T>, retentionMs: number) {
    this.map.delete(key);
    this.map.set(key, { v: value as StoredSnapshot<unknown>, expires: Date.now() + retentionMs });
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value!);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
  async acquire(key: string, ttlMs: number) {
    const until = this.locks.get(key);
    if (until && until > Date.now()) return false;
    this.locks.set(key, Date.now() + ttlMs);
    return true;
  }
  async release(key: string) {
    this.locks.delete(key);
  }
  get size() {
    return this.map.size;
  }
}

// ── Filesystem (single host, survives restarts) ─────────────────────────────────
export class FileStore implements SnapshotStore {
  readonly kind = 'filesystem' as const;
  private readonly locks = new MemoryStore(1);
  constructor(private readonly dir: string) {}

  private file(key: string) {
    return path.join(this.dir, `${createHash('sha1').update(key).digest('hex')}.json`);
  }
  async get<T>(key: string) {
    try {
      const raw = JSON.parse(await readFile(this.file(key), 'utf8')) as { key: string; expires: number; v: StoredSnapshot<T> };
      if (raw.key !== key || raw.expires < Date.now()) return null;
      return raw.v;
    } catch {
      return null;
    }
  }
  async set<T>(key: string, value: StoredSnapshot<T>, retentionMs: number) {
    await mkdir(this.dir, { recursive: true });
    const target = this.file(key);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ key, expires: Date.now() + retentionMs, v: value }));
    await rename(tmp, target);
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
  acquire(key: string, ttlMs: number) {
    return this.locks.acquire(key, ttlMs);
  }
  release(key: string) {
    return this.locks.release(key);
  }
}

// ── Redis (multi-instance: shared cache + single-writer lock) ───────────────────
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class RedisStore implements SnapshotStore {
  readonly kind = 'redis' as const;
  private client: Promise<RedisLike> | null = null;
  constructor(
    private readonly connect: () => Promise<RedisLike>,
    private readonly prefix = 'godseye:',
  ) {}
  private redis() {
    this.client ??= this.connect();
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
    await (await this.redis()).set(`${this.prefix}snap:${key}`, JSON.stringify(value), 'PX', Math.max(1000, Math.round(retentionMs)));
  }
  async delete(key: string) {
    await (await this.redis()).del(`${this.prefix}snap:${key}`);
  }
  async acquire(key: string, ttlMs: number) {
    try {
      const ok = await (await this.redis()).set(`${this.prefix}lock:${key}`, String(process.pid), 'PX', Math.max(1000, Math.round(ttlMs)), 'NX');
      return ok === 'OK';
    } catch {
      // Redis unreachable: fall back to refreshing locally rather than never refreshing.
      return true;
    }
  }
  async release(key: string) {
    try {
      await (await this.redis()).del(`${this.prefix}lock:${key}`);
    } catch {
      /* lock expires on its own */
    }
  }
}

/** Lazily connect with ioredis (only imported when REDIS_URL is set). */
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
  /** Force a refresh now (still single-flight). */
  refresh(): Promise<CacheResult<T>>;
  /** Current L1 value without triggering a fetch. */
  peek(): CacheResult<T>;
  seed(data: T, fetchedAt?: number, meta?: Record<string, unknown>): void;
  isStale(now?: number): boolean;
  clear(): Promise<void>;
}

const MAX_L1 = 500;
const L1 = new Map<string, StoredSnapshot<unknown>>();
const INFLIGHT = new Map<string, Promise<void>>();

function l1Set(key: string, v: StoredSnapshot<unknown>) {
  L1.delete(key);
  L1.set(key, v);
  if (L1.size <= MAX_L1) return;
  for (const k of L1.keys()) {
    if (L1.size <= MAX_L1) break;
    if (!INFLIGHT.has(k)) L1.delete(k);
  }
}

const defaultIsEmpty = (d: unknown) => d == null || (Array.isArray(d) && d.length === 0);

export function sourceCache<T>(
  key: string,
  fetcher: (previous: StoredSnapshot<T> | null) => Promise<FetchOutcome<T>>,
  opts: CacheOptions<T>,
): SourceCache<T> {
  const ttl = opts.ttlMs;
  const retryAfterError = opts.retryAfterErrorMs ?? 60_000;
  const isEmpty = opts.isEmpty ?? defaultIsEmpty;
  const retention = opts.retentionMs ?? Math.max(24 * 3600_000, ttl * 20);
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
    const lockMs = Math.max(30_000, Math.min(ttl, 5 * 60_000));
    if (!(await s.acquire(key, lockMs))) {
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
    let next: StoredSnapshot<T> | null;
    try {
      const out = await fetcher(prev);
      if ('notModified' in out) {
        next = prev
          ? { ...prev, fetchedAt: now(), lastAttemptAt: now(), error: null, meta: { ...prev.meta, ...out.meta } }
          : null;
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
      if (next) {
        l1Set(key, next as StoredSnapshot<unknown>);
        await s.set(key, next, retention);
      }
    } finally {
      await s.release(key);
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
    async refresh() {
      await loadL2();
      await refreshOnce();
      return toResult(current());
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
