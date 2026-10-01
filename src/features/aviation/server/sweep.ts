/**
 * One refresh of the flights feed: the adsb.lol tiles that the background TileSweeper read since
 * the previous run, plus the global lists and any licensed adapters, merged into the previous
 * snapshot. Kept free of `defineFeed` so tests can
 * drive it with fake fetchers. Server-only.
 *
 * Honesty: every record keeps its own upstream observation time (`seenAt`); aircraft not re-seen
 * within PRUNE_AFTER_S are dropped instead of being shown at a frozen position forever.
 */
import 'server-only';
import { errorReason } from '@/lib/http';
import type { ProviderRun } from '@/lib/feeds';
import { skippedProvider } from '@/lib/feeds';
import { mergeRecords, type FlightRecord, type NormalizedBatch } from '../adsb';
import type { Tile } from '../tiles';
import { RateLimitedError, type GlobalKey } from './providers';
import { MAX_TILE_AGE_MS, type TileResult } from './tile-sweeper';

/** Provider keys, in `src` column order. */
export const FLIGHT_SOURCES = ['adsblol_tiles', 'adsblol_mil', 'adsblol_ladd', 'adsblol_pia', 'adsblol_reapi', 'opensky', 'adsbfi_mil'] as const;
export type FlightSource = (typeof FLIGHT_SOURCES)[number];

/**
 * Aircraft not re-observed for this long are dropped. Every tile is re-read within
 * MAX_TILE_AGE_MS (165 s) and a row's position may already be ≤ 60 s old when read, so 300 s
 * only drops aircraft that really left coverage.
 */
export const PRUNE_AFTER_S = 300;
/** Global lists (/v2/mil, /v2/ladd, /v2/pia, adsb.fi mil) are refreshed at most this often. */
export const GLOBAL_EVERY_MS = 30_000;
/** OpenSky standard account: 4 credits per global call, 4 000 a day → one call per 86.4 s. */
export const OPENSKY_EVERY_MS = 90_000;

export interface TileState {
  at: number | null;
  ok: boolean;
  count: number;
}

export interface FlightsSnapshot {
  records: FlightRecord[];
  /** Hex ids that a provider listed without a position (not drawn). */
  noPosition: string[];
  /** Last read of each coverage tile (the background TileSweeper fills these). */
  tiles: TileState[];
  due: Partial<Record<FlightSource, number>>;
  /** Last run of each provider (so a provider that did not run this time keeps its real age). */
  runs: Partial<Record<FlightSource, ProviderRun>>;
}

export interface SweepDeps {
  tiles: readonly Tile[];
  /** Tile responses that arrived since the previous run (TileSweeper.drain in production). */
  drainTiles: () => Promise<TileResult[]>;
  fetchGlobal: (k: GlobalKey, signal: AbortSignal) => Promise<NormalizedBatch>;
  fetchReapi: (signal: AbortSignal) => Promise<NormalizedBatch>;
  fetchOpenSky: (signal: AbortSignal) => Promise<NormalizedBatch>;
  fetchAdsbfiMil: (signal: AbortSignal) => Promise<NormalizedBatch>;
  caps: { reapi: boolean; opensky: boolean; openskyReason: 'not-configured' | 'licence'; adsbfi: boolean };
  now?: () => number;
}

export function emptySnapshot(tileCount: number): FlightsSnapshot {
  return {
    records: [],
    noPosition: [],
    tiles: Array.from({ length: tileCount }, () => ({ at: null, ok: false, count: 0 })),
    due: {},
    runs: {},
  };
}

function failedRun(e: unknown, t0: number, now: number): ProviderRun {
  return { status: { ok: false, count: 0, ms: now - t0, age_s: null, error: errorReason(e) }, okAt: null };
}

export interface SweepResult {
  snapshot: FlightsSnapshot;
  providers: Record<string, ProviderRun>;
  observedAt: number | null;
}

