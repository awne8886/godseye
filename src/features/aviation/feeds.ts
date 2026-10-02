/**
 * Server-side feeds for aviation. Owner: layers-aviation. Server-only.
 * List every Feed defined with defineFeed() in this area so instrumentation can start the eager
 * ones and /api/health reports them before their first request.
 */
import 'server-only';
import { evaluateCapability, hasCapability } from '@/lib/capabilities';
import { defineFeed, type Feed } from '@/lib/feeds';
import type { Attribution, FreshnessState, Providers } from '@/lib/types';
import { coverageTiles, sweepOrder } from './tiles';
import { fetchAdsbfiMil, fetchGlobal, fetchOpenSky, fetchReapi, fetchTile } from './server/providers';
import { runSweep, type FlightsSnapshot } from './server/sweep';
import { TileSweeper, type TileResult } from './server/tile-sweeper';
import { flightsState } from './server/view';

const SWEEP_TILES = sweepOrder(coverageTiles());
/** On a cold start, let the worker read a first handful of tiles (≤ 8 s) before the first snapshot. */
const FIRST_DRAIN_WAIT_MS = 8_000;
const FIRST_DRAIN_TILES = 6;

const G = globalThis as unknown as { __godseyeTileSweeper?: TileSweeper };
function sweeper(): TileSweeper {
  return (G.__godseyeTileSweeper ??= new TileSweeper({ tiles: SWEEP_TILES, fetchTile }));
}

async function drainTiles(cold: boolean, signal: AbortSignal): Promise<TileResult[]> {
  const s = sweeper();
  if (cold) await s.waitFor(FIRST_DRAIN_TILES, FIRST_DRAIN_WAIT_MS, signal);
  return s.drain();
}

/** Stop the background tile worker (process shutdown; tests start each case from a cold worker). */
export function stopTileSweeper(): void {
  G.__godseyeTileSweeper?.stop();
  delete G.__godseyeTileSweeper;
}

export const ADSBLOL_ATTRIBUTION: Attribution = {
  text: 'Aircraft data © adsb.lol contributors, ODbL 1.0',
  url: 'https://www.adsb.lol/',
  licence: 'ODbL-1.0',
};

function attributions(env: Record<string, string | undefined> = process.env): Attribution[] {
  const out = [ADSBLOL_ATTRIBUTION];
  if (hasCapability('opensky', env)) {
    out.push({ text: 'The OpenSky Network (Schäfer et al., IPSN 2014), used under a written licence', url: 'https://opensky-network.org/' });
  }
  if (hasCapability('adsbfi', env)) out.push({ text: 'adsb.fi open data (personal, non-commercial use)', url: 'https://adsb.fi/' });
  return out;
}

/**
 * The cap `flightsState()` puts on the feed state, as a `stateCap`: null while the positions
 * provider (re-api when configured, else the tile sweep) is ok; RECENT/STALE by its last-good age
 * while it fails. Applied on every read, so /api/health agrees with /api/flights (R2 round 5
 * MINOR-1).
 */
export function positionsCap(providers: Providers | null | undefined): FreshnessState | null {
  if (!providers) return null;
  const state = flightsState('live', providers);
  return state === 'live' ? null : state;
}

let capping = false;

/**
 * The providers persisted with the current snapshot (`meta.providers` in the SnapshotStore), so the
 * cap holds after a restart and on an instance that serves a snapshot another one wrote (round 5
 * fix pass: an in-process "last run" was empty there). `peek()` evaluates this cap again; that
 * inner read is uncapped (it only supplies the providers).
 */
function snapshotProviders(): Providers | null {
  if (capping) return null;
  capping = true;
  try {
    return flightsFeed.peek().providers;
  } finally {
    capping = false;
  }
}

/**
 * Live aircraft. A background worker reads adsb.lol tiles back to back (≤ 1 in flight, one start
 * per 1.2 s; dense tiles more often, every tile within 165 s); each run, one TTL after the last,
 * merges the tiles that arrived plus the global lists (every 30 s). Every record carries its own
 * observation time, and the feed shows LIVE / its age honestly between runs.
 */
export const flightsFeed = defineFeed<FlightsSnapshot>({
  key: 'flights',
  ttlMs: 15_000,
  kind: 'live',
  attribution: attributions(),
  note: `adsb.lol keyless coverage: ${SWEEP_TILES.length} tiles of 250 nm over the busiest airspace; sparse regions are not covered`,
  pollMs: 2_000,
  deadlineMs: 55_000,
  retryAfterErrorMs: 20_000,
  maxObservationAgeMs: 180_000,
  stateCap: () => positionsCap(snapshotProviders()),
  // OpenSky / adsb.fi records must not outlive their licence gates (ctx.previous is merged per run).
  gates: ['opensky', 'adsbfi'],
  count: (d) => d.records.length,
  run: async (ctx) => {
    const opensky = evaluateCapability('opensky');
    const { snapshot, providers, observedAt } = await runSweep(
      ctx.previous,
      {
        tiles: SWEEP_TILES,
        drainTiles: () => drainTiles(ctx.previous === null, ctx.signal),
        fetchGlobal,
        fetchReapi,
        fetchOpenSky: (signal) => fetchOpenSky(process.env, signal),
        fetchAdsbfiMil,
        caps: {
          reapi: hasCapability('adsblol_reapi'),
          opensky: opensky.enabled,
          // Credentials without OPENSKY_LICENSED=true is a licence gate, not a missing key.
          openskyReason: process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET ? 'licence' : 'not-configured',
          adsbfi: hasCapability('adsbfi'),
        },
      },
      ctx.signal,
    );
    return { data: snapshot, providers, observedAt };
  },
});

export const feeds: Feed<unknown>[] = [flightsFeed as Feed<unknown>];
