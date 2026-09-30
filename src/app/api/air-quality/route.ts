/**
 * GET /api/air-quality?bbox=w,s,e,n — PM2.5 / US AQI (AirQualityResponse). Without a bbox: a fixed
 * set of world cities; with one: a 6×6 grid inside it. Needs capability `openmeteo` (non-commercial
 * free tier); without it the answer is SOURCE OFFLINE with `open-meteo: skipped licence`.
 * Owner: layers-hazards.
 */
import { z } from 'zod';
import { airQuality } from '@/features/hazards/server/air-quality';
import { parseBBox } from '@/lib/geo';
import { feedJson, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({
  bbox: z
    .string()
    .max(100)
    .refine((v) => parseBBox(v) !== null, 'bbox must be west,south,east,north in degrees')
    .optional(),
});

export const GET = withRoute('/api/air-quality', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const bbox = q.data.bbox ? parseBBox(q.data.bbox) : null;
  return feedJson(req, await airQuality(bbox), (d) => ({ items: d.items, sampling: d.sampling }));
});
