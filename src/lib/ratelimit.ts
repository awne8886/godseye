/**
 * Rate limiting (§0.6) and upstream politeness.
 *  - getClientIp(): platform-verified client IP. Default order: cf-connecting-ip →
 *    x-vercel-forwarded-for → true-client-ip (each only if IP-shaped) → x-real-ip → the RIGHTMOST
 *    X-Forwarded-For entry. Behind a single known proxy set TRUST_PROXY_HEADER to that one header
 *    (e.g. `x-real-ip`) so clients cannot pick a header the proxy does not overwrite.
 *  - rateLimit(): per-route buckets keyed `${route}:${ip}` (never one shared bucket), fixed window,
 *    in memory with an LRU cap or in Redis when REDIS_URL is set.
 *  - TokenBucket / SerialQueue: server-side politeness for each upstream's documented limit.
 * Owner: lead. Server-only.
 */
import net from 'node:net';
import { apiError } from './respond';

const IP_HEADERS = ['cf-connecting-ip', 'x-vercel-forwarded-for', 'true-client-ip'] as const;

function cleanIp(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = v.trim();
  if (s.startsWith('[')) s = s.slice(1, s.indexOf(']'));
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.split(':')[0]!;
  if (s.toLowerCase().startsWith('::ffff:') && net.isIPv4(s.slice(7))) s = s.slice(7);
  return net.isIP(s) ? s : null;
}

export function getClientIp(headers: Headers, trust: string | undefined = process.env.TRUST_PROXY_HEADER): string {
  if (trust && trust !== 'auto') {
    const h = trust.toLowerCase();
    const raw = headers.get(h);
    if (h === 'x-forwarded-for') return cleanIp(raw?.split(',').at(-1)) ?? 'unknown';
    return cleanIp(raw?.split(',')[0]) ?? 'unknown';
  }
  for (const h of IP_HEADERS) {
    const ip = cleanIp(headers.get(h)?.split(',')[0]);
    if (ip) return ip;
  }
  const real = cleanIp(headers.get('x-real-ip'));
  if (real) return real;
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const ip = cleanIp(xff.split(',').at(-1));
    if (ip) return ip;
  }
  return 'unknown';
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly maxKeys = 50_000) {}
  async hit(key: string, windowMs: number) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) b = { count: 0, resetAt: now + windowMs };
    b.count++;
    this.buckets.delete(key);
    this.buckets.set(key, b);
    if (this.buckets.size > this.maxKeys) {
      for (const [k, v] of this.buckets) {
        if (this.buckets.size <= this.maxKeys) break;
        if (v.resetAt <= now || this.buckets.size > this.maxKeys) this.buckets.delete(k);
      }
    }
    return { count: b.count, resetAt: b.resetAt };
  }
}

interface RedisCounter {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number, mode?: 'NX'): Promise<number>;
  pttl(key: string): Promise<number>;
}

export class RedisRateLimitStore implements RateLimitStore {
  private client: Promise<RedisCounter> | null = null;
  constructor(private readonly url: string) {}
  private redis() {
    this.client ??= import('ioredis').then(({ Redis }) => new Redis(this.url, { maxRetriesPerRequest: 1 }) as unknown as RedisCounter);
    return this.client;
  }
  async hit(key: string, windowMs: number) {
    const r = await this.redis();
    const k = `godseye:rl:${key}`;
    const count = await r.incr(k);
    if (count === 1) await r.pexpire(k, windowMs);
    const ttl = await r.pttl(k);
    return { count, resetAt: Date.now() + (ttl > 0 ? ttl : windowMs) };
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

export async function checkRateLimit(route: string, ip: string, limit: number, windowS: number): Promise<RateLimitResult> {
  let hit: { count: number; resetAt: number };
  try {
    hit = await store().hit(`${route}:${ip}`, windowS * 1000);
  } catch {
    // Redis down: fail open for reads is safer than blocking the whole app; log via caller.
    return { allowed: true, limit, remaining: limit, resetAt: Date.now() + windowS * 1000 };
  }
  return { allowed: hit.count <= limit, limit, remaining: Math.max(0, limit - hit.count), resetAt: hit.resetAt };
}

export const DEFAULT_LIMIT = { limit: 120, windowS: 60 } as const;

/** Returns a 429 Response when over the limit, otherwise null. */
export async function rateLimit(req: Request, route: string, opts: { limit: number; windowS: number } = DEFAULT_LIMIT): Promise<Response | null> {
  const ip = getClientIp(req.headers);
  const r = await checkRateLimit(route, ip, opts.limit, opts.windowS);
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
    private readonly ratePerSec: number,
    private readonly burst = 1,
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
  }
  return b;
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
