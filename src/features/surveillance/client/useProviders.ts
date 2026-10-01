'use client';
/**
 * The camera provider registry (/api/cctv/providers): registry rows (static) plus each proxied
 * provider's frame availability over the last 10 minutes (`frames`), re-read every 5 minutes while
 * a camera surface is mounted so an operator serving broken frames is marked unavailable.
 * Owner: layers-surveillance.
 */
import { useQuery } from '@tanstack/react-query';
import { REPO_URL } from '@/lib/config';
import type { CameraProvider, CameraProvidersResponse, FrameHealth } from '@/lib/types';
import type { RemovalContact } from '../shared';

const FRAMES_REFRESH_MS = 5 * 60_000;

function useProvidersQuery() {
  return useQuery({
    queryKey: ['cctv-providers'],
    staleTime: FRAMES_REFRESH_MS,
    refetchInterval: FRAMES_REFRESH_MS,
    refetchIntervalInBackground: false,
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

/** Frame availability per provider id (empty until the registry loads). */
export function useFrameHealth(): Record<string, FrameHealth> {
  return useProvidersQuery().data?.frames ?? EMPTY;
}
const EMPTY: Record<string, FrameHealth> = {};

const TRACKER: RemovalContact = { kind: 'tracker', href: `${REPO_URL}/issues` };

/** This instance's removal contact (from /api/cctv/providers); the project tracker until it loads. */
export function useRemovalContact(): RemovalContact {
  return useProvidersQuery().data?.removal ?? TRACKER;
}

/** Seconds between still refreshes: never faster than the operator allows, never under 10 s. */
export function refreshSeconds(p: CameraProvider | undefined | null, floor = 10): number {
  return Math.max(floor, p?.max_poll_interval ?? 60);
}
