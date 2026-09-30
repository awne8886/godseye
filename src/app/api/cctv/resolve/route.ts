/**
 * GET /api/cctv/resolve?id= — the camera, its provider registry row and what the viewer can play
 * (CameraResolveResponse): direct HLS/MP4 only from MEDIA_HOSTS, else the same-origin still, else
 * null (link out to the operator). Owner: layers-surveillance.
 */
import { z } from 'zod';
import { findCamera } from '@/features/surveillance/server/catalog';
import { playableFor, publicCamera } from '@/features/surveillance/server/frames';
import { providerRow } from '@/features/surveillance/server/registry';
import { apiError, json, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({ id: z.string().min(3).max(200) });

export const GET = withRoute('/api/cctv/resolve', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const hit = await findCamera(q.data.id);
  if (!hit) return apiError(404, 'not_found', 'No catalogued camera with this id.');
  const provider = providerRow(hit.def);
  const camera = publicCamera(hit.camera, provider);
  return json({ camera, provider, playable: playableFor(camera, provider), timestamp: new Date().toISOString() }, { ttl: 300 });
});
