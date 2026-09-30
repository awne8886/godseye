/**
 * GET /api/route/live?from=&to=&reverse=1 — aircraft on an airport pair from aviation's in-process
 * flights snapshot: VRS-matched callsigns plus corridor-inferred aircraft (each flagged), with
 * progress, remaining km and ETA in the destination's local time. When the flights feed has no
 * snapshot the answer is 503 SOURCE OFFLINE with its last-good time. Owner: feature-flight-paths.
 */
import { z } from 'zod';
import { apiError, feedJson, parseQuery, withRoute } from '@/lib/respond';
import { flightsFeed } from '@/features/aviation/feeds';
import type { FlightsSnapshot } from '@/features/aviation/server/sweep';
import { findAirport, vrsIndex } from '@/features/flight-paths/server/data';
import { aircraftOnRoute } from '@/features/flight-paths/server/live';
import { AIRPORT_CODE_RE } from '@/features/flight-paths/lib/idents';

export const dynamic = 'force-dynamic';

const code = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .pipe(z.string().regex(AIRPORT_CODE_RE, 'must be an IATA, ICAO or OurAirports ident'));

const Query = z.object({
  from: code,
  to: code,
  reverse: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export const GET = withRoute('/api/route/live', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const o = findAirport(q.data.from);
  const d = findAirport(q.data.to);
  if (!o || !d) return apiError(404, 'not_found', `Unknown airport: ${[!o && q.data.from, !d && q.data.to].filter(Boolean).join(', ')}`);
  const result = await flightsFeed.get();
  const vrs = vrsIndex();
  const now = Date.now();
  const generated = Date.parse(vrs.generatedAt);
  const withVrs = {
    ...result,
    providers: { ...result.providers, vrs_routes: { ok: true, count: vrs.size, ms: 0, age_s: Number.isFinite(generated) ? Math.round((now - generated) / 1000) : null } },
  };
  return feedJson(req, withVrs, (snap: FlightsSnapshot) => ({
    from: q.data.from,
    to: q.data.to,
    aircraft: aircraftOnRoute(snap.records, o, d, { reverse: q.data.reverse, now, vrs }),
    snapshotAt: result.meta.fetchedAt,
    timestamp: new Date(now).toISOString(),
  }));
});
