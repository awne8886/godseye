/**
 * GET /api/cctv/stream-status?id= — real probe of a camera's HLS playlist (must start #EXTM3U) or
 * still (must be an image), through the provider's allow-list, cached 60 s per camera. Link-out
 * cameras report `unknown` (nothing to probe). Owner: layers-surveillance.
 */
import { z } from 'zod';
import { findCamera } from '@/features/surveillance/server/catalog';
import { cachedStatus } from '@/features/surveillance/server/frames';
import { apiError, json, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({ id: z.string().min(3).max(200) });

export const GET = withRoute('/api/cctv/stream-status', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const hit = await findCamera(q.data.id);
  if (!hit) return apiError(404, 'not_found', 'No catalogued camera with this id.');
  const t0 = Date.now();
  const s = await cachedStatus(hit.camera, hit.def);
  const pid = hit.def.row.id;
  const providers = { [pid]: { ok: s.status === 'online', count: 1, ms: Date.now() - t0, age_s: Math.max(0, Math.round((Date.now() - Date.parse(s.checkedAt)) / 1000)) } };
  return json({ id: hit.camera.id, ...s, providers, timestamp: new Date().toISOString() }, { ttl: 60 });
});
