/**
 * GET /api/frontlines — DeepStateMap frontline snapshot (FrontlinesResponse). Needs the `deepstate`
 * capability (NONCOMMERCIAL=true, not a commercial deployment); otherwise 403 with the reason.
 * Owner: layers-threats-network.
 */
import { capabilityGate } from '@/features/network/server/gate';
import { frontlinesFeed } from '@/features/threats/server/frontlines';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/frontlines', async (req) => {
  const gated = capabilityGate('deepstate', 'deepstate');
  if (gated) return gated;
  return feedJson(req, await frontlinesFeed.get(), (d) => ({ geojson: d.geojson, asOf: d.asOf }));
});
