/**
 * GET /api/cables — submarine cables + landing points (REFERENCE, bundled TeleGeography data,
 * CC BY-NC-SA 3.0; needs `nc_sources`) (CablesResponse). Owner: layers-threats-network.
 */
import { cablesFeed } from '@/features/network/server/cables';
import { capabilityGate } from '@/features/network/server/gate';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/cables', async (req) => {
  const gated = capabilityGate('nc_sources', 'telegeography');
  if (gated) return gated;
  return feedJson(req, await cablesFeed.get(), (d) => ({ cables: d.cables, landingPoints: d.landingPoints }));
});
