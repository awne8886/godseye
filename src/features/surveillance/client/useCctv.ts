'use client';
/**
 * Loads the camera catalogue one region per request (each < 4 MB), retries only regions reported
 * in `pendingRegions` (15 s, then 30 s, then 45 s), refreshes every 30 min while the tab is
 * visible, and mirrors the merged honest state into the `cctv` layer status (SOURCE OFFLINE with
 * last-good time when every region fails). Regions whose every provider needs a key that
 * /api/health reports off are never requested; their providers show as skipped "not-configured"
 * (the flyout's "needs key") instead of an outage. Rows stay columnar; the layer reads them by index.
 * A region whose refetch failed keeps its last-good rows but is at most STALE (never LIVE), with its
 * last-good time and `error: 'unreachable'` (round 8, BLOCKING; see refetch-state.ts).
 * Owner: layers-surveillance.
 */
import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useHealth } from '@/components/hud/hooks';
import { LAYERS } from '@/lib/layer-registry';
import { useLayerStatusStore, type LayerStatus } from '@/lib/layer-host';
import type { Cell } from '@/lib/columnar';
import type { Attribution, FeedMeta, Providers } from '@/lib/types';
import { CCTV_REGIONS, KEYED_REGIONS, requestableRegions, type CctvRegion } from '../shared';
import { atMostStale, lastFetchFailed, worstState } from './refetch-state';

export interface RegionPayload {
  fields: string[];
  rows: Cell[][];
  pendingRegions: string[];
  meta: FeedMeta;
  providers: Providers;
}

type RegionResult = { ok: true; body: RegionPayload } | { ok: false; pending: boolean; body: Partial<RegionPayload> };

const REFRESH_MS = LAYERS.find((l) => l.id === 'cctv')?.refreshMs ?? 30 * 60_000;

class PendingError extends Error {}

async function loadRegion(region: CctvRegion, signal: AbortSignal): Promise<RegionResult> {
  const res = await fetch(`/api/cctv?region=${region}`, { signal, headers: { accept: 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as Partial<RegionPayload>;
  if (res.status === 503) {
    // Still loading upstream: let react-query retry with back-off (bounded below).
    if (body.pendingRegions?.includes(region)) throw new PendingError(region);
    return { ok: false, pending: false, body };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (body.pendingRegions?.includes(region)) throw new PendingError(region);
  return { ok: true, body: body as RegionPayload };
}

export interface CctvData {
  fields: string[];
  rows: Cell[][];
  regionsLoaded: number;
}

/** Providers of regions skipped for a missing key, reported like the server does. */
export function needsKeyProviders(regions: readonly CctvRegion[]): Providers {
  const out: Providers = {};
  for (const r of regions) for (const k of KEYED_REGIONS[r] ?? []) out[k.provider] = { ok: false, count: 0, ms: 0, age_s: null, skipped: 'not-configured' };
  return out;
}

/** A region with rows on the map: its last-good payload and whether its latest refetch failed. */
export interface LoadedRegion {
  body: RegionPayload;
  refetchFailed: boolean;
}

/**
 * The `cctv` layer status for the regions with rows: the stalest region wins, a region whose
 * refetch failed counts as at most STALE, the last-good time is the oldest region's.
 */
export function loadedStatus(loaded: readonly LoadedRegion[], count: number, providers: Providers): Partial<LayerStatus> {
  const attribution: Attribution[] = [];
  const seen = new Set<string>();
  for (const { body } of loaded) {
    for (const a of body.meta.attribution) {
      if (seen.has(a.text)) continue;
      seen.add(a.text);
      attribution.push(a);
    }
  }
  const failed = loaded.some((l) => l.refetchFailed);
  const state = worstState(loaded.map((l) => (l.refetchFailed ? atMostStale(l.body.meta.state) : l.body.meta.state)));
  const oldest = (k: 'fetchedAt' | 'lastGoodAt') => loaded.map((l) => l.body.meta[k]).filter((t): t is string => !!t).sort()[0] ?? null;
  return {
    state,
    count,
    fetchedAt: oldest('fetchedAt'),
    observedAt: loaded.map((l) => l.body.meta.observedAt).filter((t): t is string => !!t).sort().at(-1) ?? null,
    lastGoodAt: oldest('lastGoodAt') ?? oldest('fetchedAt'),
    error: failed ? 'unreachable' : undefined,
    providers,
    attribution,
  };
}

export function useCctv(enabled: boolean): CctvData | null {
  const update = useLayerStatusStore((s) => s.update);
  const caps = useHealth().data?.capabilities;
  const { active, needsKey } = useMemo(() => requestableRegions(caps), [caps]);
  const needsKeyId = needsKey.join(',');
  const queries = useQueries({
    queries: CCTV_REGIONS.map((region) => ({
      queryKey: ['cctv', region],
      queryFn: ({ signal }: { signal: AbortSignal }) => loadRegion(region, signal),
      enabled: enabled && active.includes(region),
      staleTime: REFRESH_MS,
      refetchInterval: REFRESH_MS,
      refetchIntervalInBackground: false,
      retry: (n: number, e: Error) => n < 3 && (e instanceof PendingError || /HTTP 5\d\d/.test(e.message) || e.name === 'TypeError'),
      retryDelay: (n: number) => (n + 1) * 15_000,
    })),
  });

  // A region that became not-configured keeps no stale rows.
  const ok = queries.map((q, i) => (q.data?.ok && active.includes(CCTV_REGIONS[i]!) ? q.data.body : null));
  const key = ok.map((b) => b?.meta.fetchedAt ?? '-').join('|');
  // Regions shown from data react-query kept after a failed refetch (their meta.state is stale news).
  const refetchFailed = queries.map((q, i) => ok[i] !== null && lastFetchFailed(q));
  const failKey = refetchFailed.map((f) => (f ? 1 : 0)).join('');

  const merged = useMemo<CctvData | null>(() => {
    const bodies = ok.filter((b): b is RegionPayload => b !== null);
    if (!bodies.length) return null;
    return { fields: bodies[0]!.fields, rows: bodies.flatMap((b) => b.rows), regionsLoaded: bodies.length };
    // `key` changes exactly when a region's snapshot changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = queries.some((q) => q.isPending && q.fetchStatus !== 'idle');
  const settled = queries.every((q) => !q.isPending || q.fetchStatus === 'idle');
  const failedBodies = queries.map((q) => (q.data && !q.data.ok ? q.data.body : null)).filter(Boolean) as Partial<RegionPayload>[];

  useEffect(() => {
    if (!enabled) return;
    const loaded: LoadedRegion[] = [];
    ok.forEach((body, i) => {
      if (body) loaded.push({ body, refetchFailed: refetchFailed[i]! });
    });
    const providers: Providers = needsKeyProviders(needsKey);
    for (const b of [...failedBodies, ...loaded.map((l) => l.body)]) Object.assign(providers, b.providers ?? {});
    if (!loaded.length) {
      if (loading) update('cctv', { state: 'loading' });
      else if (settled) {
        const last = failedBodies.map((b) => b.meta?.lastGoodAt).filter((t): t is string => !!t).sort().at(-1) ?? null;
        update('cctv', { state: 'offline', count: null, lastGoodAt: last, error: 'source_offline', providers });
      }
      return;
    }
    update('cctv', loadedStatus(loaded, merged?.rows.length ?? 0, providers));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, failKey, loading, settled, failedBodies.length, needsKeyId, update]);

  return merged;
}
