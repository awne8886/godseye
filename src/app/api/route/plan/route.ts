/**
 * GET /api/route/plan?from=EGLL&to=KJFK — the §8 planned-route response: great circle (≥ 128
 * unwrapped points + antimeridian-split MultiLineString), estimates with their method, time zones
 * with offsets, daylight, VRS known services (LIVE from the flights snapshot), OpenFlights 2014
 * history, keyed filed plans, METAR/TAF, winds aloft and diversion airports. Geometry and bundled
 * lookups are computed per request (milliseconds); weather/winds/filed plans have their own caches.
 * Owner: feature-flight-paths.
 */
import { z } from 'zod';
import { apiError, json, parseQuery, withRoute } from '@/lib/respond';
import { findAirport } from '@/features/flight-paths/server/data';
import { buildPlan } from '@/features/flight-paths/server/plan';
import { AIRPORT_CODE_RE } from '@/features/flight-paths/lib/idents';
import { hasPendingProvider } from '@/features/flight-paths/lib/pending';

export const dynamic = 'force-dynamic';

const code = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .pipe(z.string().regex(AIRPORT_CODE_RE, 'must be an IATA, ICAO or OurAirports ident'));

const Query = z.object({ from: code, to: code });

export const GET = withRoute('/api/route/plan', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const o = findAirport(q.data.from);
  const d = findAirport(q.data.to);
  if (!o || !d) return apiError(404, 'not_found', `Unknown airport: ${[!o && q.data.from, !d && q.data.to].filter(Boolean).join(', ')}`);
  if (o.ident === d.ident) return apiError(400, 'invalid_request', 'from and to are the same airport');
  const plan = await buildPlan(o, d);
  // A filed route still loading in the background: never let a cache keep this answer.
  return json(plan, { ttl: hasPendingProvider(plan.providers) ? 0 : 300 });
});
