/**
 * GET /api/weather — severe weather and natural events from EONET, NWS, GDACS, NHC and GVP
 * (WeatherResponse). Owner: layers-hazards.
 *
 * NWS zone outlines are sent once in `zones` (items reference them by `zoneRefs`) and the body is
 * bounded under the 4 MB cap by `weatherBody()`. Served with feedJson rather than compressedJson:
 * this is a feed (SOURCE OFFLINE 503, stale edge TTL, per-request provider ages), and feedJson
 * already compresses once per snapshot.
 */
import { weatherBody, weatherFeed } from '@/features/hazards/server/weather';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/weather', async (req) =>
  feedJson(req, await weatherFeed.get(), (d) => ({ ...weatherBody(d) })),
);
