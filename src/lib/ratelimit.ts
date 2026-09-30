/**
 * Rate limiting (§0.6) and upstream politeness.
 *  - getClientIp(): the platform-verified client IP. A platform header is trusted only when that
 *    platform is actually in front of us (`TRUSTED_PLATFORM=cloudflare|vercel|akamai`, Vercel is
 *    auto-detected), otherwise any client could rotate `cf-connecting-ip` to get fresh buckets.
 *    Otherwise the X-Forwarded-For entry appended by our own proxy: the RIGHTMOST entry, or the
 *    `TRUSTED_PROXY_HOPS`-th from the right behind a chain of proxies. `x-real-ip` is NOT trusted by
 *    default (most PaaS edges pass a client-sent one through untouched); an operator whose proxy
 *    overwrites it sets `TRUST_PROXY_HEADER=x-real-ip`. `TRUST_PROXY_HEADER=<header>` trusts exactly
 *    that one header. The app must never be exposed without a proxy that overwrites XFF (Next only
 *    sets XFF when the client did not). IPv6 clients are keyed by /64.
 *  - rateLimit(): per-route buckets keyed `${bucket}:${ip}` (AI routes share the `ai` bucket),
 *    fixed window, in memory (expired-first eviction; a saturated table denies fail-closed routes)
 *    or in Redis (one Lua script: INCR + PEXPIRE when the key has no TTL).
 *  - TokenBucket / SerialQueue: server-side politeness for each upstream's documented limit.
 * Owner: lead. Server-only.
 */
import net from 'node:net';
import { apiError } from './respond';

const PLATFORM_HEADER = { cloudflare: 'cf-connecting-ip', vercel: 'x-vercel-forwarded-for', akamai: 'true-client-ip' } as const;
type Platform = keyof typeof PLATFORM_HEADER;

function cleanIp(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = v.trim();
  if (s.startsWith('[')) s = s.slice(1, s.indexOf(']'));
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.split(':')[0]!;
  if (s.toLowerCase().startsWith('::ffff:') && net.isIPv4(s.slice(7))) s = s.slice(7);
  // A zone id (`fe80::1%eth0`) is meaningless off-link and breaks key derivation: drop it.
  if (s.includes('%')) s = s.slice(0, s.indexOf('%'));
  return net.isIP(s) ? s : null;
}

export interface IpTrust {
  /** Exactly one header to trust (overrides everything else). */
  header?: string;
  /** The edge platform in front of the app. */
  platform?: Platform | 'none';
  /** Trusted proxies appending to X-Forwarded-For (default 1: take the rightmost entry). */
  hops?: number;
}

export function ipTrustFromEnv(env: Record<string, string | undefined> = process.env): IpTrust {
  const header = env.TRUST_PROXY_HEADER?.trim().toLowerCase();
  const p = env.TRUSTED_PLATFORM?.trim().toLowerCase();
  const platform = p && p in PLATFORM_HEADER ? (p as Platform) : env.VERCEL ? 'vercel' : 'none';
  const hops = Number(env.TRUSTED_PROXY_HOPS ?? 1);
  return { header: header && header !== 'auto' ? header : undefined, platform, hops: Number.isInteger(hops) && hops >= 1 ? hops : 1 };
}

export function getClientIp(headers: Headers, trust: IpTrust = ipTrustFromEnv()): string {
  if (trust.header) {
    const raw = headers.get(trust.header);
    return (trust.header === 'x-forwarded-for' ? cleanIp(raw?.split(',').at(-1)) : cleanIp(raw?.split(',')[0])) ?? 'unknown';
  }
  if (trust.platform && trust.platform !== 'none') {
    const ip = cleanIp(headers.get(PLATFORM_HEADER[trust.platform])?.split(',')[0]);
    if (ip) return ip;
  }
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((x) => x.trim()).filter(Boolean);
    const ip = cleanIp(parts[parts.length - (trust.hops ?? 1)]);
    if (ip) return ip;
  }
  return 'unknown';
}

