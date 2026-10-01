/**
 * Response helpers shared by every route (§1 API contract):
 *  - JSON with `Cache-Control: public, s-maxage=<ttl>, stale-while-revalidate=<2×ttl>`
 *  - errors as `{error, detail}` with no-store
 *  - feed responses carrying `meta` + `providers`, weak ETags and 304s
 *  - pre-serialised, precompressed (brotli/gzip) bulk payloads with weak ETags
 *  - `withRoute()` wrapper: per-route rate limit + uniform 500s (no stack traces to clients)
 * Owner: lead. Server-only.
 */
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import type { z } from 'zod';
import { catalogEntry } from './api-catalog';
import type { FeedResult } from './feeds';
import type { RateLimitOptions } from './ratelimit';

export interface JsonOptions {
  status?: number;
  /** s-maxage in seconds; 0 or undefined → no-store. */
  ttl?: number;
  headers?: Record<string, string>;
}

export function cacheControl(ttl: number | undefined): string {
  if (!ttl || ttl <= 0) return 'no-store, max-age=0';
  return `public, s-maxage=${Math.round(ttl)}, stale-while-revalidate=${Math.round(ttl * 2)}`;
}

export function json(data: unknown, { status = 200, ttl, headers = {} }: JsonOptions = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl(ttl), ...headers },
  });
}

export function apiError(
  status: number,
  error: string,
  detail?: string,
  extra: { code?: string; retryAfter?: number; headers?: Record<string, string> } = {},
): Response {
  const body: Record<string, unknown> = { error };
  if (detail) body.detail = detail;
  if (extra.code) body.code = extra.code;
  if (extra.retryAfter !== undefined) body.retryAfter = extra.retryAfter;
  return json(body, { status, headers: extra.headers });
}

export function weakEtag(...parts: (string | number | null | undefined)[]): string {
  return `W/"${createHash('sha1').update(parts.map(String).join('|')).digest('base64url').slice(0, 27)}"`;
}

function notModified(req: Request, etag: string, headers: Record<string, string>): Response | null {
  const inm = req.headers.get('if-none-match');
  if (!inm) return null;
  const tags = inm.split(',').map((t) => t.trim().replace(/^W\//, ''));
  return tags.includes(etag.replace(/^W\//, '')) || inm.trim() === '*' ? new Response(null, { status: 304, headers: { ETag: etag, ...headers } }) : null;
}

/**
 * Respond with a feed snapshot. `body` gets `meta` and `providers` merged in. A feed with no data
 * returns 503 with SOURCE OFFLINE semantics (never an empty array pretending to be truth).
 * `variant` distinguishes filtered views of one feed in the ETag; it defaults to the request's
 * query string so two filters never share an ETag. Bodies ≥ 1 KB are sent br/gzip when accepted.
 */
export function feedJson<T>(req: Request, result: FeedResult<T>, body: (data: T) => Record<string, unknown>, variant = new URL(req.url).search): Response {
  const ttl = result.meta.ttlSeconds;
  if (result.data === null) {
    // Never CDN-cached: an outage must not be pinned at the edge (Retry-After paces clients).
    return json(
      { error: 'source_offline', detail: `No data from ${result.meta.feed} upstreams yet.`, meta: result.meta, providers: result.providers },
      { status: 503, ttl: 0, headers: { 'Retry-After': '30' } },
    );
  }
  // Stale/failed snapshots get a short edge TTL so a CDN never pins an outage.
  const edgeTtl = result.meta.state === 'live' || result.meta.state === 'reference' || result.meta.state === 'recent' ? ttl : Math.min(ttl, 15);
  const etag = weakEtag(result.meta.feed, result.meta.fetchedAt, result.meta.state, variant);
  const headers = { 'Cache-Control': cacheControl(edgeTtl), ETag: etag };
  const nm = notModified(req, etag, headers);
  if (nm) return nm;
  const raw = Buffer.from(JSON.stringify({ ...body(result.data), meta: result.meta, providers: result.providers }));
  const { bytes, enc } = encodeFor(req, etag, raw);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
      Vary: 'Accept-Encoding',
      ...(enc ? { 'Content-Encoding': enc } : {}),
    },
  });
}

// ── Per-ETag compression for feed responses ─────────────────────────────────────
// Route-handler Responses are not compressed by the Next server, so a 700 KB feed went out as-is.
// Encoded bodies are cached by (encoding, ETag) under a byte budget: one compression per snapshot.
const ENCODED = new Map<string, Buffer>();
let encodedBytes = 0;
const ENCODED_MAX_BYTES = 32 * 1024 * 1024;
const MIN_COMPRESS_BYTES = 1024;

function encodeFor(req: Request, etag: string, raw: Buffer): { bytes: Buffer; enc: 'br' | 'gzip' | null } {
  if (raw.length < MIN_COMPRESS_BYTES) return { bytes: raw, enc: null };
  const accepted = acceptedEncodings(req.headers.get('accept-encoding'));
  const enc = accepted.has('br') ? 'br' : accepted.has('gzip') ? 'gzip' : null;
  if (!enc) return { bytes: raw, enc: null };
  // Keyed by the body itself: per-request fields (providers' age_s) differ within one ETag.
  const key = `${enc}|${etag}|${createHash('sha1').update(raw).digest('base64')}`;
  const hit = ENCODED.get(key);
  if (hit) {
    ENCODED.delete(key);
    ENCODED.set(key, hit);
    return { bytes: hit, enc };
  }
  const bytes = enc === 'br' ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : zlib.gzipSync(raw, { level: 6 });
  if (bytes.length <= ENCODED_MAX_BYTES) {
    ENCODED.set(key, bytes);
    encodedBytes += bytes.length;
    while (encodedBytes > ENCODED_MAX_BYTES) {
      const [k, v] = ENCODED.entries().next().value!;
      ENCODED.delete(k);
      encodedBytes -= v.length;
    }
  }
  return { bytes, enc };
}

// ── Precompressed bulk payloads ─────────────────────────────────────────────────
interface Compressed {
  version: string;
  etag: string;
  raw: Buffer;
  gzip: Buffer;
  br: Buffer;
}

const COMPRESSED = new Map<string, Compressed>();
const MAX_COMPRESSED = 64;

/** Hard cap from §4: every /api response stays under 4 MB uncompressed. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function compress(key: string, version: string, build: () => unknown): Compressed {
  const hit = COMPRESSED.get(key);
  if (hit && hit.version === version) return hit;
  const raw = Buffer.from(JSON.stringify(build()));
  const entry: Compressed = {
    version,
    etag: weakEtag(key, version, raw.length),
    raw,
    gzip: zlib.gzipSync(raw, { level: 6 }),
    br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }),
  };
  COMPRESSED.delete(key);
  COMPRESSED.set(key, entry);
  while (COMPRESSED.size > MAX_COMPRESSED) COMPRESSED.delete(COMPRESSED.keys().next().value!);
  return entry;
}

/**
 * Serve a large JSON payload serialised and compressed once per `version` (e.g. the feed's
 * fetchedAt). Negotiates br > gzip > identity and answers If-None-Match with 304.
 */
/** Encodings the client accepts with q > 0 (`br;q=0` means "not brotli"). */
export function acceptedEncodings(header: string | null): Set<string> {
  const out = new Set<string>();
  for (const part of (header ?? '').split(',')) {
    const [name = '', ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    if (name && (q === undefined || Number(q.slice(2)) > 0)) out.add(name.trim());
  }
  return out;
}

export function compressedJson(req: Request, key: string, version: string, build: () => unknown, ttl: number): Response {
  const c = compress(key, version, build);
  if (c.raw.length > MAX_RESPONSE_BYTES) {
    return apiError(500, 'payload_too_large', `${key} exceeds the 4 MB response cap; split it by region/group.`);
  }
  const base = { 'Cache-Control': cacheControl(ttl), ETag: c.etag, Vary: 'Accept-Encoding' };
  const nm = notModified(req, c.etag, base);
  if (nm) return nm;
  const accepted = acceptedEncodings(req.headers.get('accept-encoding'));
  const [body, enc] = accepted.has('br') ? [c.br, 'br'] : accepted.has('gzip') ? [c.gzip, 'gzip'] : [c.raw, null];
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { ...base, 'Content-Type': 'application/json; charset=utf-8', ...(enc ? { 'Content-Encoding': enc } : {}) },
  });
}

