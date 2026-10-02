/**
 * GET /api/infrastructure — nuclear facilities (REFERENCE: Wikidata + curated) with seismic/conflict
 * context flags computed in-process from live feeds (InfrastructureResponse). Owner:
 * layers-threats-network.
 */
import { infrastructureFeed } from '@/features/threats/server/nuclear';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/infrastructure', async (req) => feedJson(req, await infrastructureFeed.get(), (d) => ({ items: d.items })));
