/**
 * GET /api/conflicts — conflict zones (REFERENCE polygons) with live GDELT events inside them, at
 * their own coordinates (ConflictsResponse). Owner: layers-threats-network.
 */
import { conflictsFeed } from '@/features/threats/server/conflicts';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/conflicts', async (req) => feedJson(req, await conflictsFeed.get(), (d) => ({ zones: d.zones, events: d.events, since: d.since })));
