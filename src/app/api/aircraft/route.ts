/**
 * GET /api/aircraft?icao24= — adsbdb identity (photo URLs passed through, never stored) plus the
 * current leg of the flown track from adsb.lol readsb traces, with its position source.
 * 400 on a malformed hex; 503 when every upstream failed. Owner: layers-aviation.
 */
import { z } from 'zod';
import { apiError, json, parseQuery, withRoute } from '@/lib/respond';
import { aircraftDetail } from '@/features/aviation/server/aircraft';

export const dynamic = 'force-dynamic';

const Query = z.object({
  icao24: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{6}$/, 'icao24 must be a 6-character ICAO hex address'),
});

export const GET = withRoute('/api/aircraft', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const detail = await aircraftDetail(q.data.icao24);
  if (!detail) return apiError(503, 'source_offline', 'adsbdb and the adsb.lol trace store are both unreachable.', { retryAfter: 30, headers: { 'Retry-After': '30' } });
  return json(detail, { ttl: 120 });
});
