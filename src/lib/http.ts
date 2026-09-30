/**
 * The one server-side HTTP client for upstream calls (§4). Every upstream request goes through
 * httpRequest()/httpJson()/httpText(): deadline, retries with jitter (idempotent methods only,
 * honouring Retry-After), identifying User-Agent, gzip/deflate/br decoding, conditional GET
 * (ETag / Last-Modified → 304), body-size cap, optional IPv4 pinning, and a per-hop URL
 * validator hook used by the SSRF guard (src/lib/ssrf.ts) for user-supplied URLs.
 *
 * Honesty rules enforced here: the User-Agent must identify GODSEYE, and X-Forwarded-For /
 * X-Real-IP / Forwarded may never be set on upstream requests (no spoofing, no quota pooling).
 * Built on node:http(s) rather than fetch so we control DNS lookup, address family and redirects.
 * Owner: lead. Server-only.
 */
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import zlib from 'node:zlib';
import { userAgent } from './config';

export interface HttpOptions {
  method?: 'GET' | 'HEAD' | 'POST';
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Deadline per attempt in ms (default 15 000). */
  timeoutMs?: number;
  /** Retries after the first attempt (default 2 for GET/HEAD, 0 for POST). */
  retries?: number;
  /** Max response bytes after decoding (default 50 MB). */
  maxBytes?: number;
  /** Conditional GET validators from a previous response. */
  etag?: string | null;
  lastModified?: string | null;
  /** Pin the address family (GDELT needs IPv4). */
  family?: 4 | 6;
  /** Follow redirects up to this many hops (default 5). 0 disables following. */
  maxRedirects?: number;
  /** Called for the initial URL and every redirect hop; throw to block (SSRF guard). */
  validateUrl?: (url: URL) => Promise<void> | void;
  /** Custom DNS lookup (the SSRF guard uses one that rejects reserved addresses at connect time). */
  lookup?: LookupFunction;
  /** Wait on an upstream politeness limiter before each attempt. */
  limiter?: { take(): Promise<void> };
  /** Overall deadline in ms across every attempt and redirect hop (default: none). */
  deadlineMs?: number;
  signal?: AbortSignal;
}

export interface HttpResult {
  status: number;
  ok: boolean;
  notModified: boolean;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** Final URL after redirects. */
  url: string;
  etag: string | null;
  lastModified: string | null;
  ms: number;
  attempts: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly code: 'timeout' | 'network' | 'http' | 'too_large' | 'blocked' | 'redirect' | 'parse' | 'aborted',
    readonly url: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Client-identity and routing headers we never forge upstream (§0.5), plus Host (virtual-host confusion). */
const FORBIDDEN_HEADERS = [
  'x-forwarded-for', 'x-real-ip', 'forwarded', 'forwarded-for', 'x-forwarded', 'x-forwarded-host', 'x-forwarded-proto',
  'true-client-ip', 'cf-connecting-ip', 'x-client-ip', 'x-originating-ip', 'x-remote-ip', 'x-remote-addr',
  'x-cluster-client-ip', 'fastly-client-ip', 'via', 'host',
];
/** Browser product tokens: a GODSEYE UA with a browser suffix is still UA spoofing. */
const BROWSER_UA = /mozilla|chrome|safari|applewebkit|gecko|edg\/|opr\//i;
/** Credentials that must never follow a redirect to another origin. */
const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'cookie', 'x-api-key', 'auth-key', 'api-key', 'x-ai-key', 'x-windy-api-key', 'x-ucdp-access-token'];
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 10_000;

function buildHeaders(opts: HttpOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;
  for (const h of FORBIDDEN_HEADERS) {
    if (h in headers) throw new HttpError(`Refusing to send ${h} upstream (no header spoofing)`, 'blocked', '');
  }
  const ua = headers['user-agent'];
  if (ua !== undefined && (!ua.startsWith(userAgent()) || BROWSER_UA.test(ua))) {
    throw new HttpError('User-Agent must be the GODSEYE identifier (a product suffix may follow; no browser tokens)', 'blocked', '');
  }
  headers['user-agent'] = ua ?? userAgent();
  headers['accept-encoding'] ??= 'gzip, deflate, br';
  headers['accept'] ??= '*/*';
  if (opts.etag) headers['if-none-match'] = opts.etag;
  if (opts.lastModified) headers['if-modified-since'] = opts.lastModified;
  if (opts.body !== undefined) headers['content-length'] = String(Buffer.byteLength(opts.body));
  return headers;
}

function parseRetryAfter(value: string | string[] | undefined): number | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

