'use client';
/**
 * Polls a hazards route with react-query (interval from the layer registry, paused while the tab
 * is hidden) and mirrors the honest feed state into useLayerStatusStore: LIVE/age/STALE from
 * `meta.state`, SOURCE OFFLINE with the last-good time on a 503. Owner: layers-hazards.
 *
 * A refresh that fails any other way (a 502/500 from the reverse proxy, a network error, a body
 * that is not our envelope, a request that hangs past FETCH_TIMEOUT_MS) is never LIVE (round 8):
 * react-query keeps the previous snapshot, which stays drawn but is badged STALE with its own
 * last-good time, and once the failures outlast 6 × the refresh interval it is SOURCE OFFLINE and
 * cleared, exactly like a 503. A snapshot that is simply not being refreshed (tab hidden, so the
 * interval is paused) is downgraded from LIVE to its age once it is older than 2 × the interval.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { freshnessState } from '@/lib/freshness';
import { LAYERS, type LayerId } from '@/lib/layer-registry';
import { useLayerStatusStore, type LayerStatus } from '@/lib/layer-host';
import type { FeedMeta, FreshnessState, Providers } from '@/lib/types';

export interface Enveloped {
  meta: FeedMeta;
  providers: Providers;
}

/**
 * One response: `ok` = a 200 envelope, `!ok` = the server's own SOURCE OFFLINE (503 + envelope).
 * `receivedAt` is when this client received it (ms epoch): how long the snapshot has gone unverified.
 */
export type HazardResult<T> =
  | { ok: true; body: T & Enveloped; receivedAt: number }
  | { ok: false; body: Partial<Enveloped> & { error?: string }; receivedAt: number };

export function refreshMsFor(layer: LayerId): number {
  return LAYERS.find((l) => l.id === layer)?.refreshMs ?? 5 * 60_000;
}

/** Above every server feed deadline (weather 60 s) so a slow cold fetch is not cut short. */
export const FETCH_TIMEOUT_MS = 75_000;

/** A response that is not our feed envelope (proxy error page, captive portal, truncated body). */
function isEnvelope(body: unknown): body is Enveloped {
  const meta = (body as { meta?: Partial<FeedMeta> } | null)?.meta;
  return typeof meta === 'object' && meta !== null && typeof meta.state === 'string';
}

/** Fetches one hazards route; exported for the timeout / non-envelope regression tests. */
export async function loadHazard<T>(url: string, signal: AbortSignal, timeoutMs = FETCH_TIMEOUT_MS): Promise<HazardResult<T>> {
  // react-query aborts `signal` on unmount / key change; the timer turns a hung request into a
  // failure instead of an in-flight query that never settles (and never leaves LIVE).
  const ac = new AbortController();
  const cancel = () => ac.abort(signal.reason);
  if (signal.aborted) cancel();
  else signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => ac.abort(new DOMException(`no response in ${timeoutMs} ms`, 'TimeoutError')), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    const body: unknown = await res.json().catch(() => null);
    const receivedAt = Date.now();
    // Only the app's own 503 (feedJson: envelope with the last-good meta) is SOURCE OFFLINE; a bare
    // 503 from a proxy carries no meta and must not wipe the last-good time, so it is a failure.
    if (res.status === 503 && isEnvelope(body)) return { ok: false, body: body as Partial<Enveloped> & { error?: string }, receivedAt };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!isEnvelope(body)) throw new Error('not a feed envelope');
    return { ok: true, body: body as T & Enveloped, receivedAt };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

/**
 * Status published while a layer deliberately fetches nothing (`url === null`, e.g. Sentinel below
 * its minimum zoom): idle, no count, with a machine reason the HUD can show ("ZOOM ≥ 6") instead of
 * a perpetual ACQUIRING.
 */
export function idleStatus(reason: string) {
  return { state: 'idle' as const, count: null, fetchedAt: null, observedAt: null, error: reason, providers: undefined };
}

const RANK: Record<FreshnessState, number> = { reference: 0, live: 0, recent: 1, stale: 2, offline: 3 };
const worse = (a: FreshnessState, b: FreshnessState): FreshnessState => (RANK[b] > RANK[a] ? b : a);

/**
 * State of a retained 200 snapshot after the latest refresh failed at `failedAt`: never better than
 * STALE, SOURCE OFFLINE once it went unverified for more than 6 × the interval (freshnessState).
 * Depends only on query data (receivedAt, errorUpdatedAt), so the drawn body and the badge agree.
 */
function failedState(meta: FeedMeta, receivedAt: number, failedAt: number, refreshMs: number): FreshnessState {
  return worse(meta.state, freshnessState({ kind: 'live', at: receivedAt, cadenceMs: refreshMs, failed: true, now: failedAt }));
}

