/**
 * GET /api/flight-route?callsign=&icao24=&lat=&lng=&speed=&track= — callsign → origin/destination from VRS
 * standing data (adsb.lol), then adsbdb, then hexdb `/route/icao/` (labelled stale with its update
 * time). With a position, progress along the great circle when the aircraft is on the corridor.
 * `icao24` makes the server judge the leg from that aircraft's exact snapshot position (the
 * client quantises its query) and corroborate a reversed leg from its flown track; a leg the
 * observed course contradicts is withheld (`directionConflict`, `routeCheck`).
 * Owner: layers-aviation.
 */
import { z } from 'zod';
import { apiError, json, parseQuery, withRoute } from '@/lib/respond';
import { flightRoute } from '@/features/aviation/server/route-lookup';

export const dynamic = 'force-dynamic';

// An empty value (`track=`) means "not observed", never 0 — z.coerce.number('') would be 0.
const num = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.coerce.number().min(min).max(max).optional());

const Query = z
  .object({
    callsign: z
      .string()
      .transform((v) => v.replace(/\s+/g, '').toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9]{2,8}$/, 'callsign must be 2–8 letters/digits')),
    icao24: z.string().trim().toLowerCase().regex(/^~?[0-9a-f]{6}$/).optional(),
    lat: num(-90, 90),
    lng: num(-180, 180),
    speed: num(0, 2000),
    track: num(0, 360),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), { message: 'lat and lng go together', path: ['lat'] });

export const GET = withRoute('/api/flight-route', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const { callsign, icao24, lat, lng, speed, track } = q.data;
  const pos = lat !== undefined && lng !== undefined ? { lat, lng, speedKt: speed ?? null, trackDeg: track ?? null } : null;
  const route = await flightRoute(callsign, pos, undefined, { icao24: icao24 ?? null });
  if (!route) return apiError(503, 'source_offline', 'No route source answered (VRS standing data, adsbdb, hexdb).', { retryAfter: 60, headers: { 'Retry-After': '60' } });
  return json(route, { ttl: route.found ? 600 : 120 });
});
