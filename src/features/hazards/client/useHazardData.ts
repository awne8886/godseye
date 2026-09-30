'use client';
/**
 * Polls a hazards route with react-query (interval from the layer registry, paused while the tab
 * is hidden) and mirrors the honest feed state into useLayerStatusStore: LIVE/age/STALE from
 * `meta.state`, SOURCE OFFLINE with the last-good time on a 503. Owner: layers-hazards.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { LAYERS, type LayerId } from '@/lib/layer-registry';
import { useLayerStatusStore } from '@/lib/layer-host';
import type { FeedMeta, Providers } from '@/lib/types';

export interface Enveloped {
  meta: FeedMeta;
  providers: Providers;
}

export type HazardResult<T> = { ok: true; body: T & Enveloped } | { ok: false; body: Partial<Enveloped> & { error?: string } };

export function refreshMsFor(layer: LayerId): number {
  return LAYERS.find((l) => l.id === layer)?.refreshMs ?? 5 * 60_000;
}

async function load<T>(url: string, signal: AbortSignal): Promise<HazardResult<T>> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as T & Enveloped;
  if (res.status === 503) return { ok: false, body };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { ok: true, body };
}

/**
 * Status published while a layer deliberately fetches nothing (`url === null`, e.g. Sentinel below
 * its minimum zoom): idle, no count, with a machine reason the HUD can show ("ZOOM ≥ 6") instead of
 * a perpetual ACQUIRING.
 */
export function idleStatus(reason: string) {
  return { state: 'idle' as const, count: null, fetchedAt: null, observedAt: null, error: reason, providers: undefined };
}

/**
 * @param count       entity count for the rail badge (null → not counted)
 * @param idleReason  reason published while `url` is null (see idleStatus)
 */
export function useHazardData<T>(layer: LayerId, url: string | null, count: (body: T) => number | null, idleReason?: string) {
  const update = useLayerStatusStore((s) => s.update);
  const q = useQuery({
    queryKey: ['hazards', url],
    queryFn: ({ signal }) => load<T>(url!, signal),
    enabled: url !== null,
    refetchInterval: refreshMsFor(layer),
    placeholderData: (prev) => prev,
  });

  const result = url === null ? undefined : q.data;
  const failed = q.isError;
  const loading = q.isPending && url !== null;
  useEffect(() => {
    if (url === null) {
      if (idleReason) update(layer, idleStatus(idleReason));
      return;
    }
    if (loading) {
      update(layer, { state: 'loading' });
      return;
    }
    if (failed && !result) {
      update(layer, { state: 'offline', count: null, error: 'unreachable' });
      return;
    }
    if (!result) return;
    if (!result.ok) {
      const { meta, providers } = result.body;
      update(layer, {
        state: 'offline',
        count: null,
        fetchedAt: meta?.fetchedAt ?? null,
        observedAt: meta?.observedAt ?? null,
        lastGoodAt: meta?.lastGoodAt ?? null,
        error: 'source_offline',
        providers,
      });
      return;
    }
    const { meta, providers } = result.body;
    update(layer, {
      state: meta.state,
      count: count(result.body),
      fetchedAt: meta.fetchedAt,
      observedAt: meta.observedAt,
      lastGoodAt: meta.lastGoodAt,
      error: undefined,
      providers,
    });
  }, [layer, url, idleReason, result, failed, loading, update, count]);

  useEffect(() => () => update(layer, { state: 'idle', count: null }), [layer, update]);

  return result?.ok ? result.body : null;
}
