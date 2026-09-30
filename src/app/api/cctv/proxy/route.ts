/**
 * GET /api/cctv/proxy?id=<camera id> — stills-only frame relay. The upstream URL comes from the
 * catalogue entry, never from the request; it is fetched with allowListedFetch() against that
 * provider's exact host + directory prefixes, must be an image ≤ 3 MB, and is streamed back without
 * being stored (Cache-Control = the operator's minimum poll interval). Video is never proxied.
 * Owner: layers-surveillance.
 */
import { z } from 'zod';
import { findCamera } from '@/features/surveillance/server/catalog';
import { fetchFrame, frameResponse } from '@/features/surveillance/server/frames';
import { apiError, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({ id: z.string().min(3).max(200) });

export const GET = withRoute('/api/cctv/proxy', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const hit = await findCamera(q.data.id);
  if (!hit) return apiError(404, 'not_found', 'No catalogued camera with this id.');
  return frameResponse(await fetchFrame(hit.camera, hit.def));
});
