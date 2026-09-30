/**
 * GET /api/maritime?bbox=w,s,e,n — ports + chokepoints (REFERENCE) and AIS vessels (LIVE when
 * AIS_API_KEY is set) (MaritimeResponse). Vessels are filtered to `bbox` when given and capped at
 * 10 000 (most recently reported first) so the response stays < 4 MB. Owner: layers-threats-network.
 */
import { z } from 'zod';
import { maritimeFeed } from '@/features/maritime/server/maritime';
import { inBBox, parseBBox } from '@/lib/geo';
import { feedJson, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({ bbox: z.string().refine((v) => parseBBox(v) !== null, 'bbox must be w,s,e,n').optional() });
const MAX_VESSELS = 10_000;

export const GET = withRoute('/api/maritime', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const box = q.data.bbox ? parseBBox(q.data.bbox) : null;
  return feedJson(req, await maritimeFeed.get(), (d) => {
    const vessels = (box ? d.vessels.filter((v) => inBBox([v.lng, v.lat], box)) : d.vessels)
      .sort((a, b) => Date.parse(b.observedAt ?? '') - Date.parse(a.observedAt ?? ''))
      .slice(0, MAX_VESSELS);
    return { ports: d.ports, chokepoints: d.chokepoints, vessels, aisConfigured: d.aisConfigured };
  });
});