// ── Query parsing and route wrapper ─────────────────────────────────────────────
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): { ok: true; data: z.infer<S> } | { ok: false; response: Response } {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const r = schema.safeParse(params);
  if (r.success) return { ok: true, data: r.data };
  const detail = r.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; ');
  return { ok: false, response: apiError(400, 'invalid_request', detail) };
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response> | Response;

/**
 * Read at most `max` bytes of a request body, streaming (a missing or false Content-Length cannot
 * make the server buffer more). Returns null when the body is larger.
 */
export async function readBodyCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Browser requests from another site are refused on state-changing/costly methods: a page elsewhere
 * must not spend this operator's AI key or quotas through its visitors. Server-to-server clients
 * (SDK ingest) send neither header and are unaffected.
 */
export function isCrossSite(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site !== 'same-origin' && site !== 'none';
  const origin = req.headers.get('origin');
  if (!origin || origin === 'null') return origin === 'null';
  try {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/**
 * Wrap a route handler with a per-route rate limit and a uniform 500 (details go to the server
 * log only). `route` is the catalogue path (templated, e.g. `/api/airports/{code}`); the limit,
 * shared bucket and fail-closed flag come from its catalogue entry unless `limit` overrides them.
 */
export function withRoute<C = unknown>(route: string, handler: Handler<C>, limit?: RateLimitOptions): Handler<C> {
  // A route missing from the catalogue would silently get the default limit and no docs entry.
  if (process.env.NODE_ENV !== 'production' && !limit && !catalogEntry(route, 'GET') && !catalogEntry(route, 'POST')) {
    throw new Error(`withRoute('${route}'): not in API_CATALOG (src/lib/api-catalog.ts); ask the lead to add it`);
  }
  return async (req, ctx) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && isCrossSite(req)) {
      return apiError(403, 'cross_site_request', 'This endpoint only accepts requests from this site.');
    }
    const { rateLimit, DEFAULT_LIMIT } = await import('./ratelimit');
    const entry = catalogEntry(route, req.method === 'POST' ? 'POST' : 'GET');
    const limited = await rateLimit(req, route, limit ?? entry?.rateLimit ?? DEFAULT_LIMIT);
    if (limited) return limited;
    try {
      return await handler(req, ctx);
    } catch (e) {
      console.error(`[${route}]`, e);
      return apiError(500, 'internal_error', 'The server failed to handle this request.');
    }
  };
}
