/**
 * GET /api/flights/stream — SSE: `snapshot` (FlightsResponse) on connect, then `update` (changed
 * rows only), `status` (retired ids + meta + providers) per feed refresh, and `heartbeat` every
 * 15 s. One server-side loop fans out to every client (≤ 4 streams per client IP).
 * Owner: layers-aviation.
 */
import { withRoute } from '@/lib/respond';
import { flightsFeed } from '@/features/aviation/feeds';
import { flightsHub } from '@/features/aviation/server/stream';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/flights/stream', async (req: Request) => {
  // Prime the feed so the connect snapshot carries data (or an honest SOURCE OFFLINE).
  await flightsFeed.get();
  // The full snapshot is ~2–3 MB at world scale: allow it to sit in the queue once.
  return flightsHub().subscribe(req, { maxBufferedBytes: 8 * 1024 * 1024 });
});