export interface HazardQueryState<T> {
  /** The latest response held by react-query (possibly the previous key's placeholder). */
  result: HazardResult<T> | undefined;
  /** errorUpdatedAt when the latest refresh failed without an envelope 503, else null. */
  failedAt: number | null;
  refreshMs: number;
}

/** What the layer may draw: only a 200 snapshot that is not SOURCE OFFLINE (round 7: nothing unattributable). */
export function drawableBody<T>({ result, failedAt, refreshMs }: HazardQueryState<T>): (T & Enveloped) | null {
  if (!result?.ok) return null;
  if (failedAt !== null && failedState(result.body.meta, result.receivedAt, failedAt, refreshMs) === 'offline') return null;
  return result.body;
}

export interface HazardStatus {
  /** Patch for useLayerStatusStore; null = nothing to publish yet. */
  patch: Partial<LayerStatus> | null;
  /** Wall-clock ms at which the badge must be re-evaluated (LIVE → age → STALE), null = never. */
  recheckAt: number | null;
}

/** The rail/card status for the query state at wall-clock `now` (pure; see the module doc). */
export function hazardStatus<T>(q: HazardQueryState<T>, count: (body: T) => number | null, now: number): HazardStatus {
  const { result, failedAt, refreshMs } = q;
  const error = failedAt === null ? undefined : 'unreachable';
  if (!result) return { patch: failedAt === null ? null : { state: 'offline', count: null, error }, recheckAt: null };
  if (!result.ok) {
    const { meta, providers } = result.body;
    return {
      patch: {
        state: 'offline',
        count: null,
        fetchedAt: meta?.fetchedAt ?? null,
        observedAt: meta?.observedAt ?? null,
        lastGoodAt: meta?.lastGoodAt ?? null,
        error: error ?? 'source_offline',
        providers,
      },
      recheckAt: null,
    };
  }
  const { meta, providers } = result.body;
  const times = { fetchedAt: meta.fetchedAt, observedAt: meta.observedAt, lastGoodAt: meta.lastGoodAt, providers };
  if (failedAt !== null) {
    const state = failedState(meta, result.receivedAt, failedAt, refreshMs);
    return { patch: { ...times, state, count: state === 'offline' ? null : count(result.body), error }, recheckAt: null };
  }
  // Not failing, but not refreshed either (hidden tab): the server's LIVE held at receipt only.
  const age = now - result.receivedAt;
  const stallAt = result.receivedAt + 2 * refreshMs;
  const state = age > 2 * refreshMs ? worse(meta.state, freshnessState({ kind: 'live', at: result.receivedAt, cadenceMs: refreshMs, now })) : meta.state;
  const recheckAt = state === 'live' ? stallAt + 1 : state === 'recent' && age <= 6 * refreshMs ? result.receivedAt + 6 * refreshMs + 1 : null;
  return { patch: { ...times, state, count: count(result.body), error: undefined }, recheckAt };
}

/**
 * @param count       entity count for the rail badge (null → not counted)
 * @param idleReason  reason published while `url` is null (see idleStatus)
 */
export function useHazardData<T>(layer: LayerId, url: string | null, count: (body: T) => number | null, idleReason?: string) {
  const update = useLayerStatusStore((s) => s.update);
  const refreshMs = refreshMsFor(layer);
  const q = useQuery({
    queryKey: ['hazards', url],
    queryFn: ({ signal }) => loadHazard<T>(url!, signal),
    enabled: url !== null,
    refetchInterval: refreshMs,
    placeholderData: (prev) => prev,
  });

  const result = url === null ? undefined : q.data;
  const failedAt = url !== null && q.isError ? q.errorUpdatedAt : null;
  const loading = q.isPending && url !== null;
  // Bumped by the re-check timer so a snapshot that stops being refreshed leaves LIVE on time.
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    if (url === null) {
      if (idleReason) update(layer, idleStatus(idleReason));
      return;
    }
    if (loading) {
      update(layer, { state: 'loading' });
      return;
    }
    const now = Date.now();
    const { patch, recheckAt } = hazardStatus({ result, failedAt, refreshMs }, count, now);
    if (patch) update(layer, patch);
    if (recheckAt === null) return;
    const timer = setTimeout(() => setRecheck((n) => n + 1), Math.max(0, recheckAt - now));
    return () => clearTimeout(timer);
  }, [layer, url, idleReason, result, failedAt, refreshMs, loading, update, count, recheck]);

  useEffect(() => () => update(layer, { state: 'idle', count: null }), [layer, update]);

  return drawableBody({ result, failedAt, refreshMs });
}
