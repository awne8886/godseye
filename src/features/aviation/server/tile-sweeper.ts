/**
 * The keyless adsb.lol tile sweep as one continuous background worker (R2-M2). Server-only.
 *
 * Why: when tiles were fetched inside the feed run (a 25 s slice, then one 15 s TTL idle), the
 * grid was busy ~60 % of the time and a full sweep of ~86 tiles took 170–270 s, so 50–78 % of
 * positions were older than the 60 s dead-reckoning cap by the time a browser saw them. The worker
 * keeps exactly one request in flight back to back (the adsb.lol bucket still spaces starts
 * ≥ 1.2 s), and each feed run only drains what arrived since the previous run.
 *
 * Scheduling: tiles never read go first; any tile whose last read is ≥ MAX_TILE_AGE_MS old goes
 * next (oldest first), so every tile is still re-read within the contract's 180 s sweep; the
 * remaining capacity goes to the tile with the most aircraft-seconds of staleness
 * (`(count + 1) × age`), i.e. the dense hub tiles are re-read more often than empty ocean.
 *
 * Throttling: any error backs off 15 s, 30 s, 60 s … (≤ 5 min), and never less than the
 * upstream's own Retry-After. The worker stops itself when nobody drained it for IDLE_STOP_MS.
 */
import 'server-only';
import { HttpError } from '@/lib/http';
import type { NormalizedBatch } from '../adsb';
import type { Tile } from '../tiles';

/** Every tile is re-read at least this often while the upstream answers (contract §6: ≤ 180 s). */
export const MAX_TILE_AGE_MS = 165_000;
export const IDLE_STOP_MS = 60_000;
export const BACKOFF_BASE_MS = 15_000;
export const BACKOFF_MAX_MS = 300_000;
const STEP_YIELD_MS = 20;

export interface TileResult {
  index: number;
  /** When the response arrived (ms). */
  at: number;
  batch: NormalizedBatch | null;
  error: unknown;
}

export interface TileMemo {
  at: number | null;
  count: number;
}

/** Pick the next tile index (pure; see the file comment for the rule). */
export function nextTile(tiles: readonly TileMemo[], now: number): number {
  let never = -1;
  let overdue = -1;
  let overdueAge = -1;
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]!;
    if (t.at === null) {
      if (never < 0) never = i;
      continue;
    }
    const age = now - t.at;
    if (age >= MAX_TILE_AGE_MS && age > overdueAge) {
      overdue = i;
      overdueAge = age;
    }
    const score = (t.count + 1) * age;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return never >= 0 ? never : overdue >= 0 ? overdue : best;
}

export function backoffMs(failures: number, retryAfterMs: number | undefined): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
  return Math.min(BACKOFF_MAX_MS, Math.max(exp, retryAfterMs ?? 0));
}

export interface SweeperDeps {
  tiles: readonly Tile[];
  fetchTile: (t: Tile, signal: AbortSignal) => Promise<NormalizedBatch>;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

export class TileSweeper {
  readonly memo: TileMemo[];
  failures = 0;
  backoffUntil = 0;
  private results: TileResult[] = [];
  private waiters: (() => void)[] = [];
  private running = false;
  private lastDrain: number;
  private readonly ctrl = new AbortController();
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(private readonly deps: SweeperDeps) {
    this.memo = deps.tiles.map(() => ({ at: null, count: 0 }));
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
    this.lastDrain = this.now();
  }

  /** Results since the previous drain; (re)starts the worker. */
  drain(): TileResult[] {
    this.lastDrain = this.now();
    if (!this.running && !this.ctrl.signal.aborted) void this.loop();
    return this.results.splice(0);
  }

  /**
   * Resolve once `n` results (or any error) are waiting to be drained, or after `ms`. Used on a cold
   * start so the first snapshot carries a first handful of tiles instead of none.
   */
  waitFor(n: number, ms: number, signal: AbortSignal): Promise<void> {
    if (!this.running && !this.ctrl.signal.aborted) {
      this.lastDrain = this.now();
      void this.loop();
    }
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.waiters = this.waiters.filter((w) => w !== check);
        resolve();
      };
      const check = () => {
        if (this.results.length >= n || this.results.some((r) => r.error !== null)) done();
      };
      const t = setTimeout(done, ms);
      t.unref?.();
      signal.addEventListener('abort', done, { once: true });
      this.waiters.push(check);
      check();
    });
  }

  get active(): boolean {
    return this.running;
  }

  /** One scheduling step: wait out a back-off, or fetch the next tile. Exposed for tests. */
  async step(): Promise<void> {
    const wait = this.backoffUntil - this.now();
    if (wait > 0) {
      await this.sleep(Math.min(wait, 5_000), this.ctrl.signal);
      return;
    }
    const index = nextTile(this.memo, this.now());
    const tile = this.deps.tiles[index]!;
    try {
      const batch = await this.deps.fetchTile(tile, this.ctrl.signal);
      const at = this.now();
      this.memo[index] = { at, count: batch.records.length };
      this.failures = 0;
      this.results.push({ index, at, batch, error: null });
      this.notify();
    } catch (e) {
      this.failures++;
      this.backoffUntil = this.now() + backoffMs(this.failures, e instanceof HttpError ? e.retryAfterMs : undefined);
      this.results.push({ index, at: this.now(), batch: null, error: e });
      this.notify();
    }
  }

  private notify(): void {
    for (const w of [...this.waiters]) w();
  }

  private async loop(): Promise<void> {
    this.running = true;
    try {
      while (!this.ctrl.signal.aborted && this.now() - this.lastDrain < IDLE_STOP_MS) {
        await this.step();
        // Yield a macrotask between requests (the adsb.lol bucket already spaces starts by 1.2 s).
        await defaultSleep(STEP_YIELD_MS, this.ctrl.signal);
      }
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    this.ctrl.abort();
  }
}
