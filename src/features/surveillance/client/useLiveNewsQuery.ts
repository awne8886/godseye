'use client';
/** Shared /api/live-news query (map dots, card and panel read the same cache). Owner: layers-surveillance. */
import { useQuery } from '@tanstack/react-query';
import { LAYERS } from '@/lib/layer-registry';
import type { LiveNewsResponse } from '@/lib/types';

export type LiveNewsResult = { ok: true; body: LiveNewsResponse } | { ok: false; body: Partial<LiveNewsResponse> };

/**
 * One /api/live-news fetch. Only the app's own SOURCE OFFLINE answer (503 with a feed `meta`, which
 * carries the server's last-good time) resolves as `{ok: false}`. Any other failure (a 502/504 from
 * a reverse proxy, a 500 or a 503 without a feed body) throws, so react-query keeps the previous
 * good data and the layer shows it at most STALE with its last-good time instead of dropping it
 * for an empty body (verification round 8, MINOR).
 */
export async function fetchLiveNews(signal?: AbortSignal): Promise<LiveNewsResult> {
  const res = await fetch('/api/live-news', { signal, headers: { accept: 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as Partial<LiveNewsResponse>;
  if (res.ok) return { ok: true, body: body as LiveNewsResponse };
  if (res.status === 503 && body.meta) return { ok: false, body };
  throw new Error(`HTTP ${res.status}`);
}

export function useLiveNewsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['live-news'],
    enabled,
    refetchInterval: LAYERS.find((l) => l.id === 'live_news')?.refreshMs ?? 60 * 60_000,
    queryFn: ({ signal }) => fetchLiveNews(signal),
  });
}
