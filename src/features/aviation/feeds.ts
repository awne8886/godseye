/**
 * Server-side feeds for aviation. Owner: layers-aviation. Server-only.
 * List every Feed defined with defineFeed() in this area so instrumentation can start the eager
 * ones and /api/health reports them before their first request.
 */
import 'server-only';
import { evaluateCapability, hasCapability } from '@/lib/capabilities';
import { defineFeed, type Feed } from '@/lib/feeds';
import type { Attribution } from '@/lib/types';
import { coverageTiles, sweepOrder } from './tiles';
import { fetchAdsbfiMil, fetchGlobal, fetchOpenSky, fetchReapi, fetchTile } from './server/providers';
import { runSweep, type FlightsSnapshot } from './server/sweep';

const SWEEP_TILES = sweepOrder(coverageTiles());

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
 * Live aircraft. Each run sweeps ~25 s of adsb.lol tiles (one start every 1.2 s) and starts one
 * TTL after the previous run ended (the poller checks every 2 s), so the whole grid is re-read
 * about every 3 min while the global lists refresh every 30 s; every record carries its own
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
  count: (d) => d.records.length,
  run: async (ctx) => {
    const opensky = evaluateCapability('opensky');
    const { snapshot, providers, observedAt } = await runSweep(
      ctx.previous,
      {
        tiles: SWEEP_TILES,
        fetchTile,
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
