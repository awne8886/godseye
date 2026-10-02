/**
 * GET /api/cctv?region=us-west[,texas…] | ?lat=&lng= — official public camera catalogue by region
 * (CctvResponse: columnar CAMERA_FIELDS rows, precompressed, weak ETag). One region per request
 * keeps every response far below 4 MB; `pendingRegions` lists regions still loading so the client
 * retries only those. With no parameters the largest region (us-west) is served.
 * Owner: layers-surveillance.
 */
import { z } from 'zod';
import { cctvResponse } from '@/features/surveillance/server/cctv-response';
import { CCTV_REGIONS, isRegion, regionsForPoint, type CctvRegion } from '@/features/surveillance/shared';
import { apiError, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z
  .object({
    region: z.string().max(200).regex(/^[a-z,-]+$/, 'comma list of region keys').optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), { message: 'lat and lng go together' });

const DEFAULT_REGIONS: CctvRegion[] = ['us-west'];

export const GET = withRoute('/api/cctv', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  let regions: CctvRegion[];
  if (q.data.region) {
    const keys = [...new Set(q.data.region.split(',').filter(Boolean))];
    const unknown = keys.filter((k) => !isRegion(k));
    if (unknown.length) return apiError(400, 'invalid_request', `region: unknown ${unknown.join(', ')} (known: ${CCTV_REGIONS.join(', ')})`);
    regions = keys as CctvRegion[];
  } else if (q.data.lat !== undefined && q.data.lng !== undefined) {
    regions = regionsForPoint(q.data.lat, q.data.lng);
  } else {
    regions = DEFAULT_REGIONS;
  }
  if (!regions.length) return apiError(400, 'invalid_request', 'region: empty');
  return cctvResponse(req, regions);
});
