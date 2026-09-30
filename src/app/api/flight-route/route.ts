/**
 * GET /api/flight-route?callsign=&lat=&lng=&speed= — callsign → origin/destination from VRS
 * standing data (adsb.lol), then adsbdb, then hexdb `/route/icao/` (labelled stale with its update
 * time). With a position, progress along the great circle when the aircraft is on the corridor.
 * Owner: layers-aviation.
 */
import { z } from 'zod';
import { apiError, json, parseQuery, withRoute } from '@/lib/respond';
import { flightRoute } from '@/features/aviation/server/route-lookup';

export const dynamic = 'force-dynamic';

const coord = (min: number, max: number) => z.coerce.number().min(min).max(max);

const Query = z
  .object({
    callsign: z
      .string()
      .transform((v) => v.replace(/\s+/g, '').toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9]{2,8}$/, 'callsign must be 2–8 letters/digits')),
    icao24: z.string().trim().toLowerCase().regex(/^~?[0-9a-f]{6}$/).optional(),
    lat: coord(-90, 90).optional(),
    lng: coord(-180, 180).optional(),
    speed: z.coerce.number().min(0).max(2000).optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), { message: 'lat and lng go together', path: ['lat'] });

export const GET = withRoute('/api/flight-route', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const { callsign, lat, lng, speed } = q.data;
  const pos = lat !== undefined && lng !== undefined ? { lat, lng, speedKt: speed ?? null } : null;
  const route = await flightRoute(callsign, pos);
  if (!route) return apiError(503, 'source_offline', 'No route source answered (VRS standing data, adsbdb, hexdb).', { retryAfter: 60, headers: { 'Retry-After': '60' } });
  return json(route, { ttl: route.found ? 600 : 120 });
});
