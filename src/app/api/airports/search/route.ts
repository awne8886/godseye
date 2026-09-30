/**
 * GET /api/airports/search?q=&all=0|1[&submit=1] — airport resolution (§8): exact IATA → ICAO →
 * gps_code/ident → metro group → fuzzy (bundled OurAirports index) → Photon aerodromes → nearest
 * scheduled airports to a Photon place; Nominatim only on an explicit submit (never type-ahead).
 * Owner: feature-flight-paths.
 */
import { z } from 'zod';
import { json, parseQuery, withRoute } from '@/lib/respond';
import { searchAirports } from '@/features/flight-paths/server/airports';
import type { Providers } from '@/lib/types';

export const dynamic = 'force-dynamic';

const flag = z
  .enum(['0', '1', 'true', 'false'])
  .optional()
  .transform((v) => v === '1' || v === 'true');

const Query = z.object({
  q: z
    .string()
    .transform((v) => v.normalize('NFC').replace(/[\u0000-\u001f]/g, '').trim())
    .pipe(z.string().min(1, 'q is required').max(80)),
  all: flag,
  submit: flag,
});

export const GET = withRoute('/api/airports/search', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const now = Date.now();
  const r = await searchAirports(q.data.q, { all: q.data.all, submit: q.data.submit });
  const providers: Providers = Object.fromEntries(Object.entries(r.providers).map(([k, p]) => [k, { ...p.status, age_s: p.okAt ? Math.max(0, Math.round((now - p.okAt) / 1000)) : p.status.age_s }]));
  return json({ query: q.data.q, results: r.results, metro: r.metro, providers, timestamp: new Date(now).toISOString() }, { ttl: 600 });
});
