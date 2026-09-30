/**
 * GET /api/cyber-threats — CISA Known Exploited Vulnerabilities, newest first, with NVD CVSS where
 * already fetched (KevResponse). Owner: layers-threats-network.
 */
import { kevFeed } from '@/features/network/server/kev';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/cyber-threats', async (req) => feedJson(req, await kevFeed.get(), (d) => ({ items: d.items, catalogVersion: d.catalogVersion, enriched: d.enriched })));
