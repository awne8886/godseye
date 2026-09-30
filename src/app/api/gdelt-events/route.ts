/**
 * GET /api/gdelt-events?limit=&quad= — GDELT 2.0 15-minute export events aggregated over the last
 * hour (GdeltEventsResponse), each at its own geocoded point. Owner: layers-threats-network.
 */
import { z } from 'zod';
import { gdeltFeed } from '@/features/threats/server/gdelt';
import { feedJson, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(2_000).default(1_000),
  quad: z
    .string()
    .regex(/^[1-4](,[1-4])*$/, 'comma list of QuadClass 1–4')
    .optional(),
});

export const GET = withRoute('/api/gdelt-events', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const quads = q.data.quad ? new Set(q.data.quad.split(',').map(Number)) : null;
  return feedJson(req, await gdeltFeed.get(), (d) => ({
    items: (quads ? d.items.filter((e) => quads.has(e.quadClass)) : d.items).slice(0, q.data.limit),
    window: d.window,
    scanned: d.scanned,
  }));
});
