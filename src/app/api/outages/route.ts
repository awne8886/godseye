/**
 * GET /api/outages — internet outages from IODA (keyless) and Cloudflare Radar (keyed)
 * (OutagesResponse). Also served at /api/radar (OSIRIS alias). Owner: layers-threats-network.
 */
import { outagesFeed } from '@/features/network/server/outages';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/outages', async (req) => feedJson(req, await outagesFeed.get(), (d) => ({ items: d.items })));
