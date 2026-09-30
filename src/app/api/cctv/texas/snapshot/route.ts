/**
 * GET /api/cctv/texas/snapshot?id=txdot-<DISTRICT>-<icd_Id> — TxDOT still. TxDOT answers JSON with
 * a base64 JPEG (`snippet`) and a local timestamp; the JPEG is decoded, checked for FF D8 FF and
 * returned (never stored) with `X-Frame-Observed-At` converted from Texas local time.
 * Owner: layers-surveillance.
 */
import { z } from 'zod';
import { parseTxdotId } from '@/features/surveillance/server/adapters';
import { findCamera } from '@/features/surveillance/server/catalog';
import { fetchTxdotSnapshot, frameResponse } from '@/features/surveillance/server/frames';
import { apiError, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({ id: z.string().min(10).max(200) });

export const GET = withRoute('/api/cctv/texas/snapshot', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  if (!parseTxdotId(q.data.id)) return apiError(400, 'invalid_request', 'id: expected txdot-<DISTRICT>-<icd_Id>');
  const hit = await findCamera(q.data.id);
  if (!hit) return apiError(404, 'not_found', 'No catalogued TxDOT camera with this id.');
  return frameResponse(await fetchTxdotSnapshot(hit.camera, hit.def));
});
