'use client';
/** The camera provider registry (/api/cctv/providers), cached for the session. Owner: layers-surveillance. */
import { useQuery } from '@tanstack/react-query';
import type { CameraProvider, CameraProvidersResponse } from '@/lib/types';

export function useProviders(): Map<string, CameraProvider> | null {
  const q = useQuery({
    queryKey: ['cctv-providers'],
    staleTime: 60 * 60_000,
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/cctv/providers', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as CameraProvidersResponse;
    },
  });
  return q.data ? new Map(q.data.items.map((p) => [p.id, p])) : null;
}

/** Seconds between still refreshes: never faster than the operator allows, never under 10 s. */
export function refreshSeconds(p: CameraProvider | undefined | null, floor = 10): number {
  return Math.max(floor, p?.max_poll_interval ?? 60);
}
