/**
 * The one client subscription to /api/flights (react-query key ['flights']): shared by the map
 * layer and the Flight Watch panel so they never fetch twice. Polls every 15 s (paused while the
 * tab is hidden); a 503 becomes an honest `offline` snapshot with the last-good time. Client-only.
 */
'use client';

import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { getLayer, type LayerId } from '@/lib/layer-registry';
import type { FeedMeta, Providers } from '@/lib/types';
import type { Cell } from '@/lib/columnar';
import type { Bucket } from '../classify';
import type { FlightRecord } from '../adsb';
import { BUCKETS, decodeFlight, F } from '../codec';

export interface FlightsData {
  records: FlightRecord[];
  byId: Map<string, FlightRecord>;
  counts: Record<Bucket | 'total' | 'noPosition', number>;
  meta: FeedMeta;
  providers: Providers;
  /** True when the server answered 503 SOURCE OFFLINE. */
  offline: boolean;
}

export const BUCKET_LAYER: Record<Bucket, LayerId> = { commercial: 'flights', private: 'private', jet: 'jets', military: 'military' };
export const LAYER_BUCKET: Partial<Record<LayerId, Bucket>> = { flights: 'commercial', private: 'private', jets: 'jet', military: 'military' };

const EMPTY_COUNTS = { commercial: 0, private: 0, jet: 0, military: 0, total: 0, noPosition: 0 };

/**
 * Decode columnar rows, reusing the previous poll's record object for every aircraft whose row is
 * unchanged (same observation time, source, bucket, callsign and squawk): a poll allocates objects
 * only for aircraft that were actually re-observed, not for all ~10k (perf M4).
 */
export function decodeRows(rows: readonly Cell[][], sources: readonly string[], prev: ReadonlyMap<string, FlightRecord> | null): FlightRecord[] {
  const out: FlightRecord[] = [];
  for (const row of rows) {
    const old = prev?.get(row[F.id] as string);
    if (
      old &&
      old.seenAt === row[F.seenAt] &&
      old.source === (sources[row[F.src] as number] ?? 'unknown') &&
      old.callsign === row[F.callsign] &&
      old.squawk === row[F.squawk] &&
      BUCKET_INDEX[old.bucket] === row[F.bucket] &&
      old.dbFlags === row[F.dbFlags]
    ) {
      out.push(old);
      continue;
    }
    const r = decodeFlight(row, sources);
    if (r) out.push(r);
  }
  return out;
}

const BUCKET_INDEX = Object.fromEntries(BUCKETS.map((b, i) => [b, i])) as Record<Bucket, number>;

/** The last decoded snapshot, so the next poll can reuse unchanged records. */
let lastById: Map<string, FlightRecord> | null = null;

export async function fetchFlights(signal?: AbortSignal): Promise<FlightsData> {
  const res = await fetch('/api/flights', { signal, headers: { accept: 'application/json' } });
  const body = (await res.json()) as { fields?: string[]; rows?: Cell[][]; sources?: string[]; counts?: FlightsData['counts']; meta: FeedMeta; providers: Providers; error?: string };
  if (res.status === 503 || !body.rows) {
    if (!body.meta) throw new Error(`flights: HTTP ${res.status}`);
    return { records: [], byId: new Map(), counts: EMPTY_COUNTS, meta: body.meta, providers: body.providers ?? {}, offline: true };
  }
  const records = decodeRows(body.rows, body.sources ?? [], lastById);
  const byId = new Map(records.map((r) => [r.id, r]));
  lastById = byId;
  return { records, byId, counts: body.counts ?? EMPTY_COUNTS, meta: body.meta, providers: body.providers, offline: false };
}

export function useFlights(enabled: boolean) {
  return useQuery({
    queryKey: ['flights'],
    queryFn: ({ signal }) => fetchFlights(signal),
    enabled,
    refetchInterval: getLayer('flights')?.refreshMs ?? 15_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    // The snapshot is replaced wholesale: react-query's deep compare of ~10k records per poll
    // (replaceEqualDeep) cost more than the decode itself (perf M4).
    structuralSharing: false,
    // Keep the previous snapshot on screen while a refetch is in flight or has failed.
    placeholderData: (prev) => prev,
  });
}

/** Per-viewer display preference (UI state only). */
interface AviationPrefs {
  colorMode: 'bucket' | 'altitude';
  setColorMode: (m: AviationPrefs['colorMode']) => void;
}

export const useAviationPrefs = create<AviationPrefs>((set) => ({
  colorMode: 'bucket',
  setColorMode: (colorMode) => set({ colorMode }),
}));
