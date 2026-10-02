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
 *  - an in-memory L1 with an LRU cap in front of the SnapshotStore (memory / filesystem / Redis);
 *  - licence/key gates (`gates`): every snapshot is written with the capability signature it was
 *    fetched under (`meta.gateSignature`), and on every read (L1, store, shared-lock poll) a
 *    snapshot whose signature differs from the current capabilities is treated as absent — its data
 *    is never served and never kept as the "previous" good value by an empty refresh (round 10).
 * Owner: lead. Server-only.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hasCapability, type CapabilityId } from './capabilities';
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
type Entry = { v: StoredSnapshot<unknown>; expires: number; bytes: number };

/** Rough in-memory cost of a snapshot (its JSON length); unserialisable data counts as 1 KB. */
function sizeOf(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 1024;
  }
}

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
  private bytes = 0;
  /**
   * `maxEntries` and `maxBytes` bound the LRU part (per-query caches keyed by user input); pinned
   * feed snapshots are bounded by the number of feeds and never evicted.
   */
  constructor(
    private readonly maxEntries = 1000,
    private readonly maxBytes = Number(process.env.SNAPSHOT_MEMORY_MAX_BYTES) || 256 * 1024 * 1024,
  ) {}
  private drop(key: string) {
    const e = this.map.get(key);
    if (e) this.bytes -= e.bytes;
    this.map.delete(key);
  }

  async get<T>(key: string) {
    const pinned = this.pinned.get(key);
    const e = pinned ?? this.map.get(key);
    if (!e) return null;
    if (e.expires < Date.now()) {
      this.drop(key);
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
    const entry = { v: value as StoredSnapshot<unknown>, expires: Date.now() + retentionMs, bytes: opts.pinned ? 0 : sizeOf(value) };
    this.drop(key);
    this.pinned.delete(key);
    if (opts.pinned) {
      this.pinned.set(key, entry);
      return;
    }
    if (entry.bytes > this.maxBytes) return; // larger than the whole budget: never cached
    this.map.set(key, entry);
    this.bytes += entry.bytes;
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) this.drop(this.map.keys().next().value!);
  }
  async delete(key: string) {
    this.drop(key);
    this.pinned.delete(key);
  }
  /** Bytes held by the evictable (per-query) part. */
  get evictableBytes() {
    return this.bytes;
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
  private writes = 0;
  private sweeping: Promise<number> | null = null;
  /**
   * Pinned feed snapshots live in `<dir>/pinned`; everything else (per-query caches) in `<dir>/lru`.
   * A per-query file's mtime is set to its expiry, so a sweep (every 200 writes, never two at once)
   * needs only `stat`: expired files go first, then the soonest-expiring beyond `maxFiles` or
   * `maxBytes`. Entries larger than 1/16 of the byte budget are not cached on disk.
   */
  constructor(
    private readonly dir: string,
    private readonly maxFiles = Number(process.env.SNAPSHOT_MAX_FILES) || 20_000,
    private readonly maxBytes = Number(process.env.SNAPSHOT_MAX_DISK_BYTES) || 1024 * 1024 * 1024,
  ) {}

  private file(key: string, pinned?: boolean) {
    const name = `${createHash('sha1').update(key).digest('hex')}.json`;
    return pinned === undefined ? name : path.join(this.dir, pinned ? 'pinned' : 'lru', name);
  }

  /** Delete expired and excess per-query entries (never pinned feed snapshots). */
  sweep(now = Date.now()): Promise<number> {
    this.sweeping ??= this.sweepOnce(now).finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  private async sweepOnce(now: number): Promise<number> {
    const lru = path.join(this.dir, 'lru');
    let names: string[];
    // Temp files left by a crash mid-write (renamed into place on success) older than an hour, in
    // both directories: pinned snapshots are never evicted, but their orphaned temp files are.
    for (const dir of [lru, path.join(this.dir, 'pinned')]) {
      const tmps = (await readdir(/*turbopackIgnore: true*/ dir).catch(() => [] as string[])).filter((x) => x.endsWith('.tmp'));
      for (const n of tmps) {
        const f = path.join(dir, n);
        const st = await stat(f).catch(() => null);
        if (st && now - st.mtimeMs > 3_600_000) await rm(f, { force: true });
      }
    }
    try {
      names = (await readdir(lru)).filter((n) => n.endsWith('.json'));
    } catch {
      return 0;
    }
    const live: { name: string; expires: number; size: number }[] = [];
    let removed = 0;
    for (const name of names) {
      const f = path.join(lru, name);
      try {
        const st = await stat(f);
        if (st.mtimeMs < now) {
          await rm(f, { force: true });
          removed++;
        } else live.push({ name, expires: st.mtimeMs, size: st.size });
      } catch {
        /* removed concurrently */
      }
    }
    live.sort((a, b) => a.expires - b.expires);
    let bytes = live.reduce((n, e) => n + e.size, 0);
    let count = live.length;
    for (const e of live) {
      if (count <= this.maxFiles && bytes <= this.maxBytes) break;
      await rm(path.join(lru, e.name), { force: true });
      count--;
      bytes -= e.size;
      removed++;
    }
    return removed;
  }
  async get<T>(key: string) {
    for (const pinned of [true, false]) {
      const file = this.file(key, pinned);
      try {
        const raw = JSON.parse(await readFile(file, 'utf8')) as { key: string; expires: number; v: StoredSnapshot<T> };
        if (raw.key !== key) continue;
        if (raw.expires < Date.now()) {
          await rm(file, { force: true }); // expired entries never accumulate on disk
          return null;
        }
        return raw.v;
      } catch {
        /* not in this tier */
      }
    }
    return null;
  }
  async set<T>(key: string, value: StoredSnapshot<T>, retentionMs: number, opts: SetOptions = {}) {
    const pinned = !!opts.pinned;
    const target = this.file(key, pinned);
    await mkdir(path.dirname(target), { recursive: true });
    const expires = Date.now() + retentionMs;
    const body = JSON.stringify({ key, expires, v: value });
    if (!pinned && Buffer.byteLength(body) > this.maxBytes / 16) return; // too large for the per-query tier
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, body);
    if (!pinned) await utimes(tmp, new Date(), new Date(expires)); // mtime = expiry (sweeps stat only)
    await rename(tmp, target);
    await rm(this.file(key, !pinned), { force: true });
    if (!pinned && ++this.writes % 200 === 0) void this.sweep().catch(() => undefined);
  }
  async delete(key: string) {
    await rm(this.file(key, true), { force: true });
    await rm(this.file(key, false), { force: true });
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
  /**
   * Capabilities whose state decides what this cache may hold (licence gates, keys). A snapshot
   * written under a different on/off combination is never served, kept or revalidated.
   */
  gates?: readonly CapabilityId[];
}

/** `id=1|0` per gate, in declaration order: the capability state a snapshot was fetched under. */
export function gateSignature(gates: readonly CapabilityId[], env: Record<string, string | undefined> = process.env): string {
  return gates.map((g) => `${g}=${hasCapability(g, env) ? 1 : 0}`).join(',');
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
  const gates = opts.gates ?? [];
  const signature = () => (gates.length ? gateSignature(gates) : null);
  /** A snapshot fetched under other capability states is no snapshot at all. */
  const admissible = (s: StoredSnapshot<unknown> | null | undefined, sig = signature()): boolean =>
    !!s && (sig === null || s.meta?.gateSignature === sig);
  const signed = (s: StoredSnapshot<T>, sig: string | null): StoredSnapshot<T> => (sig === null ? s : { ...s, meta: { ...s.meta, gateSignature: sig } });

  const current = (): StoredSnapshot<T> | null => {
    const s = L1.get(key) as StoredSnapshot<T> | undefined;
    if (!s) return null;
    if (admissible(s)) return s;
    L1.delete(key);
    return null;
  };
  const toResult = (s: StoredSnapshot<T> | null, now = Date.now()): CacheResult<T> =>
    s
      ? { data: s.data, fetchedAt: s.fetchedAt || null, lastAttemptAt: s.lastAttemptAt, stale: s.error !== null || now - s.fetchedAt >= ttl, error: s.error, meta: s.meta ?? {} }
      : { data: null, fetchedAt: null, lastAttemptAt: null, stale: true, error: null, meta: {} };

  async function loadL2() {
    if (current()) return;
    const s = await store().get<T>(key);
    if (s && admissible(s) && !current()) l1Set(key, s as StoredSnapshot<unknown>);
  }

  async function doRefresh(): Promise<void> {
    const s = store();
    const token = await s.acquire(key, lockMs);
    if (!token) {
      // Another instance is refreshing: poll the shared store briefly for its result.
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const shared = await s.get<T>(key);
        if (shared && admissible(shared) && shared.lastAttemptAt > (current()?.lastAttemptAt ?? 0)) {
          l1Set(key, shared as StoredSnapshot<unknown>);
          return;
        }
      }
      return;
    }
    // The gate state this refresh runs under: its result is signed with it, and `prev` must match it.
    const sig = signature();
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
    next = signed(next, sig);
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
      l1Set(key, signed({ data, fetchedAt, lastAttemptAt: fetchedAt, error: null, meta } as StoredSnapshot<T>, signature()) as StoredSnapshot<unknown>);
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
