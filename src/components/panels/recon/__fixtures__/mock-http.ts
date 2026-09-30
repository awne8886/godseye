/**
 * Test double for @/lib/http used by the panels-recon tests: routes URLs to recorded fixtures
 * (captured from the live upstreams on 2026-09-30, see docs/data-sources/panels-recon.md) and
 * simulates redirects while still calling the caller's `validateUrl` on every hop, exactly as the
 * real httpRequest does — so SSRF behaviour is exercised through safeFetch().
 * Test-only: never imported by shipped code.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type * as HttpModule from '@/lib/http';

export interface Reply {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  /** Absolute URL of the next hop (3xx). */
  redirect?: string;
  /** Throw this HttpError code instead of answering. */
  error?: 'timeout' | 'network';
}

export type Handler = (url: URL, opts: HttpModule.HttpOptions) => Reply | undefined;

export const upstream = {
  handlers: [] as Handler[],
  calls: [] as { url: string; method: string; body?: string }[],
  reset() {
    this.handlers = [];
    this.calls = [];
  },
  on(match: string | RegExp, reply: Reply | ((url: URL, opts: HttpModule.HttpOptions) => Reply)) {
    this.handlers.push((url, opts) => {
      const s = url.toString();
      if (typeof match === 'string' ? s.includes(match) : match.test(s)) return typeof reply === 'function' ? reply(url, opts) : reply;
      return undefined;
    });
  },
};

const DIR = path.dirname(new URL(import.meta.url).pathname);
export const fixture = <T = unknown>(name: string): T => JSON.parse(readFileSync(path.join(DIR, name), 'utf8')) as T;
export const fixtureText = (name: string): string => readFileSync(path.join(DIR, name), 'utf8');

export function mockHttp(actual: typeof HttpModule): typeof HttpModule {
  const { HttpError } = actual;
  async function httpRequest(input: string | URL, opts: HttpModule.HttpOptions = {}): Promise<HttpModule.HttpResult> {
    let url = new URL(input);
    for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
      await opts.validateUrl?.(url);
      upstream.calls.push({ url: url.toString(), method: opts.method ?? 'GET', body: typeof opts.body === 'string' ? opts.body : undefined });
      const reply = upstream.handlers.map((h) => h(url, opts)).find(Boolean);
      if (!reply) throw new HttpError('HTTP 404', 'http', url.toString(), 404);
      if (reply.error) throw new HttpError(reply.error, reply.error, url.toString());
      if (reply.redirect) {
        const next = new URL(reply.redirect, url);
        if (url.protocol === 'https:' && next.protocol === 'http:') throw new HttpError('Refusing to follow an https → http downgrade', 'redirect', next.toString(), 302);
        url = next;
        continue;
      }
      const status = reply.status ?? 200;
      const body = Buffer.from(reply.text ?? (reply.json === undefined ? '' : JSON.stringify(reply.json)));
      if (opts.maxBytes && body.length > opts.maxBytes) throw new HttpError('too large', 'too_large', url.toString());
      return { status, ok: status >= 200 && status < 300, notModified: false, headers: reply.headers ?? {}, body, url: url.toString(), etag: null, lastModified: null, ms: 1, attempts: 1 };
    }
    throw new HttpError('Too many redirects', 'redirect', url.toString());
  }
  async function httpJson<T>(url: string | URL, opts: HttpModule.HttpOptions = {}): Promise<HttpModule.JsonResult<T>> {
    const res = await httpRequest(url, opts);
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, 'http', res.url, res.status);
    try {
      return { ...res, data: JSON.parse(res.body.toString('utf8')) as T };
    } catch (e) {
      throw new HttpError(`Invalid JSON: ${(e as Error).message}`, 'parse', res.url, res.status);
    }
  }
  async function httpText(url: string | URL, opts: HttpModule.HttpOptions = {}): Promise<HttpModule.TextResult> {
    const res = await httpRequest(url, opts);
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, 'http', res.url, res.status);
    return { ...res, text: res.body.toString('utf8') };
  }
  return { ...actual, httpRequest, httpJson, httpText } as typeof HttpModule;
}
