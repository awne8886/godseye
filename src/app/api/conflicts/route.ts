/**
 * GET /api/conflicts — conflict zones (REFERENCE polygons) with live GDELT events inside them, at
 * their own coordinates (ConflictsResponse). The state is bounded by the GDELT feed as it is now
 * (boundByGdelt): never LIVE while GDELT is not. Reading GDELT here also keeps its poller alive.
 * Owner: layers-threats-network.
 */
import { boundByGdelt, conflictsFeed } from '@/features/threats/server/conflicts';
import { gdeltFeed } from '@/features/threats/server/gdelt';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/conflicts', async (req) => {
  const [conflicts, gdelt] = await Promise.all([conflictsFeed.get(), gdeltFeed.get()]);
  return feedJson(req, boundByGdelt(conflicts, gdelt), (d) => ({ zones: d.zones, events: d.events, since: d.since }));
});
