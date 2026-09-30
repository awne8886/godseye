/**
 * GET /api/geosearch?q=&submit=1&lat=&lng= — place search. `lat,lng` input answers instantly;
 * Photon serves type-ahead; Nominatim (1 req/s queue) runs only on an explicit submit when Photon
 * has no answer. Owner: panels-recon.
 */
import { z } from 'zod';
import { json, parseQuery, withRoute } from '@/lib/respond';
import { GEO_ATTRIBUTION, searchPlaces } from '@/components/panels/recon/server/geo';
import { anyOk, offline } from '@/components/panels/recon/server/lookup';

export const dynamic = 'force-dynamic';

const Query = z.object({
  q: z.string().trim().min(1, 'q is required').max(200),
  submit: z.enum(['0', '1', 'true', 'false']).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export const GET = withRoute('/api/geosearch', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const submit = q.data.submit === '1' || q.data.submit === 'true';
  const r = await searchPlaces(q.data.q, { submit, lat: q.data.lat, lng: q.data.lng });
  if (!anyOk(r.providers)) return offline(r.providers, 'The geocoders are unavailable.');
  return json({ results: r.results, attribution: GEO_ATTRIBUTION, providers: r.providers, timestamp: new Date().toISOString() }, { ttl: 600 });
});