/** Bucket key for an IP: IPv4 as-is, IPv6 by its /64 (one subscriber usually owns a whole /64). */
export function ipBucketKey(ip: string, prefix: 64 | 48 = 64): string {
  if (!net.isIPv6(ip)) return ip;
  const full = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [head = '', tail] = full.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t];
  return prefix === 48 ? `${groups.slice(0, 3).join(':')}::/48` : `${groups.slice(0, 4).join(':')}::/64`;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RateLimitHit {
  count: number;
  resetAt: number;
  /** The in-memory table was full of live windows and this key could not be tracked. */
  saturated?: boolean;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly maxKeys = 50_000) {}
  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      if (!b && this.buckets.size >= this.maxKeys) {
        // Only expired windows are evicted: rotating keys must never reset other clients' counters.
        for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
        if (this.buckets.size >= this.maxKeys) return { count: 1, resetAt: now + windowMs, saturated: true };
      }
      b = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    return { count: b.count, resetAt: b.resetAt };
  }
}

export interface RedisCounter {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** INCR, and give the key its window TTL whenever it has none (new key, or recreated after expiry). */
const FIXED_WINDOW = "local c = redis.call('INCR', KEYS[1]); local t = redis.call('PTTL', KEYS[1]); if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); t = tonumber(ARGV[1]) end; return {c, t}";

export class RedisRateLimitStore implements RateLimitStore {
  private client: Promise<RedisCounter> | null = null;
  constructor(private readonly url: string) {}
  private redis() {
    if (!this.client) {
      const p = import('ioredis').then(({ Redis }) => new Redis(this.url, { maxRetriesPerRequest: 1 }) as unknown as RedisCounter);
      // A failed connect is retried on the next hit instead of being cached forever.
      p.catch(() => {
        if (this.client === p) this.client = null;
      });
      this.client = p;
    }
    return this.client;
  }
  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const r = await this.redis();
    const [count, ttl] = (await r.eval(FIXED_WINDOW, 1, `godseye:rl:${key}`, Math.max(1, Math.round(windowMs)))) as [number, number];
    return { count: Number(count), resetAt: Date.now() + (Number(ttl) > 0 ? Number(ttl) : windowMs) };
  }
}

const G = globalThis as unknown as { __godseyeRl?: RateLimitStore; __godseyeBuckets?: Map<string, TokenBucket> };

function store(): RateLimitStore {
  if (!G.__godseyeRl) G.__godseyeRl = process.env.REDIS_URL ? new RedisRateLimitStore(process.env.REDIS_URL) : new MemoryRateLimitStore();
  return G.__godseyeRl;
}

/** Test hook. */
export function setRateLimitStore(s: RateLimitStore | undefined): void {
  G.__godseyeRl = s;
}

export interface RateLimitOptions {
  limit: number;
  windowS: number;
  /** Bucket name (defaults to the route); AI routes share `ai`. */
  bucket?: string;
  /** Deny when the limiter store is unreachable (AI, scanner). Others fail open. */
  failClosed?: boolean;
}

export async function checkRateLimit(bucket: string, ip: string, limit: number, windowS: number, failClosed = false): Promise<RateLimitResult> {
  let hit: RateLimitHit;
  let key: string;
  try {
    key = `${bucket}:${ipBucketKey(ip)}`;
  } catch {
    key = `${bucket}:unknown`; // a malformed IP shares one bucket; it never gets a free pass
  }
  try {
    hit = await store().hit(key, windowS * 1000);
  } catch {
    return { allowed: !failClosed, limit, remaining: failClosed ? 0 : limit, resetAt: Date.now() + windowS * 1000 };
  }
  if (hit.saturated && failClosed) return { allowed: false, limit, remaining: 0, resetAt: hit.resetAt };
  return { allowed: hit.count <= limit, limit, remaining: Math.max(0, limit - hit.count), resetAt: hit.resetAt };
}

export const DEFAULT_LIMIT = { limit: 120, windowS: 60 } as const;

