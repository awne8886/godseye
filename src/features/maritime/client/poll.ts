/**
 * Maritime poll schedule (perf m-g). Ports and chokepoints are REFERENCE data bundled with the
 * server: without the AIS relay the route's answer only changes when the server is redeployed, so
 * the browser fetches it once and refreshes it on an hours-long TTL. Only a keyed AIS relay
 * (`aisConfigured`) is polled at the registry's live cadence: vessels move, and port congestion /
 * chokepoint counts are computed from them. Before a good answer (first load, SOURCE OFFLINE) the
 * live cadence is the retry cadence. Pure; owner: layers-threats-network.
 */
import { LAYERS } from '@/lib/layer-registry';
import type { MaritimeResponse } from '@/lib/types';

/** Registry cadence for the live AIS relay (10 s). */
export const MARITIME_LIVE_MS = LAYERS.find((l) => l.id === 'maritime')!.refreshMs!;

/** Refresh cadence for the REFERENCE-only (keyless) answer. */
export const MARITIME_REFERENCE_MS = 6 * 60 * 60_000;

export function maritimePollMs(body: Pick<MaritimeResponse, 'aisConfigured'> | null): number {
  if (!body) return MARITIME_LIVE_MS;
  return body.aisConfigured ? MARITIME_LIVE_MS : MARITIME_REFERENCE_MS;
}
