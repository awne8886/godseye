/**
 * GET /api/earthquakes?feed=2.5_day — USGS earthquakes (EarthquakesResponse). Owner: layers-hazards.
 */
import { z } from 'zod';
import { DEFAULT_USGS_FEED, USGS_FEEDS, earthquakeFeed } from '@/features/hazards/server/usgs';
import { feedJson, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({ feed: z.enum(USGS_FEEDS).default(DEFAULT_USGS_FEED) });

export const GET = withRoute('/api/earthquakes', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  return feedJson(req, await earthquakeFeed(q.data.feed).get(), (d) => ({ items: d.items }));
});
