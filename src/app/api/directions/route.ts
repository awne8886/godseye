/**
 * GET /api/directions?from=lat,lng&to=lat,lng&via=lat,lng|lat,lng&mode=drive|walk|bike&avoid=
 * Turn-by-turn routes (Valhalla primary with alternates; OSRM fallback), normalised to
 * DirectionsResponse. OSIRIS mode names (auto/pedestrian/bicycle) are aliases. Owner: panels-recon.
 */
import { z } from 'zod';
import { json, parseQuery, withRoute } from '@/lib/respond';
import { DIRECTIONS_ATTRIBUTION, MODE_ALIASES, directions, parsePoint, type LatLng } from '@/components/panels/recon/server/directions';
import { offline } from '@/components/panels/recon/server/lookup';

export const dynamic = 'force-dynamic';

const Point = z.string().transform((v, ctx) => {
  const p = parsePoint(v);
  if (!p) {
    ctx.addIssue({ code: 'custom', message: 'expected "lat,lng" with lat in [-90, 90] and lng in [-180, 180]' });
    return z.NEVER;
  }
  return p;
});

const Query = z.object({
  from: Point,
  to: Point,
  via: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return [] as LatLng[];
      const pts = v.split('|').map(parsePoint);
      if (pts.length > 8 || pts.some((p) => !p)) {
        ctx.addIssue({ code: 'custom', message: 'via must be up to 8 "lat,lng" points separated by |' });
        return z.NEVER;
      }
      return pts as LatLng[];
    }),
  mode: z.enum(['drive', 'walk', 'bike', 'auto', 'pedestrian', 'bicycle']).default('drive').transform((m) => MODE_ALIASES[m]!),
  avoid: z
    .string()
    .optional()
    .transform((v) => {
      const s = new Set((v ?? '').split(',').map((x) => x.trim().toLowerCase()));
      return { tolls: s.has('tolls'), highways: s.has('highways'), ferries: s.has('ferries') };
    }),
});

export const GET = withRoute('/api/directions', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const points = [q.data.from, ...q.data.via, q.data.to];
  const r = await directions(points, q.data.mode, q.data.avoid);
  if (!r.engine || !r.routes.length) return offline(r.providers, 'No routing engine returned a route (Valhalla and OSRM failed or found no path).');
  return json(
    {
      engine: r.engine,
      mode: q.data.mode,
      routes: r.routes,
      elevation: r.elevation,
      ascentM: r.ascentM,
      descentM: r.descentM,
      attribution: DIRECTIONS_ATTRIBUTION,
      providers: r.providers,
      timestamp: new Date().toISOString(),
    },
    { ttl: 300 },
  );
});
