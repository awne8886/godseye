/**
 * One refresh of the flights feed: a slice of the adsb.lol tile sweep plus the global lists and
 * any licensed adapters, merged into the previous snapshot. Kept free of `defineFeed` so tests can
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

/** Provider keys, in `src` column order. */
export const FLIGHT_SOURCES = ['adsblol_tiles', 'adsblol_mil', 'adsblol_ladd', 'adsblol_pia', 'adsblol_reapi', 'opensky', 'adsbfi_mil'] as const;
export type FlightSource = (typeof FLIGHT_SOURCES)[number];

/** Aircraft not re-observed for this long are dropped (one full sweep takes ~170–270 s). */
export const PRUNE_AFTER_S = 300;
/** Global lists (/v2/mil, /v2/ladd, /v2/pia, adsb.fi mil) are refreshed at most this often. */
export const GLOBAL_EVERY_MS = 30_000;
/** OpenSky standard account: 4 credits per global call, 4 000 a day → one call per 86.4 s. */
export const OPENSKY_EVERY_MS = 90_000;
/**
 * Wall-clock budget for tile requests in one run (the feed's deadline is larger). The next run starts
 * one TTL (15 s) after this one ends, so a 25 s slice keeps the grid busy ~60 % of the time: one
 * start per 1.2 s → a full 86-tile sweep every ~170 s. The first run after a cold start is short
 * (FIRST_SLICE_BUDGET_MS) so the first map paint does not wait for a long slice.
 */
export const SLICE_BUDGET_MS = 25_000;
export const FIRST_SLICE_BUDGET_MS = 8_000;

export interface TileState {
  at: number | null;
  ok: boolean;
  count: number;
}

export interface FlightsSnapshot {
  records: FlightRecord[];
  /** Hex ids that a provider listed without a position (not drawn). */
  noPosition: string[];
  tiles: TileState[];
  cursor: number;
  sweepStartedAt: number | null;
  /** Duration of the last complete sweep (ms). */
  lastSweepMs: number | null;
  /** Consecutive tile failures (drives the back-off). */
  tileFailures: number;
  backoffUntil: number;
  due: Partial<Record<FlightSource, number>>;
  /** Last run of each provider (so a provider that did not run this time keeps its real age). */
  runs: Partial<Record<FlightSource, ProviderRun>>;
}

export interface SweepDeps {
  tiles: readonly Tile[];
  fetchTile: (t: Tile, signal: AbortSignal) => Promise<NormalizedBatch>;
  fetchGlobal: (k: GlobalKey, signal: AbortSignal) => Promise<NormalizedBatch>;
  fetchReapi: (signal: AbortSignal) => Promise<NormalizedBatch>;
  fetchOpenSky: (signal: AbortSignal) => Promise<NormalizedBatch>;
  fetchAdsbfiMil: (signal: AbortSignal) => Promise<NormalizedBatch>;
  caps: { reapi: boolean; opensky: boolean; openskyReason: 'not-configured' | 'licence'; adsbfi: boolean };
  now?: () => number;
  sliceBudgetMs?: number;
}

export function emptySnapshot(tileCount: number): FlightsSnapshot {
  return {
    records: [],
    noPosition: [],
    tiles: Array.from({ length: tileCount }, () => ({ at: null, ok: false, count: 0 })),
    cursor: 0,
    sweepStartedAt: null,
    lastSweepMs: null,
    tileFailures: 0,
    backoffUntil: 0,
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
    const budget = deps.sliceBudgetMs ?? (prev ? SLICE_BUDGET_MS : FIRST_SLICE_BUDGET_MS);
    let lastError: unknown = null;
    if (snap.backoffUntil <= now()) {
      if (snap.cursor === 0 || snap.sweepStartedAt === null) snap.sweepStartedAt = now();
      // Never more than one full sweep per run, whatever the budget.
      for (let n = 0; n < deps.tiles.length && !signal.aborted && now() - t0 < budget; n++) {
        const i = snap.cursor;
        const tile = deps.tiles[i]!;
        try {
          const b = await deps.fetchTile(tile, signal);
          batches.push(b.records);
          snap.tiles[i] = { at: now(), ok: true, count: b.records.length };
          snap.tileFailures = 0;
        } catch (e) {
          lastError = e;
          snap.tiles[i] = { ...snap.tiles[i]!, ok: false };
          snap.tileFailures++;
          // Exponential back-off on any upstream error: 15 s, 30 s, 60 s … capped at 5 min.
          snap.backoffUntil = now() + Math.min(300_000, 15_000 * 2 ** (snap.tileFailures - 1));
          break;
        }
        snap.cursor = (i + 1) % deps.tiles.length;
        if (snap.cursor === 0) {
          snap.lastSweepMs = snap.sweepStartedAt !== null ? now() - snap.sweepStartedAt : null;
          snap.sweepStartedAt = now();
        }
      }
    }
    const okTiles = snap.tiles.filter((t) => t.ok && t.at !== null);
    const oldest = okTiles.length ? Math.min(...okTiles.map((t) => t.at!)) : null;
    runs.adsblol_tiles = {
      status: {
        ok: okTiles.length > 0 && lastError === null,
        count: 0,
        ms: now() - t0,
        age_s: null,
        ...(lastError !== null ? { error: errorReason(lastError) } : okTiles.length ? {} : { error: 'empty' }),
      },
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
