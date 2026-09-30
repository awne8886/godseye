'use client';
/** The camera provider registry (/api/cctv/providers), cached for the session. Owner: layers-surveillance. */
import { useQuery } from '@tanstack/react-query';
import { REPO_URL } from '@/lib/config';
import type { CameraProvider, CameraProvidersResponse } from '@/lib/types';
import type { RemovalContact } from '../shared';

function useProvidersQuery() {
  return useQuery({
    queryKey: ['cctv-providers'],
    staleTime: 60 * 60_000,
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/cctv/providers', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as CameraProvidersResponse;
    },
  });
}

export function useProviders(): Map<string, CameraProvider> | null {
  const q = useProvidersQuery();
  return q.data ? new Map(q.data.items.map((p) => [p.id, p])) : null;
}

const TRACKER: RemovalContact = { kind: 'tracker', href: `${REPO_URL}/issues` };

/** This instance's removal contact (from /api/cctv/providers); the project tracker until it loads. */
export function useRemovalContact(): RemovalContact {
  return useProvidersQuery().data?.removal ?? TRACKER;
}

/** Seconds between still refreshes: never faster than the operator allows, never under 10 s. */
export function refreshSeconds(p: CameraProvider | undefined | null, floor = 10): number {
  return Math.max(floor, p?.max_poll_interval ?? 60);
}
