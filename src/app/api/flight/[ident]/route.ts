/**
 * GET /api/flight/{ident} — a specific flight by ICAO callsign (BAW117), IATA flight number
 * (BA117), registration (G-XWBA) or ICAO hex (4ca2b3): route, planned arc, flown track, remaining
 * leg, position, progress, ETA with the destination's offset, identity, METAR/TAF, tracker links
 * and per-source status. Owner: feature-flight-paths.
 */
import { z } from 'zod';
import { apiError, json, withRoute } from '@/lib/respond';
import { flightDetail, nothingFound, upstreamFailures } from '@/features/flight-paths/server/flight';

export const dynamic = 'force-dynamic';

const Ident = z
  .string()
  .transform((v) => decodeURIComponent(v).trim().toUpperCase().replace(/\s+/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9-]{2,10}$/, 'ident must be a callsign, flight number, registration or 6-hex'));

type Ctx = { params: Promise<{ ident: string }> };

export const GET = withRoute<Ctx>('/api/flight/{ident}', async (_req: Request, ctx: Ctx) => {
  const parsed = Ident.safeParse((await ctx.params).ident);
  if (!parsed.success) return apiError(400, 'invalid_request', parsed.error.issues[0]?.message);
  const detail = await flightDetail(parsed.data);
  if (!detail) return apiError(400, 'invalid_request', 'Not a recognisable callsign, flight number, registration or hex.');
  if (nothingFound(detail)) {
    const down = upstreamFailures(detail);
    if (!down.length) return apiError(404, 'not_found', `No live position, route or aircraft record for ${parsed.data}.`);
    return apiError(503, 'source_offline', `Nothing found for ${parsed.data} while ${down.join(', ')} ${down.length === 1 ? 'was' : 'were'} unavailable.`, { retryAfter: 60 });
  }
  return json(detail, { ttl: detail.status === 'airborne' ? 30 : 60 });
});