export async function runSweep(prev: FlightsSnapshot | null, deps: SweepDeps, signal: AbortSignal): Promise<SweepResult> {
  const now = deps.now ?? Date.now;
  const snap: FlightsSnapshot = prev && prev.tiles.length === deps.tiles.length ? structuredClone(prev) : { ...emptySnapshot(deps.tiles.length), ...(prev ? { records: prev.records, runs: prev.runs, due: prev.due } : {}) };
  const batches: FlightRecord[][] = [];
  const noPos: string[] = [];
  const runs = snap.runs;
  const record = (key: FlightSource, run: ProviderRun) => {
    runs[key] = run;
  };

  // 1. Global lists (and adsb.fi mil) at most every GLOBAL_EVERY_MS.
  const globals: GlobalKey[] = ['adsblol_mil', 'adsblol_ladd', 'adsblol_pia'];
  const globalsDue = (snap.due.adsblol_mil ?? 0) <= now();
  if (globalsDue) {
    snap.noPosition = [];
    for (const key of globals) {
      if (signal.aborted) break;
      const t0 = now();
      try {
        const b = await deps.fetchGlobal(key, signal);
        batches.push(b.records);
        noPos.push(...b.noPosition);
        // An empty /v2/pia is truthful (few PIA aircraft airborne at night); mil/ladd are never empty.
        const ok = b.records.length + b.noPosition.length > 0 || key === 'adsblol_pia';
        record(key, { status: { ok, count: b.records.length, ms: now() - t0, age_s: ok ? 0 : null, ...(ok ? {} : { error: 'empty' }) }, okAt: ok ? now() : null });
      } catch (e) {
        record(key, failedRun(e, t0, now()));
      }
    }
    snap.due.adsblol_mil = now() + GLOBAL_EVERY_MS;
  } else {
    noPos.push(...snap.noPosition);
  }

  if (deps.caps.adsbfi) {
    if ((snap.due.adsbfi_mil ?? 0) <= now()) {
      const t0 = now();
      try {
        const b = await deps.fetchAdsbfiMil(signal);
        batches.push(b.records);
        noPos.push(...b.noPosition);
        record('adsbfi_mil', { status: { ok: b.records.length > 0, count: b.records.length, ms: now() - t0, age_s: 0 }, okAt: now() });
      } catch (e) {
        record('adsbfi_mil', failedRun(e, t0, now()));
      }
      snap.due.adsbfi_mil = now() + GLOBAL_EVERY_MS;
    }
  } else {
    record('adsbfi_mil', skippedProvider('licence'));
  }

  // 2. OpenSky (licensed only), every OPENSKY_EVERY_MS; a 429 cools down 15 min.
  if (deps.caps.opensky) {
    if ((snap.due.opensky ?? 0) <= now()) {
      const t0 = now();
      try {
        const b = await deps.fetchOpenSky(signal);
        batches.push(b.records);
        record('opensky', { status: { ok: b.records.length > 0, count: b.records.length, ms: now() - t0, age_s: 0 }, okAt: now() });
        snap.due.opensky = now() + OPENSKY_EVERY_MS;
      } catch (e) {
        record('opensky', failedRun(e, t0, now()));
        snap.due.opensky = now() + (e instanceof RateLimitedError ? e.retryAfterS * 1000 : 60_000);
      }
    }
  } else {
    record('opensky', skippedProvider(deps.caps.openskyReason));
  }

  // 3. Whole-network re-api (feeder IP) or the keyless tile sweep.
  if (deps.caps.reapi) {
    record('adsblol_tiles', skippedProvider('disabled'));
    const t0 = now();
    try {
      const b = await deps.fetchReapi(signal);
      batches.push(b.records);
      record('adsblol_reapi', { status: { ok: b.records.length > 0, count: b.records.length, ms: now() - t0, age_s: 0 }, okAt: now() });
    } catch (e) {
      record('adsblol_reapi', failedRun(e, t0, now()));
    }
  } else {
    record('adsblol_reapi', skippedProvider('not-configured'));
    const t0 = now();
    const prevStatus = runs.adsblol_tiles?.status;
    let lastError: unknown = null;
    let latest = -1;
    let readOk = 0;
    for (const r of await deps.drainTiles()) {
      const prevTile = snap.tiles[r.index];
      if (!prevTile) continue;
      if (r.batch) {
        batches.push(r.batch.records);
        snap.tiles[r.index] = { at: r.at, ok: true, count: r.batch.records.length };
        readOk++;
      } else {
        snap.tiles[r.index] = { ...prevTile, ok: false };
      }
      if (r.at >= latest) {
        latest = r.at;
        lastError = r.batch ? null : r.error;
      }
    }
    const okTiles = snap.tiles.filter((t) => t.ok && t.at !== null);
    const oldest = okTiles.length ? Math.min(...okTiles.map((t) => t.at!)) : null;
    const newest = okTiles.length ? Math.max(...okTiles.map((t) => t.at!)) : null;
    // Hysteresis (R2 round 3/4 MINOR: the LED flapped on every 429). The sweep is healthy while it
    // still reads tiles: any successful tile since the last run keeps it ok, and a run with only
    // failures (a 429 burst) or nothing at all (the worker backing off) HOLDS a previously ok sweep
    // for one sweep period after its newest successful tile — with the honest age of its oldest
    // contributing tile. Past that, or when it was not ok before, the latest error stands.
    const prevOk = prevStatus?.ok === true;
    const held = readOk === 0 && prevOk && newest !== null && now() - newest <= MAX_TILE_AGE_MS;
    const ok = okTiles.length > 0 && (readOk > 0 || held);
    const carried = !ok && latest < 0 && prevStatus && !prevStatus.ok && !prevStatus.skipped && prevStatus.error !== 'empty' ? prevStatus.error : undefined;
    const error = ok ? undefined : lastError !== null ? errorReason(lastError) : (carried ?? (okTiles.length ? 'no_tile_read' : 'empty'));
    runs.adsblol_tiles = {
      status: { ok, count: 0, ms: now() - t0, age_s: null, ...(error !== undefined ? { error } : {}) },
      // Age of the OLDEST tile still contributing: the honest age of the sweep as a whole.
      okAt: oldest,
    };
  }

  // 4. Merge (newest position per hex wins) and prune aircraft nobody has seen recently.
  const merged = mergeRecords([...batches, snap.records]);
  const cutoff = Math.floor(now() / 1000) - PRUNE_AFTER_S;
  const records = [...merged.values()].filter((r) => r.seenAt >= cutoff);
  snap.records = records;
  // Listed without a position by one provider but placed by another: not "no position".
  const placed = new Set(records.map((r) => r.id));
  snap.noPosition = [...new Set(noPos)].filter((id) => !placed.has(id));

  // 5. Per-provider counts = records each contributed to this snapshot.
  const counts = new Map<string, number>();
  let newest = 0;
  for (const r of records) {
    counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
    if (r.seenAt > newest) newest = r.seenAt;
  }
  const providers: Record<string, ProviderRun> = {};
  for (const key of FLIGHT_SOURCES) {
    const run = runs[key];
    if (!run) continue;
    providers[key] = run.status.skipped ? run : { ...run, status: { ...run.status, count: counts.get(key) ?? 0 } };
  }
  return { snapshot: snap, providers, observedAt: newest ? newest * 1000 : null };
}
