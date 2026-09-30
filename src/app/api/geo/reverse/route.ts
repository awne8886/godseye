/**
 * GET /api/geo/reverse?lat=&lng= — place name for the cursor readout. Answers for the centre of
 * the 0.1° grid cell (cached 30 days per cell): Photon first, queued Nominatim only if Photon
 * fails. 503 with provider status when neither answered. Owner: panels-recon.
 */
import { z } from 'zod';
import { json, parseQuery, withRoute } from '@/lib/respond';
import { GEO_ATTRIBUTION, reverseGeocode } from '@/components/panels/recon/server/geo';
import { anyOk, offline } from '@/components/panels/recon/server/lookup';

export const dynamic = 'force-dynamic';

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const GET = withRoute('/api/geo/reverse', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const r = await reverseGeocode(q.data.lat, q.data.lng);
  if (!anyOk(r.providers)) return offline(r.providers, 'Photon and Nominatim are unavailable.');
  return json({ results: r.results, attribution: GEO_ATTRIBUTION, providers: r.providers, timestamp: new Date().toISOString(), cell: r.cell }, { ttl: 600 });
});
