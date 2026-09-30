/**
 * GET /api/weather — severe weather and natural events from EONET, NWS, GDACS, NHC and GVP
 * (WeatherResponse). Owner: layers-hazards.
 */
import { weatherFeed } from '@/features/hazards/server/weather';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/weather', async (req) =>
  feedJson(req, await weatherFeed.get(), (d) => ({ items: d.items, unplacedAlerts: d.unplacedAlerts })),
);
