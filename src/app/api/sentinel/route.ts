/**
 * GET /api/sentinel?lat=&lng=&radiusKm=&days= — recent Sentinel-2 L2A scenes around a point from the
 * CDSE STAC (SentinelResponse). Only numbers from the query reach the upstream URL (fixed host).
 * Owner: layers-hazards.
 */
import { z } from 'zod';
import { sentinelScenes } from '@/features/hazards/server/sentinel';
import { feedJson, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().int().min(1).max(100).default(25),
  days: z.coerce.number().int().min(1).max(30).default(10),
});

export const GET = withRoute('/api/sentinel', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const { lat, lng, radiusKm, days } = q.data;
  return feedJson(req, await sentinelScenes(lat, lng, radiusKm, days), (d) => ({ items: d.items, center: [lng, lat] }));
});