/** Decompress with an output cap so a decompression bomb cannot exhaust memory. */
function decode(buf: Buffer, encoding: string | undefined, maxOutputLength: number): Buffer {
  const opts = { maxOutputLength };
  const enc = (encoding ?? '').trim().toLowerCase();
  // Stacked codings (`gzip, br`) are never requested; returning them raw would be silently wrong.
  if (enc.includes(',')) throw new Error(`Unsupported stacked Content-Encoding: ${enc}`);
  switch (enc) {
    case 'gzip':
    case 'x-gzip':
      return zlib.gunzipSync(buf, opts);
    case 'deflate':
      try {
        return zlib.inflateSync(buf, opts);
      } catch (e) {
        if (e instanceof RangeError) throw e;
        return zlib.inflateRawSync(buf, opts);
      }
    case 'br':
      return zlib.brotliDecompressSync(buf, opts);
    case '':
    case 'identity':
      return buf;
    default:
      throw new Error(`Unsupported Content-Encoding: ${enc}`);
  }
}

/** Reject when `signal` aborts first (so the overall deadline also covers DNS checks and limiter waits). */
function raceSignal<T>(p: Promise<T> | T, signal: AbortSignal | undefined, url: string): Promise<T> {
  if (!signal) return Promise.resolve(p);
  if (signal.aborted) return Promise.reject(new HttpError('Aborted', 'aborted', url));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new HttpError('Aborted', 'aborted', url));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(p).then(
      (v) => (signal.removeEventListener('abort', onAbort), resolve(v)),
      (e) => (signal.removeEventListener('abort', onAbort), reject(e)),
    );
  });
}

interface AttemptResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function attempt(url: URL, opts: HttpOptions, headers: Record<string, string>): Promise<AttemptResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new HttpError('Aborted', 'aborted', url.toString()));
      return;
    }
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const req = mod.request(
      url,
      {
        method: opts.method ?? 'GET',
        headers,
        family: opts.family,
        lookup: opts.lookup,
        // Keep sockets short-lived; upstreams are many and varied.
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        res.on('data', (c: Buffer) => {
          received += c.length;
          // Compressed bytes are capped too (a zip bomb would exceed after decoding below).
          if (received > maxBytes) {
            req.destroy();
            done(() => reject(new HttpError(`Response exceeds ${maxBytes} bytes`, 'too_large', url.toString(), res.statusCode)));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          done(() => {
            try {
              const raw = Buffer.concat(chunks);
              const body = opts.method === 'HEAD' ? raw : decode(raw, res.headers['content-encoding'] as string | undefined, maxBytes);
              resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
            } catch (e) {
              if (e instanceof RangeError || (e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
                reject(new HttpError(`Decoded response exceeds ${maxBytes} bytes`, 'too_large', url.toString(), res.statusCode));
                return;
              }
              reject(new HttpError(`Could not decode response: ${(e as Error).message}`, 'parse', url.toString(), res.statusCode));
            }
          });
        });
        res.on('error', (e) => done(() => reject(new HttpError(e.message, 'network', url.toString()))));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(() => reject(new HttpError(`Timed out after ${timeoutMs} ms`, 'timeout', url.toString())));
    }, timeoutMs);
    const onAbort = () => {
      req.destroy();
      done(() => reject(new HttpError('Aborted', 'aborted', url.toString())));
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', (e: NodeJS.ErrnoException) => {
      const blocked = e.code === 'EBLOCKED';
      done(() => reject(new HttpError(e.message, blocked ? 'blocked' : 'network', url.toString())));
    });
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new HttpError('Aborted', 'aborted', ''))), { once: true });
  });

/** Backoff before retry n (1-based): 400 ms × 2^(n-1) plus up to 250 ms of jitter (timing only, never data). */
export function backoffMs(n: number): number {
  return 400 * 2 ** (n - 1) + Math.floor(Math.random() * 250);
}

