/**
 * GET /api/gdelt-events?limit=&quad= — GDELT 2.0 15-minute export events aggregated over the last
 * hour (GdeltEventsResponse), each at its own geocoded point, newest first. `total` counts every
 * matching event in the window and `truncated` says when `items` is not all of them (the `limit`,
 * or the feed's 5 000-event cap in a busy hour) — never a silent first-N (R3 round-5 MINOR-3).
 * The map layer asks for the whole window (`limit=5000`). Owner: layers-threats-network.
 */
import { z } from 'zod';
import { gdeltFeed, MAX_EVENTS } from '@/features/threats/server/gdelt';
import { feedJson, parseQuery, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_EVENTS).default(1_000),
  quad: z
    .string()
    .regex(/^[1-4](,[1-4])*$/, 'comma list of QuadClass 1–4')
    .optional(),
});

export const GET = withRoute('/api/gdelt-events', async (req) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const quads = q.data.quad ? new Set(q.data.quad.split(',').map(Number)) : null;
  return feedJson(req, await gdeltFeed.get(), (d) => {
    const matching = quads ? d.items.filter((e) => quads.has(e.quadClass)) : d.items;
    const items = matching.slice(0, q.data.limit);
    // Events the feed's cap dropped are only countable without a QuadClass filter (their classes
    // were not kept); with one, a capped window still reports truncated.
    const capped = Math.max(0, (d.windowEvents ?? d.items.length) - d.items.length);
    const total = quads ? matching.length : matching.length + capped;
    return { items, total, truncated: items.length < matching.length || capped > 0, window: d.window, scanned: d.scanned };
  });
});
