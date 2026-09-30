/**
 * NWS zone geometry cache. Most active alerts carry `geometry: null` and only list
 * `affectedZones` (probed 2026-09-30: 112 of 152 alerts, 252 distinct zones). Zone outlines
 * change only at NWS boundary updates, so each is cached for 30 days (in-process, persisted to the
 * SnapshotStore so a restart or another instance reuses it). Lookups are budgeted per refresh
 * (120, ~15 s at 8 req/s) and paced with a provider bucket; alerts whose zones are still pending are reported as unplaced.
 * Owner: layers-hazards. Server-only.
 */
import 'server-only';
import { getStore } from '@/lib/cache';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { parseZone, type ZoneGeom } from './weather-parse';

export const ZONE_TTL_MS = 30 * 24 * 3600_000;
const STORE_KEY = 'hazards:nws-zones';
const ZONE_PREFIX = 'https://api.weather.gov/zones/';

interface Entry {
  zone: ZoneGeom | null;
  at: number;
}

type Fetcher = (url: string, signal?: AbortSignal) => Promise<unknown>;

const G = globalThis as unknown as { __godseyeNwsZones?: { map: Map<string, Entry>; loaded: boolean } };
const state = (G.__godseyeNwsZones ??= { map: new Map(), loaded: false });

const defaultFetcher: Fetcher = async (url, signal) =>
  (await httpJson(url, { signal, timeoutMs: 10_000, retries: 1, limiter: providerBucket('api.weather.gov', 8, 8), headers: { accept: 'application/geo+json' } })).data;

async function loadPersisted(): Promise<void> {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const snap = await getStore().get<Record<string, Entry>>(STORE_KEY);
    if (!snap?.data) return;
    for (const [k, v] of Object.entries(snap.data)) if (!state.map.has(k)) state.map.set(k, v);
  } catch {
    // A store outage only means zones are looked up again.
  }
}

async function persist(): Promise<void> {
  const now = Date.now();
  const data = Object.fromEntries([...state.map.entries()].filter(([, v]) => now - v.at < ZONE_TTL_MS));
  try {
    await getStore().set(STORE_KEY, { data, fetchedAt: now, lastAttemptAt: now, error: null }, ZONE_TTL_MS);
  } catch {
    // Best effort.
  }
}

/**
 * Resolve zone URLs to geometry. At most `budget` uncached zones are fetched per call
 * (`concurrency` at a time); the rest resolve on later refreshes. A zone with no usable geometry
 * is remembered (as null) for a day so it is not re-requested every refresh.
 */
export async function resolveZones(
  urls: readonly string[],
  opts: { signal?: AbortSignal; budget?: number; concurrency?: number; fetcher?: Fetcher; now?: number } = {},
): Promise<{ zones: Map<string, ZoneGeom>; fetched: number; failed: number; pending: number }> {
  await loadPersisted();
  const now = opts.now ?? Date.now();
  const fetcher = opts.fetcher ?? defaultFetcher;
  const zones = new Map<string, ZoneGeom>();
  const missing: string[] = [];
  for (const u of new Set(urls)) {
    if (!u.startsWith(ZONE_PREFIX)) continue;
    const e = state.map.get(u);
    const ttl = e?.zone ? ZONE_TTL_MS : 24 * 3600_000;
    if (e && now - e.at < ttl) {
      if (e.zone) zones.set(u, e.zone);
    } else missing.push(u);
  }
  const todo = missing.slice(0, opts.budget ?? 120);
  let fetched = 0;
  let failed = 0;
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      if (opts.signal?.aborted) return;
      const u = todo[i++]!;
      try {
        const body = (await fetcher(u, opts.signal)) as Parameters<typeof parseZone>[1];
        const zone = parseZone(u, body ?? {});
        state.map.set(u, { zone, at: now });
        if (zone) zones.set(u, zone);
        fetched++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 5, todo.length) }, worker));
  if (fetched) await persist();
  return { zones, fetched, failed, pending: missing.length - fetched };
}

/** Test hook. */
export function resetZoneCache(): void {
  state.map.clear();
  state.loaded = false;
}
