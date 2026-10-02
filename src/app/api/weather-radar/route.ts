/**
 * GET /api/weather-radar — RainViewer past radar frame list (RadarFramesResponse). Tiles are
 * fetched by the browser from `host` + `path`. Owner: layers-hazards.
 */
import { RADAR_MAX_ZOOM, radarFeed } from '@/features/hazards/server/radar';
import { feedJson, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/weather-radar', async (req) =>
  feedJson(req, await radarFeed.get(), (d) => ({ host: d.host, frames: d.frames, maxZoom: RADAR_MAX_ZOOM })),
);