/** Returns a 429 Response when over the limit, otherwise null. */
export async function rateLimit(req: Request, route: string, opts: RateLimitOptions = DEFAULT_LIMIT): Promise<Response | null> {
  const ip = getClientIp(req.headers);
  const bucket = opts.bucket ?? route;
  let r = await checkRateLimit(bucket, ip, opts.limit, opts.windowS, opts.failClosed);
  // Costly fail-closed routes (AI, scanner) also cap a whole IPv6 /48 at 8× the per-/64 limit, so
  // one tunnel-broker allocation cannot mint 65,536 fresh buckets.
  if (r.allowed && opts.failClosed && net.isIPv6(ip)) {
    const agg = await checkRateLimit(`${bucket}:48`, ipBucketKey(ip, 48), opts.limit * 8, opts.windowS, true);
    if (!agg.allowed) r = { ...agg, limit: opts.limit };
  }
  if (r.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
  return apiError(429, 'rate_limited', `Limit is ${opts.limit} requests per ${opts.windowS} s for this endpoint.`, {
    retryAfter,
    headers: { 'Retry-After': String(retryAfter), 'X-RateLimit-Limit': String(r.limit), 'X-RateLimit-Remaining': '0' },
  });
}

// ── Upstream politeness ─────────────────────────────────────────────────────────
/** Token bucket: `take()` resolves when a token is available (FIFO). */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  private chain: Promise<void> = Promise.resolve();
  constructor(
    readonly ratePerSec: number,
    readonly burst = 1,
  ) {
    this.tokens = burst;
  }
  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSec);
    this.last = now;
  }
  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
  take(): Promise<void> {
    const next = this.chain.then(async () => {
      for (;;) {
        if (this.tryTake()) return;
        const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000);
        await new Promise((r) => setTimeout(r, Math.max(5, waitMs)));
      }
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}

/** One shared bucket per upstream name, e.g. providerBucket('nvd', 5 / 30). */
export function providerBucket(name: string, ratePerSec: number, burst = 1): TokenBucket {
  const map = (G.__godseyeBuckets ??= new Map());
  let b = map.get(name);
  if (!b) {
    b = new TokenBucket(ratePerSec, burst);
    map.set(name, b);
  } else if (b.ratePerSec !== ratePerSec || b.burst !== burst) {
    // Two call sites disagreeing about an upstream's limit is a bug, not something to paper over.
    throw new Error(`providerBucket('${name}') already exists with rate ${b.ratePerSec}/s burst ${b.burst}`);
  }
  return b;
}

/**
 * NVD's published limits: keyless 5 requests / 30 s; with NVD_API_KEY (sent as the `apiKey` header)
 * 50 / 30 s. Every NVD caller (KEV scoring, chain brief, RECON CVE lookup) takes this one bucket.
 */
export function nvdBucket(keyed = !!process.env.NVD_API_KEY?.trim()): TokenBucket {
  return keyed ? providerBucket('nvd-keyed', 50 / 30, 5) : providerBucket('nvd', 5 / 30, 1);
}

export class QueueFullError extends Error {
  constructor() {
    super('queue full');
    this.name = 'QueueFullError';
  }
}

/** Strictly serial queue with a minimum gap between jobs and a bounded backlog (Nominatim: 1 req/s, ≤ 40 queued). */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;
  private lastStart = 0;
  served = 0;
  rejected = 0;
  constructor(
    private readonly intervalMs: number,
    readonly maxQueue: number,
  ) {}
  get queueDepth() {
    return this.depth;
  }
  run<T>(job: () => Promise<T>): Promise<T> {
    if (this.depth >= this.maxQueue) {
      this.rejected++;
      return Promise.reject(new QueueFullError());
    }
    this.depth++;
    const p = this.tail.then(async () => {
      const wait = this.lastStart + this.intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastStart = Date.now();
      try {
        return await job();
      } finally {
        this.depth--;
        this.served++;
      }
    });
    this.tail = p.catch(() => undefined);
    return p;
  }
}
