'use client';
/** Shared /api/live-news query (map dots, card and panel read the same cache). Owner: layers-surveillance. */
import { useQuery } from '@tanstack/react-query';
import { LAYERS } from '@/lib/layer-registry';
import type { LiveNewsResponse } from '@/lib/types';

export type LiveNewsResult = { ok: true; body: LiveNewsResponse } | { ok: false; body: Partial<LiveNewsResponse> };

export function useLiveNewsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['live-news'],
    enabled,
    refetchInterval: LAYERS.find((l) => l.id === 'live_news')?.refreshMs ?? 60 * 60_000,
    queryFn: async ({ signal }): Promise<LiveNewsResult> => {
      const res = await fetch('/api/live-news', { signal });
      const body = (await res.json().catch(() => ({}))) as Partial<LiveNewsResponse>;
      return res.ok ? { ok: true, body: body as LiveNewsResponse } : { ok: false, body };
    },
  });
}
