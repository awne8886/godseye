/**
 * Basemap style + TileJSON download for the first globe paint. The OpenFreeMap "dark" style names
 * its vector TileJSON (`/planet`) in `sources.openmaptiles.url`; fetching the two one after the
 * other cost a full round trip before MapLibre could even be constructed. The TileJSON we expect
 * is requested in parallel with the style and used only if the style really names that URL;
 * any other URL is fetched after the style as before.
 *
 * Every request has its own deadline (`BASEMAP_FETCH_TIMEOUT_MS`, body included): a request that
 * never answers is aborted and rejects, so `loadBasemapWithRetry` can show BASEMAP UNAVAILABLE and
 * try again with backoff (2, 4, 8, 16, 30, 30 s…) instead of leaving a blank page (R1r4-m1).
 * A failure of either document rejects — never a blank globe pretending to be a map. Across
 * attempts (`createBasemapStyleLoader`) a document that already arrived is kept, so a retry only
 * asks again for the one that failed (R1r5-m2). The URLs are constants so the app shell can `preconnect`/`preload` them (they match these
 * requests: CORS, credentials `same-origin`, which sends nothing cross-origin). Owner: map-engine.
 */
import type { StyleSpecification } from 'maplibre-gl';
import { BASEMAP_STYLE_URL, BASEMAP_TILEJSON_URL } from './basemap-urls';
import { inlineTileJson, parseTileJson, tileJsonUrl } from './style-transform';

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export interface FetchTimers {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/** Reads the global timers at call time (so fake timers drive the unit tests). */
const realTimers: FetchTimers = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** One style or TileJSON request (headers and body) is abandoned after this long. */
export const BASEMAP_FETCH_TIMEOUT_MS = 15_000;
/** First retry after a failed or timed-out style load; doubles per failure up to the cap. */
export const STYLE_RETRY_BASE_MS = 2000;
export const STYLE_RETRY_MAX_MS = 30_000;

/** Delay before the next attempt after `failures` consecutive failures (≥ 1): 2, 4, 8, 16, 30, 30 s… */
export function styleRetryDelayMs(failures: number): number {
  return Math.min(STYLE_RETRY_MAX_MS, STYLE_RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
}

export interface FetchOptions {
  timers?: FetchTimers;
  timeoutMs?: number;
}

async function getJson(fetchFn: FetchLike, url: string, signal: AbortSignal, what: string, o: Required<FetchOptions>): Promise<unknown> {
  const ac = new AbortController();
  const onParentAbort = () => ac.abort(signal.reason);
  if (signal.aborted) ac.abort(signal.reason);
  else signal.addEventListener('abort', onParentAbort, { once: true });
  let timer: unknown = null;
  const deadline = new Promise<never>((_, reject) => {
    timer = o.timers.setTimeout(() => {
      const err = new Error(`${what} timed out after ${Math.round(o.timeoutMs / 1000)} s`);
      ac.abort(err);
      reject(err);
    }, o.timeoutMs);
  });
  const request = (async () => {
    const res = await fetchFn(url, { signal: ac.signal, credentials: 'same-origin' });
    if (!res.ok) throw new Error(`${what} HTTP ${res.status}`);
    return res.json() as Promise<unknown>;
  })();
  try {
    // A fetch that ignores its signal still loses the race: the caller always gets an answer.
    return await Promise.race([request, deadline]);
  } finally {
    o.timers.clearTimeout(timer);
    signal.removeEventListener('abort', onParentAbort);
  }
}

/** A parsed style document MapLibre can take (validated before it is kept for a retry). */
function asStyle(raw: unknown): StyleSpecification {
  const s = raw as Partial<StyleSpecification> | null;
  if (!s || typeof s !== 'object' || s.version !== 8 || !s.sources || typeof s.sources !== 'object' || !Array.isArray(s.layers)) {
    throw new Error('basemap style is not a MapLibre v8 style');
  }
  return s as StyleSpecification;
}

/**
 * A style loader for `loadBasemapWithRetry` (R1r5-m2). Each document (the style, its TileJSON) is
 * memoised by URL once it has arrived and validated, and a request still in flight is shared, so a
 * retry asks again only for the document that failed: before, attempt 1 got the style but not the
 * TileJSON and attempt 4 the TileJSON but not the style, and no globe for over 90 s. A failed,
 * timed-out or invalid document is forgotten (never kept as truth) and fetched again next attempt.
 */
export function createBasemapStyleLoader(fetchFn: FetchLike = fetch, opts: FetchOptions = {}): (signal: AbortSignal) => Promise<StyleSpecification> {
  const o = { timers: opts.timers ?? realTimers, timeoutMs: opts.timeoutMs ?? BASEMAP_FETCH_TIMEOUT_MS };
  const docs = new Map<string, Promise<unknown>>();
  const memo = <T>(url: string, signal: AbortSignal, what: string, validate: (raw: unknown) => T): Promise<T> => {
    const known = docs.get(url) as Promise<T> | undefined;
    if (known) return known;
    const p = getJson(fetchFn, url, signal, what, o).then(validate);
    docs.set(url, p);
    p.catch(() => {
      if (docs.get(url) === p) docs.delete(url);
    });
    return p;
  };
  return async (signal) => {
    // The TileJSON we expect is requested alongside the style (one round trip, not two).
    const early = memo(BASEMAP_TILEJSON_URL, signal, 'basemap TileJSON', (raw) => parseTileJson(raw, BASEMAP_TILEJSON_URL));
    early.catch(() => undefined); // observed below when used; an unused early failure is not an error
    const raw = await memo(BASEMAP_STYLE_URL, signal, 'basemap style', asStyle);
    const tj = tileJsonUrl(raw);
    if (!tj) return raw;
    const parsed = tj === BASEMAP_TILEJSON_URL ? await early : await memo(tj, signal, 'basemap TileJSON', (body) => parseTileJson(body, tj));
    return inlineTileJson(raw, parsed);
  };
}

/** The upstream style with its vector TileJSON inlined (unthemed). One attempt, nothing kept. */
export async function fetchBasemapStyle(signal: AbortSignal, fetchFn: FetchLike = fetch, opts: FetchOptions = {}): Promise<StyleSpecification> {
  return createBasemapStyleLoader(fetchFn, opts)(signal);
}

export interface RetryHooks<T> {
  /** The style arrived (called once). */
  onLoaded(value: T): void;
  /** An attempt failed or timed out; the next one starts in `retryInMs`. */
  onFailed(error: unknown, retryInMs: number): void;
}

/**
 * Load the basemap until it arrives: each failure (HTTP error, network error or timeout) is
 * reported and retried after `styleRetryDelayMs`. Returns cancel (aborts the request in flight).
 */
export function loadBasemapWithRetry<T>(load: (signal: AbortSignal) => Promise<T>, hooks: RetryHooks<T>, timers: FetchTimers = realTimers): () => void {
  const ac = new AbortController();
  let failures = 0;
  let timer: unknown = null;
  const attempt = () => {
    timer = null;
    load(ac.signal).then(
      (v) => {
        if (!ac.signal.aborted) hooks.onLoaded(v);
      },
      (err: unknown) => {
        if (ac.signal.aborted) return;
        failures++;
        const wait = styleRetryDelayMs(failures);
        hooks.onFailed(err, wait);
        timer = timers.setTimeout(attempt, wait);
      },
    );
  };
  attempt();
  return () => {
    ac.abort();
    if (timer !== null) timers.clearTimeout(timer);
  };
}