export async function httpRequest(input: string | URL, opts: HttpOptions = {}): Promise<HttpResult> {
  const started = Date.now();
  const method = opts.method ?? 'GET';
  const idempotent = method === 'GET' || method === 'HEAD';
  const retries = opts.retries ?? (idempotent ? 2 : 0);
  const maxRedirects = opts.maxRedirects ?? 5;
  let headers: Record<string, string>;
  try {
    headers = buildHeaders(opts);
  } catch (e) {
    throw e instanceof HttpError ? new HttpError(e.message, e.code, String(input)) : e;
  }

  // Overall deadline: combine the caller's signal with a timer across attempts and hops.
  const deadline = opts.deadlineMs ? AbortSignal.timeout(opts.deadlineMs) : undefined;
  const signal = deadline && opts.signal ? AbortSignal.any([deadline, opts.signal]) : (deadline ?? opts.signal);
  const attemptOpts: HttpOptions = { ...opts, signal };

  let lastError: HttpError | null = null;
  for (let n = 0; n <= retries; n++) {
    if (n > 0) await sleep(Math.min(MAX_RETRY_AFTER_MS, lastError?.retryAfterMs ?? backoffMs(n)), signal);
    let url = new URL(input);
    let hopHeaders = headers;
    let hopOpts = attemptOpts;
    try {
      let hops = 0;
      for (;;) {
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(`Unsupported protocol ${url.protocol}`, 'blocked', url.toString());
        await raceSignal(opts.validateUrl?.(url), signal, url.toString());
        await raceSignal(opts.limiter?.take(), signal, url.toString());
        const res = await attempt(url, hopOpts, hopHeaders);
        const location = res.headers.location;
        if (res.status >= 300 && res.status < 400 && res.status !== 304 && location && maxRedirects > 0) {
          if (hops >= maxRedirects) throw new HttpError(`Too many redirects (> ${maxRedirects})`, 'redirect', url.toString(), res.status);
          hops++;
          const next = new URL(location, url);
          if (url.protocol === 'https:' && next.protocol === 'http:') {
            throw new HttpError('Refusing to follow an https → http downgrade', 'redirect', next.toString(), res.status);
          }
          if (next.origin !== url.origin) {
            hopHeaders = Object.fromEntries(Object.entries(hopHeaders).filter(([k]) => !CREDENTIAL_HEADERS.includes(k)));
          }
          // Fetch semantics: 301/302/303 after a non-GET become a bodiless GET (never replay a POST body).
          const m = hopOpts.method ?? 'GET';
          if (m !== 'GET' && m !== 'HEAD' && (res.status === 301 || res.status === 302 || res.status === 303)) {
            hopOpts = { ...hopOpts, method: 'GET', body: undefined };
            hopHeaders = Object.fromEntries(Object.entries(hopHeaders).filter(([k]) => k !== 'content-length' && k !== 'content-type'));
          }
          url = next;
          continue;
        }
        if (RETRY_STATUS.has(res.status) && idempotent && n < retries) {
          lastError = new HttpError(`HTTP ${res.status}`, 'http', url.toString(), res.status, parseRetryAfter(res.headers['retry-after']));
          break;
        }
        const header = (h: string) => {
          const v = res.headers[h];
          return (Array.isArray(v) ? v[0] : v) ?? null;
        };
        return {
          status: res.status,
          ok: res.status >= 200 && res.status < 300,
          notModified: res.status === 304,
          headers: res.headers,
          body: res.body,
          url: url.toString(),
          etag: header('etag') ?? opts.etag ?? null,
          lastModified: header('last-modified') ?? opts.lastModified ?? null,
          ms: Date.now() - started,
          attempts: n + 1,
        };
      }
    } catch (e) {
      let err = e instanceof HttpError ? e : new HttpError((e as Error).message, 'network', url.toString());
      if (err.code === 'aborted' && deadline?.aborted) err = new HttpError(`Deadline of ${opts.deadlineMs} ms exceeded`, 'timeout', url.toString());
      if (err.code === 'blocked' || err.code === 'too_large' || err.code === 'aborted' || err.code === 'redirect' || !idempotent || n >= retries || deadline?.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new HttpError('Request failed', 'network', String(input));
}

export interface JsonResult<T> extends HttpResult {
  /** Undefined on 304 Not Modified. */
  data: T | undefined;
}

/** Throws HttpError('http') on non-2xx/304. Parses JSON regardless of Content-Type (EONET lies). */
export async function httpJson<T = unknown>(url: string | URL, opts: HttpOptions = {}): Promise<JsonResult<T>> {
  const res = await httpRequest(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } });
  if (res.notModified) return { ...res, data: undefined };
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, 'http', res.url, res.status);
  try {
    const text = res.body.toString('utf8').replace(/^﻿/, '');
    return { ...res, data: JSON.parse(text) as T };
  } catch (e) {
    throw new HttpError(`Invalid JSON: ${(e as Error).message}`, 'parse', res.url, res.status);
  }
}

export interface TextResult extends HttpResult {
  text: string | undefined;
}

export async function httpText(url: string | URL, opts: HttpOptions = {}): Promise<TextResult> {
  const res = await httpRequest(url, opts);
  if (res.notModified) return { ...res, text: undefined };
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, 'http', res.url, res.status);
  return { ...res, text: res.body.toString('utf8').replace(/^﻿/, '') };
}

/** Short machine reason for provider status (`timeout`, `http_503`, …). */
export function errorReason(e: unknown): string {
  if (e instanceof HttpError) return e.code === 'http' && e.status ? `http_${e.status}` : e.code;
  if (e instanceof Error && e.message === 'empty') return 'empty';
  return 'error';
}
