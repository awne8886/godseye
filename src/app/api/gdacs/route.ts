/**
 * GET /api/gdacs — GDACS disaster alerts for the Global Incidents layer (GdacsResponse).
 * Also served at /api/gdelt (OSIRIS alias). Owner: layers-threats-network.
 */
import { gdacsFeed } from '@/features/threats/server/gdacs';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/gdacs', async (req) => feedJson(req, await gdacsFeed.get(), (d) => ({ items: d.items })));
